import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectedClient, createTestApp, seedMcpToken, seedUser, seedWorkspace, type TestApp } from './harness.js';

/** Every wire name this server advertises, in sorted order. */
const EXPECTED_TOOL_NAMES = [
    'add_exercise_link',
    'create_exercise',
    'create_item',
    'create_routine',
    'delete_item',
    'get_current_user',
    'get_exercise',
    'get_item',
    'get_routine',
    'list_exercises',
    'list_items',
    'list_routines',
    'list_workspaces',
    'update_exercise',
    'update_item',
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

        expect(tools.find((tool) => tool.name === 'update_item')?.inputSchema.required).toEqual(['itemId']);
        expect(tools.find((tool) => tool.name === 'create_item')?.inputSchema.required).toEqual(['name']);
        expect(tools.find((tool) => tool.name === 'list_items')?.inputSchema.required ?? []).toEqual([]);
    });

    it('carries the behaviour hints for every tool', async () => {
        const { tools } = await client.listTools();

        expect(tools.find((tool) => tool.name === 'list_items')?.annotations?.readOnlyHint).toBe(true);
        expect(tools.find((tool) => tool.name === 'create_item')?.annotations?.destructiveHint).toBe(false);
        expect(tools.find((tool) => tool.name === 'delete_item')?.annotations?.destructiveHint).toBe(true);
    });

    // The workspace comes from the token, and exposing it as an argument would be a contract error,
    // not a convenience - it would let a model name a workspace the token was never issued for.
    it('exposes no workspaceId argument on any tool', async () => {
        const { tools } = await client.listTools();

        const offenders = tools.filter((tool) => 'workspaceId' in (tool.inputSchema.properties ?? {}));

        expect(offenders.map((tool) => tool.name)).toEqual([]);
    });
});
