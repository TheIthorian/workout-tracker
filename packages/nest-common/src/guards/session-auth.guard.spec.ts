import type { ExecutionContext } from '@nestjs/common';
import { SessionUnavailableError, UnauthorizedError } from '@app/errors';
import type { AuthService } from '@app/auth';
import { describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard, type AuthenticatedRequest } from './session-auth.guard.js';

describe('SessionAuthGuard', () => {
    it('attaches currentUser and returns true for a valid session', async () => {
        const resolveSession = vi
            .fn()
            .mockResolvedValue(sessionResult({ user: { id: 'user-1', email: 'a@example.com' } }));
        const { guard, context, request } = makeGuard({ resolveSession, cookie: 'session=abc' });

        const result = await guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.currentUser).toEqual({ userId: 'user-1', email: 'a@example.com' });
        expect(resolveSession).toHaveBeenCalledWith({ cookieHeader: 'session=abc' });
    });

    it('throws UnauthorizedError when there is no cookie header', async () => {
        const resolveSession = vi.fn();
        const { guard, context } = makeGuard({ resolveSession, cookie: undefined });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
        expect(resolveSession).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when the lookup finds no session', async () => {
        const resolveSession = vi.fn().mockResolvedValue(sessionResult({ user: null }));
        const { guard, context } = makeGuard({ resolveSession, cookie: 'session=stale' });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    // Which error a failed lookup is belongs to `AuthService.resolveSession` (see
    // `toSessionFailure`), so that this package never has to recognise a Better Auth error - and
    // never has to import Better Auth. The guard's job is to let it through untouched: downgrading
    // a 503 to 401 here is what would sign a valid session out over a database blip.
    it('propagates the error a failed lookup threw rather than flattening it to 401', async () => {
        const storeFailure = new SessionUnavailableError();
        const resolveSession = vi.fn().mockRejectedValue(storeFailure);
        const { guard, context } = makeGuard({ resolveSession, cookie: 'session=abc' });

        await expect(guard.canActivate(context)).rejects.toBe(storeFailure);
    });

    // Better Auth slides a session forward by reissuing the cookie with a fresh `Max-Age`. Dropping
    // that header leaves the database row extended but the browser's cookie expiring on its
    // original `Max-Age`, which signs a visitor out `expiresIn` after sign-in however active they
    // were - so forwarding it is the whole mechanism that keeps anyone signed in.
    it('forwards a refreshed session cookie onto the reply', async () => {
        const refreshed = 'better-auth.session_token=fresh; Path=/; HttpOnly; Max-Age=2592000';
        const resolveSession = vi
            .fn()
            .mockResolvedValue(
                sessionResult({ user: { id: 'user-1', email: 'a@example.com' }, setCookie: [refreshed] }),
            );
        const { guard, context, setHeader } = makeGuard({ resolveSession, cookie: 'session=abc' });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(setHeader).toHaveBeenCalledWith('set-cookie', [refreshed]);
    });

    // Set in one call as an array, never one `reply.header()` per entry: Fastify overwrites a
    // repeated header rather than appending, so a per-entry loop would keep only the last cookie.
    it('forwards every refreshed cookie in a single reply.header call', async () => {
        const cookies = ['better-auth.session_token=fresh; Path=/', 'better-auth.session_data=cached; Path=/'];
        const resolveSession = vi
            .fn()
            .mockResolvedValue(sessionResult({ user: { id: 'user-1', email: 'a@example.com' }, setCookie: cookies }));
        const { guard, context, setHeader } = makeGuard({ resolveSession, cookie: 'session=abc' });

        await guard.canActivate(context);

        expect(setHeader).toHaveBeenCalledTimes(1);
        expect(setHeader).toHaveBeenCalledWith('set-cookie', cookies);
    });

    it('leaves the reply untouched when the session was not refreshed', async () => {
        const resolveSession = vi
            .fn()
            .mockResolvedValue(sessionResult({ user: { id: 'user-1', email: 'a@example.com' } }));
        const { guard, context, setHeader } = makeGuard({ resolveSession, cookie: 'session=abc' });

        await guard.canActivate(context);

        expect(setHeader).not.toHaveBeenCalled();
    });
});

function makeGuard({
    resolveSession,
    cookie,
}: {
    resolveSession: ReturnType<typeof vi.fn>;
    cookie: string | undefined;
}): {
    guard: SessionAuthGuard;
    context: ExecutionContext;
    request: AuthenticatedRequest;
    setHeader: ReturnType<typeof vi.fn>;
} {
    const request = { headers: { cookie } } as unknown as AuthenticatedRequest;
    const setHeader = vi.fn();
    const reply = { header: setHeader };
    const authStub = { resolveSession } as unknown as AuthService;
    const guard = new SessionAuthGuard(authStub);
    const context = {
        switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => reply,
        }),
    } as unknown as ExecutionContext;

    return { guard, context, request, setHeader };
}

function sessionResult({
    user,
    setCookie = [],
}: {
    user: { id: string; email: string } | null;
    setCookie?: string[];
}): {
    headers: Headers;
    response: { user: { id: string; email: string } } | null;
} {
    const headers = new Headers();

    for (const cookie of setCookie) headers.append('set-cookie', cookie);

    return { headers, response: user === null ? null : { user } };
}
