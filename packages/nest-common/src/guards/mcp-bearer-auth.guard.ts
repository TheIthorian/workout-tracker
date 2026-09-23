import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AppError, EntityNotFoundError, SessionUnavailableError, UnauthorizedError } from '@app/errors';
import type { McpTokenService, McpTokenValidationResult } from '@app/auth';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from './session-auth.guard.js';

/**
 * The workspace-scoped identity a valid OAuth access token resolves to. `token` is the credential
 * itself, carried alongside the identity it resolved to so `apps/mcp` can forward it as the
 * `Authorization` header on its own calls into `apps/api` - it never holds a database connection to
 * re-derive `userId`/`workspaceId` some other way.
 */
export type McpContext = { userId: string; workspaceId: string; token: string };

/** The request property this guard writes and every MCP tool handler reads. */
export type McpAuthenticatedRequest = FastifyRequest & { mcpContext?: McpContext };

/**
 * DI token an app's own `McpTokenService` provider must also be reachable under, for the same
 * reason `SESSION_AUTH_SERVICE` exists: `@UseGuards(McpBearerAuthGuard)` resolves through Nest's class
 * metatype injector, whose reflected constructor parameter types are unreliable for a type-only
 * imported class under this repo's `swc` transpilation. An explicit `@Inject()` token sidesteps
 * that reflection.
 */
export const MCP_TOKEN_SERVICE = Symbol('MCP_TOKEN_SERVICE');

/** A request carrying both what the handlers read and what the pinning check needs. */
type PatAuthenticatedRequest = AuthenticatedRequest & {
    params?: Record<string, string>;
    mcpContext?: McpContext;
};

const BEARER_PREFIX = 'Bearer ';

/**
 * Authenticates an OAuth access token presented as `Authorization: Bearer <token>`, so `apps/mcp`
 * can reach the REST API as the token's owner without holding a database connection or a session
 * cookie.
 *
 * It attaches `currentUser` as well as `mcpContext`, which is what lets every existing handler and
 * `@CurrentUser()` work unchanged - a handler cannot tell whether it was reached by a browser
 * session or by a token, and deliberately should not be able to.
 *
 * `email` is empty rather than fetched: no handler reads it (only `GET /v1/me` returns a profile,
 * and it loads that from `UsersService`), and issuing a database query per request to populate a
 * field nobody reads would reintroduce exactly the coupling this exists to remove.
 *
 * **The workspace pin is the point.** A grant is pinned to ONE workspace, but membership is scoped
 * by user, so an unpinned token would reach every workspace its owner belongs to. The workspace is
 * a path segment the caller chooses, so the check has to be explicit. A mismatch is an
 * `EntityNotFoundError`, not a 403, for the same reason `WorkspaceMembershipService.require` uses
 * one: a caller who may not see a workspace is told it does not exist.
 */
@Injectable()
export class McpBearerAuthGuard implements CanActivate {
    constructor(@Inject(MCP_TOKEN_SERVICE) private readonly tokens: McpTokenService) {}

    /** Validates the bearer token, pins the workspace, and attaches `currentUser` and `mcpContext`. */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<PatAuthenticatedRequest>();
        const header = request.headers.authorization;

        if (!header?.startsWith(BEARER_PREFIX)) throw new UnauthorizedError();

        const token = header.slice(BEARER_PREFIX.length);
        const validated = await this.validate(token);

        if (!validated) throw new UnauthorizedError();

        const requestedWorkspaceId = request.params?.['workspaceId'];

        if (requestedWorkspaceId !== undefined && requestedWorkspaceId !== validated.workspaceId) {
            throw new EntityNotFoundError('Workspace not found');
        }

        request.currentUser = { userId: validated.userId, email: '' };
        // `token` is part of `McpContext` so `apps/mcp` can forward the credential it was given -
        // every field of `McpContext` must be set here, since this is the only place that builds one.
        request.mcpContext = { ...validated, token };

        return true;
    }

    /**
     * A store that did not answer is a 503, never a 401: the token may be perfectly valid, and a 401
     * tells an MCP client to discard it. A 503 is what `@app/api-client` retries while a sleeping
     * database wakes. A typed `AppError` is passed through rather than downgraded.
     */
    private async validate(token: string): Promise<McpTokenValidationResult | null> {
        try {
            return await this.tokens.validateMcpToken(token);
        } catch (error) {
            if (error instanceof AppError) throw error;

            throw new SessionUnavailableError();
        }
    }
}
