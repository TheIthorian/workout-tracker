import {
    getCurrentUserToolArgsSchema,
    listWorkspacesToolArgsSchema,
    type UserResponse,
    type WorkspaceResponse,
} from '@app/api-contract';
import type { ApiClient } from '@app/api-client';
import type { McpContext } from '@app/nest-common';
import { defineTool, type McpToolDefinition } from '../tool-definition.js';
import { serializeToolResult } from '../tool-execution.js';

/**
 * Tools that answer "who am I, and where am I" - the first calls a model makes on connecting.
 *
 * Neither is wrapped in `runToolCaught`: a failure here means the token itself is bad, which the
 * model cannot correct by retrying with different arguments, so it should reach the client as an
 * `isError` result rather than as a readable problem body.
 */
export function buildSessionTools({
    context,
    client,
}: {
    context: McpContext;
    client: ApiClient;
}): McpToolDefinition[] {
    return [
        defineTool({
            methodName: 'GetCurrentUser',
            description: 'Returns the authenticated user profile and workspace memberships (read-only).',
            inputSchema: getCurrentUserToolArgsSchema,
            handler: async () => serializeToolResult({ body: await client.get<UserResponse>({ path: '/me' }) }),
        }),
        defineTool({
            methodName: 'ListWorkspaces',
            description: 'Returns the workspace this MCP token is scoped to (read-only).',
            inputSchema: listWorkspacesToolArgsSchema,
            // A single-element array, not a real list. The token is pinned to ONE workspace, so
            // `GET /workspaces` - which returns every workspace its owner belongs to - would
            // advertise workspaces this token must not reach. Fetching the pinned one by id is the
            // only answer consistent with the pin.
            handler: async () =>
                serializeToolResult({
                    body: [await client.get<WorkspaceResponse>({ path: `/workspaces/${context.workspaceId}` })],
                }),
        }),
    ];
}
