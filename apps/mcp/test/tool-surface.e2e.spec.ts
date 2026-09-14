import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectedClient, createTestApp, seedMcpToken, seedUser, seedWorkspace, type TestApp } from './harness.js';

/** Every wire name this server advertises, in sorted order. */
const EXPECTED_TOOL_NAMES = [
    'add_exercise_link',
    'complete_session',
    'create_exercise',
    'create_routine',
    'get_active_session',
    'get_current_user',
    'get_exercise',
    'get_routine',
    'get_session',
    'list_exercises',
    'list_routines',
    'list_sessions',
    'log_set',
    'start_session',
    'update_exercise',
    'update_routine',
];

/**
 * Reachability, not unit behaviour. A tool that is built and tested but never reached the
 * composition root does not exist as far as a client is concerned, and only a real `tools/list`
 * through the real transport can tell the difference.
 */
describe('MCP tool surface', () => {
    let app: TestApp;
    let client: Client;

    beforeAll(async () => {
        app = await createTestApp();

        const user = await seedUser(app.db, { email: 'surface@example.com', displayName: 'Surface' });
        const workspace = await seedWorkspace(app.db, { name: 'Home', ownerId: user.id });

        client = await connectedClient(app, {
            token: await seedMcpToken(app.db, { userId: user.id, workspaceId: workspace.id }),
        });
    });

    afterAll(async () => {
        await client?.close();
        await app?.close();
    });

    it('advertises exactly the expected tools', async () => {
        const { tools } = await client.listTools();

        expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);
    });

    // Every schema is a `strictObject`, including the zero-argument ones, so a misspelled argument
    // is rejected rather than silently dropped.
    it('advertises additionalProperties false on every tool schema', async () => {
        const { tools } = await client.listTools();

        expect(tools.filter((tool) => tool.inputSchema.additionalProperties !== false)).toEqual([]);
    });

    it('marks only the genuinely required arguments as required', async () => {
        const { tools } = await client.listTools();

        expect(tools.find((tool) => tool.name === 'update_exercise')?.inputSchema.required).toEqual(['exerciseId']);
        expect(tools.find((tool) => tool.name === 'create_exercise')?.inputSchema.required).toEqual([
            'name',
            'trackingType',
        ]);
        expect(tools.find((tool) => tool.name === 'list_exercises')?.inputSchema.required ?? []).toEqual([]);
    });

    it('carries the behaviour hints for every tool', async () => {
        const { tools } = await client.listTools();

        expect(tools.find((tool) => tool.name === 'list_exercises')?.annotations?.readOnlyHint).toBe(true);
        expect(tools.find((tool) => tool.name === 'create_exercise')?.annotations?.destructiveHint).toBe(false);
        expect(tools.find((tool) => tool.name === 'update_exercise')?.annotations?.destructiveHint).toBe(true);
    });

    // The workspace comes from the token, and exposing it as an argument would be a contract error,
    // not a convenience - it would let a model name a workspace the token was never issued for.
    it('exposes no workspaceId argument on any tool', async () => {
        const { tools } = await client.listTools();

        const offenders = tools.filter((tool) => 'workspaceId' in (tool.inputSchema.properties ?? {}));

        expect(offenders.map((tool) => tool.name)).toEqual([]);
    });
});
