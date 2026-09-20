import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { ApiClient } from '@app/api-client';
import { AppError, OAuthErrorCode } from '@app/errors';
import { RESOURCE_URL_GENERATOR, ResourceUrlGenerator, type McpContext } from '@app/nest-common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/load-env.js';
import { buildWwwAuthenticate, MCP_RESOURCE_PATH } from './mcp-resource.js';
import { createMcpServer } from './mcp-server.js';
import { handleMcpRequest } from './mcp-transport.js';
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOL_FACTORY, type McpToolFactory } from './mcp.providers.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * The one route this app serves: the MCP Streamable HTTP endpoint, mounted at `/mcp`.
 *
 * It is an OAuth 2.1 protected resource. The credential arrives in the `Authorization` header and
 * nowhere else — a token in the URL ends up in proxy logs, browser history and referrers, which is
 * why RFC 6750 §2.3 deprecates it and why the path-carried token this endpoint used to accept is
 * gone.
 *
 * `@Res()` without `passthrough` is deliberate - the transport writes the response itself, and
 * `handleMcpRequest` hijacks the reply so Fastify does not also send one.
 */
@Controller()
export class McpController {
    constructor(
        @Inject(MCP_TOOL_FACTORY) private readonly buildTools: McpToolFactory,
        @Inject(MCP_SERVER_INSTRUCTIONS) private readonly instructions: string,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    @All('mcp')
    async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
        const header = request.headers.authorization;

        if (!header?.startsWith(BEARER_PREFIX)) {
            return this.challenge({ reply, error: OAuthErrorCode.InvalidRequest, description: 'No bearer token.' });
        }

        const token = header.slice(BEARER_PREFIX.length).trim();

        // This process holds no database connection, so the only way it can learn its own workspace
        // - or reject a bad token before the MCP transport is created - is to ask `apps/api`.
        //
        // This is NOT once per connection: the transport is stateless (no `sessionIdGenerator`,
        // `mcp-transport.ts`) and `handle` runs `createMcpServer` fresh inside every `@All`
        // dispatch, so the token is resolved again on every JSON-RPC POST - one extra HTTP hop and
        // one more token validation per tool call, on top of the validation the tool's own
        // downstream request performs. Cache it here if that cost ever matters.
        const context = await this.resolveContext({ token });

        if (!context) {
            return this.challenge({
                reply,
                error: OAuthErrorCode.InvalidGrant,
                description: 'The access token is invalid or expired.',
            });
        }

        const server = createMcpServer({ tools: this.buildTools(context), instructions: this.instructions });

        await handleMcpRequest({ request, reply, server });
    }

    /**
     * Resolves a presented access token to the `McpContext` the tool factory needs, by calling
     * `GET /me/mcp-session` (guarded there by `McpBearerAuthGuard`) as that token's bearer. `token`
     * is folded back into the returned context because `ApiClient` needs it on every subsequent
     * per-tool call, and this process has no other way to reproduce it.
     *
     * Null for a credential `apps/api` refused. Any other failure propagates: an API that is down
     * must not be reported to the caller as an invalid token, which would send it round the
     * authorization flow to get a second token that fails identically.
     */
    private async resolveContext({ token }: { token: string }): Promise<McpContext | null> {
        const client = new ApiClient({ baseUrl: String(loadEnv()['API_INTERNAL_BASE_URL']), token });

        try {
            const session = await client.get<{ userId: string; workspaceId: string }>({ path: '/me/mcp-session' });

            return { ...session, token };
        } catch (error) {
            if (error instanceof AppError && error.statusCode === 401) return null;

            throw error;
        }
    }

    /**
     * The 401 that starts the OAuth flow. Written directly rather than thrown, because this route
     * holds the reply and because the header, not the body, is what a client acts on.
     */
    private async challenge({
        reply,
        error,
        description,
    }: {
        reply: FastifyReply;
        error: OAuthErrorCode;
        description: string;
    }): Promise<void> {
        const resourceMetadataUrl = this.urls.mcpUrl({
            path: `/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`,
        });

        await reply
            .status(401)
            .header('www-authenticate', buildWwwAuthenticate({ resourceMetadataUrl, error, description }))
            .send({ error, error_description: description });
    }
}
