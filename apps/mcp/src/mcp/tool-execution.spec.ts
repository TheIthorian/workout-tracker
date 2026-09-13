import { EntityNotFoundError, PROBLEM_TYPE_BASE, RequestValidationError } from '@app/errors';
import { createLogger } from '@app/logger';
import { describe, expect, it, vi } from 'vitest';
import {
    buildValidationErrorResult,
    runToolCaught,
    serializeToolResult,
    type ToolCallResult,
} from './tool-execution.js';

const logger = createLogger({ context: 'mcp-test', config: { level: 'fatal', pretty: false, redact: true } });

describe('serializeToolResult', () => {
    it('returns the body as a JSON string in a single text content block', () => {
        const result = serializeToolResult({ body: { id: 'i1', name: 'Widget' } });

        expect(result).toEqual({ content: [{ type: 'text', text: '{"id":"i1","name":"Widget"}' }] });
    });

    // The key must be absent, not present-with-null: a client checking `'description' in body`
    // would otherwise see a description that is not there.
    it('omits null-valued keys', () => {
        const result = serializeToolResult({ body: { id: 'i1', description: null } });

        expect(parseBody(result)).toEqual({ id: 'i1' });
    });

    it('omits null-valued keys inside nested objects and inside array elements', () => {
        const result = serializeToolResult({
            body: {
                id: 'i1',
                meta: { source: 'import', note: null },
                tags: [{ name: 'urgent', colour: null }],
            },
        });

        expect(parseBody(result)).toEqual({
            id: 'i1',
            meta: { source: 'import' },
            tags: [{ name: 'urgent' }],
        });
    });

    // A null ELEMENT is not a property, and dropping it would renumber the array.
    it('keeps a null array element', () => {
        const result = serializeToolResult({ body: { values: [1, null, 2] } });

        expect(parseBody(result)).toEqual({ values: [1, null, 2] });
    });

    it('serializes an array body, matching the tools that return one', () => {
        const result = serializeToolResult({ body: [{ id: 'w1', name: null }] });

        expect(parseBody(result)).toEqual([{ id: 'w1' }]);
    });
});

describe('runToolCaught', () => {
    it('returns the action result untouched when nothing throws', async () => {
        const result = await runToolCaught({
            toolName: 'create_exercise',
            logger,
            action: async () => serializeToolResult({ body: { id: 'i1' } }),
        });

        expect(parseBody(result)).toEqual({ id: 'i1' });
    });

    // A wrapped tool turns an application error into a SUCCESSFUL tool call whose text is the
    // problem body, so the model can read the failure. An unwrapped tool lets it propagate to an
    // `isError: true` result instead.
    it('serializes an AppError as the successful result body', async () => {
        const result = await runToolCaught({
            toolName: 'create_exercise',
            logger,
            action: async (): Promise<ToolCallResult> => {
                throw new EntityNotFoundError('Exercise not found');
            },
        });

        expect(parseBody(result)).toEqual({
            type: `${PROBLEM_TYPE_BASE}/EntityNotFoundError`,
            title: 'Exercise not found',
            status: 404,
        });
    });

    // The runtime type is serialized, so `RequestValidationError`'s extra `errors` dictionary - the
    // only part telling the model WHICH field was wrong - survives.
    it('keeps the field-keyed errors dictionary of a validation error', async () => {
        const result = await runToolCaught({
            toolName: 'create_exercise',
            logger,
            action: async (): Promise<ToolCallResult> => {
                throw new RequestValidationError({ name: ['Name is required'] });
            },
        });

        expect(parseBody(result)).toMatchObject({
            status: 400,
            errors: { name: ['Name is required'] },
        });
    });

    it('turns an unexpected error into the 500 problem body, naming the tool', async () => {
        const result = await runToolCaught({
            toolName: 'update_exercise',
            logger,
            action: async (): Promise<ToolCallResult> => {
                throw new Error('socket hang up');
            },
        });

        expect(parseBody(result)).toEqual({
            type: `${PROBLEM_TYPE_BASE}/McpToolExecutionError`,
            title: 'MCP tool execution failed',
            status: 500,
            detail: 'update_exercise failed: socket hang up',
        });
    });

    it('logs the failure rather than swallowing it silently', async () => {
        const error = vi.fn();
        const spyLogger = { ...logger, warn: vi.fn(), error } as unknown as typeof logger;

        await runToolCaught({
            toolName: 'update_exercise',
            logger: spyLogger,
            action: async (): Promise<ToolCallResult> => {
                throw new Error('socket hang up');
            },
        });

        expect(error).toHaveBeenCalled();
    });
});

describe('buildValidationErrorResult', () => {
    it('builds a problem body carrying the offending field', () => {
        const result = buildValidationErrorResult({ field: 'name', message: 'name must not be empty' });

        expect(parseBody(result)).toEqual({
            type: `${PROBLEM_TYPE_BASE}/RequestValidationError`,
            title: 'Request validation failed',
            status: 400,
            detail: 'One or more validation errors occurred.',
            errors: { name: ['name must not be empty'] },
        });
    });
});

function parseBody(result: ToolCallResult): unknown {
    return JSON.parse(result.content[0].text);
}
