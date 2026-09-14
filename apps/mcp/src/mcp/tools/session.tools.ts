import { getCurrentUserToolArgsSchema, type UserResponse } from '@app/api-contract';
import type { ApiClient } from '@app/api-client';
import { defineTool, type McpToolDefinition } from '../tool-definition.js';
import { serializeToolResult } from '../tool-execution.js';

/**
 * Tools that answer "who am I, and where am I" - the first calls a model makes on connecting.
 *
 * Neither is wrapped in `runToolCaught`: a failure here means the token itself is bad, which the
 * model cannot correct by retrying with different arguments, so it should reach the client as an
 * `isError` result rather than as a readable problem body.
 */
export function buildSessionTools({ client }: { client: ApiClient }): McpToolDefinition[] {
    return [
        defineTool({
            methodName: 'GetCurrentUser',
            description: 'Returns the authenticated user profile (read-only).',
            inputSchema: getCurrentUserToolArgsSchema,
            handler: async () => {
                const { userId, displayName, email } = await client.get<UserResponse>({ path: '/me' });

                return serializeToolResult({ body: { userId, displayName, email } });
            },
        }),
    ];
}
