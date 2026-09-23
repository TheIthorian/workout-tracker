import { describe, expect, it, vi } from 'vitest';
import { EntityNotFoundError, SessionUnavailableError, TooManyRequestsError, UnauthorizedError } from '@app/errors';
import { McpBearerAuthGuard } from './mcp-bearer-auth.guard.js';

const validated = { userId: 'user-1', workspaceId: 'ws-1' };
const tokens = { validateMcpToken: async (token: string) => (token === 'good' ? validated : null) };

function contextFor({ authorization, params = {} }: { authorization?: string; params?: Record<string, string> } = {}) {
    const request = { headers: { authorization }, params, currentUser: undefined, mcpContext: undefined };
    return { switchToHttp: () => ({ getRequest: () => request }), request };
}

describe('McpBearerAuthGuard', () => {
    it('rejects a request with no bearer token', async () => {
        const guard = new McpBearerAuthGuard(tokens as never);
        const context = contextFor();

        await expect(guard.canActivate(context as never)).rejects.toThrow(UnauthorizedError);
    });

    it('attaches currentUser and mcpContext for a valid token', async () => {
        const guard = new McpBearerAuthGuard(tokens as never);
        const context = contextFor({ authorization: 'Bearer good' });

        await expect(guard.canActivate(context as never)).resolves.toBe(true);
        expect(context.request.currentUser).toEqual({ userId: 'user-1', email: '' });
        expect(context.request.mcpContext).toEqual({ ...validated, token: 'good' });
    });

    // The whole reason this guard exists rather than reusing SessionAuthGuard.
    it('refuses a workspace the token was not issued for, as a 404', async () => {
        const guard = new McpBearerAuthGuard(tokens as never);
        const context = contextFor({ authorization: 'Bearer good', params: { workspaceId: 'ws-2' } });

        await expect(guard.canActivate(context as never)).rejects.toThrow(EntityNotFoundError);
    });

    it('allows the workspace the token was issued for', async () => {
        const guard = new McpBearerAuthGuard(tokens as never);
        const context = contextFor({ authorization: 'Bearer good', params: { workspaceId: 'ws-1' } });

        await expect(guard.canActivate(context as never)).resolves.toBe(true);
    });

    it('allows a route with no workspaceId param', async () => {
        const guard = new McpBearerAuthGuard(tokens as never);
        const context = contextFor({ authorization: 'Bearer good' });

        await expect(guard.canActivate(context as never)).resolves.toBe(true);
    });

    it('rejects an unknown or revoked token', async () => {
        const guard = new McpBearerAuthGuard(tokens as never);
        const context = contextFor({ authorization: 'Bearer bad' });

        await expect(guard.canActivate(context as never)).rejects.toThrow(UnauthorizedError);
    });

    // A sleeping database refuses the first connection after idling. Answering that with a 401
    // would make the MCP client drop a valid token; a 503 is what `@app/api-client` retries.
    it('throws SessionUnavailableError, not the original error, when validation rejects', async () => {
        const validateMcpToken = vi.fn().mockRejectedValue(new Error('database unreachable'));
        const guard = new McpBearerAuthGuard({ validateMcpToken } as never);
        const context = contextFor({ authorization: 'Bearer good' });

        await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(SessionUnavailableError);
    });

    // The one property that distinguishes this guard's `validate` from a blanket try/catch: a
    // typed AppError is passed through unflattened rather than downgraded to a generic 401.
    it('passes a thrown AppError through unflattened rather than downgrading it to 401', async () => {
        const lockoutError = new TooManyRequestsError('Too many attempts', 'Try again in 15 minutes');
        const validateMcpToken = vi.fn().mockRejectedValue(lockoutError);
        const guard = new McpBearerAuthGuard({ validateMcpToken } as never);
        const context = contextFor({ authorization: 'Bearer good' });

        await expect(guard.canActivate(context as never)).rejects.toBe(lockoutError);
    });
});
