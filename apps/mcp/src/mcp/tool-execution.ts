import { AppError, buildProblem, type ExtendedProblemDetails } from '@app/errors';
import type { Logger } from '@app/logger';

/** The MCP tool-call result shape every tool in this app returns. */
export type ToolCallResult = { content: { type: 'text'; text: string }[] };

/**
 * Wraps a body as a single text content block holding compact JSON, so a client parses
 * `content[0].text`.
 *
 * Returning a plain object instead would make the SDK populate `structuredContent` as well, which
 * doubles the payload for clients that only read the text block.
 */
export function serializeToolResult({ body }: { body: unknown }): ToolCallResult {
    return { content: [{ type: 'text', text: JSON.stringify(stripNulls(body)) }] };
}

/**
 * Runs a tool body, turning any failure into a SUCCESSFUL tool call whose text is an RFC 7807
 * problem body.
 *
 * Use it only for tools where the model should be able to read and act on the failure - a
 * validation complaint it can correct and retry. Leaving a tool unwrapped lets the error propagate,
 * which the SDK reports as `isError: true` instead: a different wire shape, and the right one for a
 * failure the model cannot do anything about.
 */
export async function runToolCaught({
    toolName,
    logger,
    action,
}: {
    toolName: string;
    logger: Logger;
    action: () => Promise<ToolCallResult>;
}): Promise<ToolCallResult> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof AppError) {
            logger.warn({ err: error, toolName }, 'MCP tool failed with an application error.');

            return serializeToolResult({ body: error.problem });
        }

        logger.error({ err: error, toolName }, 'MCP tool failed.');

        return serializeToolResult({
            body: buildProblem({
                errorName: 'McpToolExecutionError',
                title: 'MCP tool execution failed',
                status: 500,
                detail: `${toolName} failed: ${messageOf(error)}`,
            }),
        });
    }
}

/**
 * A validation failure a tool body detects itself, returned as the tool's own result rather than
 * thrown - so the model sees which field it got wrong and can retry.
 */
export function buildValidationErrorResult({ field, message }: { field: string; message: string }): ToolCallResult {
    const problem: ExtendedProblemDetails = {
        ...buildProblem({
            errorName: 'RequestValidationError',
            title: 'Request validation failed',
            status: 400,
            detail: 'One or more validation errors occurred.',
        }),
        errors: { [field]: [message] },
    };

    return serializeToolResult({ body: problem });
}

/**
 * Suppresses null-valued PROPERTIES at every depth, so a client sees `'description' in body ===
 * false` rather than a key present with a null value. Array elements are left alone, including null
 * ones - they are not properties, and dropping them would renumber the array.
 */
function stripNulls(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripNulls);

    if (!isPlainObject(value)) return value;

    const result: Record<string, unknown> = {};

    for (const [key, property] of Object.entries(value)) {
        if (property === null || property === undefined) continue;

        result[key] = stripNulls(property);
    }

    return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !(value instanceof Date);
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
