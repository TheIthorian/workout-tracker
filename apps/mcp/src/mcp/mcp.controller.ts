import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { ApiClient } from '@app/api-client';
import { extractMcpTokenFromPath } from '@app/auth';
import { UnauthorizedError } from '@app/errors';
import type { McpContext } from '@app/nest-common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/load-env.js';
import { createMcpServer } from './mcp-server.js';
import { handleMcpRequest } from './mcp-transport.js';
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOL_FACTORY, type McpToolFactory } from './mcp.providers.js';

/**
 * The one route this app serves: the MCP Streamable HTTP endpoint, mounted at `/mcp/{token}`. The
 * credential travels in the path rather than a header because that is the only place an MCP client
 * configured with a bare URL can carry one.
 *
 * `@Res()` without `passthrough` is deliberate - the transport writes the response itself, and
 * `handleMcpRequest` hijacks the reply so Fastify does not also send one.
 */
@Controller()
export class McpController {
    constructor(
        @Inject(MCP_TOOL_FACTORY) private readonly buildTools: McpToolFactory,
        @Inject(MCP_SERVER_INSTRUCTIONS) private readonly instructions: string,
    ) {}

    @All('mcp/:token')
    async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
        const token = extractMcpTokenFromPath(stripQueryString(request.url ?? ''));

        if (!token) throw new UnauthorizedError();

        // This process holds no database connection, so the only way it can learn its own workspace
        // - or reject a bad token before the MCP transport is created - is to ask `apps/api`. A
        // non-200 here (`ApiClient.get` throws an `AppError` built from the API's problem body)
        // propagates to `AppErrorFilter`, which renders it as a 401.
        //
        // This is NOT once per connection: the transport is stateless (no `sessionIdGenerator`,
        // `mcp-transport.ts`) and `handle` runs `createMcpServer` fresh inside every `@All`
        // dispatch, so the token is resolved again on every JSON-RPC POST - one extra HTTP hop and
        // one more token validation per tool call, on top of the validation the tool's own
        // downstream request performs. Cache it here if that cost ever matters.
        const context = await resolveMcpContext(token);

        const server = createMcpServer({ tools: this.buildTools(context), instructions: this.instructions });

        await handleMcpRequest({ request, reply, server });
    }
}

/**
 * Resolves a presented MCP token to the `McpContext` the tool factory needs, by calling
 * `GET /me/mcp-session` (guarded there by `McpPatAuthGuard`) as that token's bearer. `token` is
 * folded back into the returned context because `ApiClient` needs it on every subsequent per-tool
 * call, and this process has no other way to reproduce it.
 */
async function resolveMcpContext(token: string): Promise<McpContext> {
    const client = new ApiClient({ baseUrl: String(loadEnv()['API_INTERNAL_BASE_URL']), token });
    const session = await client.get<{ userId: string; workspaceId: string }>({ path: '/me/mcp-session' });

    return { ...session, token };
}

/**
 * `FastifyRequest.url` carries the query string. Stripping it keeps `/mcp/{token}?sessionId=...`
 * resolving to `{token}` rather than to a token that can never match a stored hash.
 */
function stripQueryString(url: string): string {
    const queryStart = url.indexOf('?');
    return queryStart === -1 ? url : url.slice(0, queryStart);
}
