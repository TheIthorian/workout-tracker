import type { ExecutionContext } from '@nestjs/common';
import { TooManyRequestsError, UnauthorizedError } from '@app/errors';
import type { AuthService } from '@app/auth';
import { describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard, type AuthenticatedRequest } from './session-auth.guard.js';

describe('SessionAuthGuard', () => {
    it('attaches currentUser and returns true for a valid session', async () => {
        const getSession = vi.fn().mockResolvedValue(sessionResult({ user: { id: 'user-1', email: 'a@example.com' } }));
        const { guard, context, request } = makeGuard({ getSession, cookie: 'session=abc' });

        const result = await guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.currentUser).toEqual({ userId: 'user-1', email: 'a@example.com' });
        expect(getSession).toHaveBeenCalledWith({ headers: expect.any(Headers), returnHeaders: true });
    });

    it('throws UnauthorizedError when there is no cookie header', async () => {
        const getSession = vi.fn();
        const { guard, context } = makeGuard({ getSession, cookie: undefined });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
        expect(getSession).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when getSession resolves to null', async () => {
        const getSession = vi.fn().mockResolvedValue(sessionResult({ user: null }));
        const { guard, context } = makeGuard({ getSession, cookie: 'session=stale' });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    // Finding 1 (fix round 1): a malformed cookie, a session-store error, or any other rejection
    // from getSession must not escape as an unhandled 500 - this guard promises 401 on every
    // failure path. The original error is not surfaced to the caller (only a generic
    // UnauthorizedError is thrown) because an authentication failure must not leak store
    // internals such as a database error message.
    it('throws UnauthorizedError, not the original error, when getSession rejects', async () => {
        const getSession = vi.fn().mockRejectedValue(new Error('session store unreachable'));
        const { guard, context } = makeGuard({ getSession, cookie: 'session=abc' });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    // LockoutService's hooks run for every Better Auth endpoint (including getSession), but they
    // filter to `/sign-in/email` and return immediately otherwise (see lockout.service.ts), so a
    // TooManyRequestsError cannot actually reach getSession today. This guard still passes an
    // AppError through unflattened rather than swallowing it to 401, so a genuine 429 (or any other
    // typed error) is never silently downgraded if that ever changes.
    it('passes a thrown AppError through unflattened rather than downgrading it to 401', async () => {
        const lockoutError = new TooManyRequestsError('Too many attempts', 'Try again in 15 minutes');
        const getSession = vi.fn().mockRejectedValue(lockoutError);
        const { guard, context } = makeGuard({ getSession, cookie: 'session=abc' });

        await expect(guard.canActivate(context)).rejects.toBe(lockoutError);
    });

    // Better Auth slides a session forward by reissuing the cookie with a fresh `Max-Age`. Dropping
    // that header leaves the database row extended but the browser's cookie expiring on its
    // original `Max-Age`, which signs a visitor out `expiresIn` after sign-in however active they
    // were - so forwarding it is the whole mechanism that keeps anyone signed in.
    it('forwards a refreshed session cookie onto the reply', async () => {
        const refreshed = 'better-auth.session_token=fresh; Path=/; HttpOnly; Max-Age=2592000';
        const getSession = vi
            .fn()
            .mockResolvedValue(
                sessionResult({ user: { id: 'user-1', email: 'a@example.com' }, setCookie: [refreshed] }),
            );
        const { guard, context, setHeader } = makeGuard({ getSession, cookie: 'session=abc' });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(setHeader).toHaveBeenCalledWith('set-cookie', [refreshed]);
    });

    // Set in one call as an array, never one `reply.header()` per entry: Fastify overwrites a
    // repeated header rather than appending, so a per-entry loop would keep only the last cookie.
    it('forwards every refreshed cookie in a single reply.header call', async () => {
        const cookies = ['better-auth.session_token=fresh; Path=/', 'better-auth.session_data=cached; Path=/'];
        const getSession = vi
            .fn()
            .mockResolvedValue(sessionResult({ user: { id: 'user-1', email: 'a@example.com' }, setCookie: cookies }));
        const { guard, context, setHeader } = makeGuard({ getSession, cookie: 'session=abc' });

        await guard.canActivate(context);

        expect(setHeader).toHaveBeenCalledTimes(1);
        expect(setHeader).toHaveBeenCalledWith('set-cookie', cookies);
    });

    it('leaves the reply untouched when the session was not refreshed', async () => {
        const getSession = vi.fn().mockResolvedValue(sessionResult({ user: { id: 'user-1', email: 'a@example.com' } }));
        const { guard, context, setHeader } = makeGuard({ getSession, cookie: 'session=abc' });

        await guard.canActivate(context);

        expect(setHeader).not.toHaveBeenCalled();
    });
});

function makeGuard({ getSession, cookie }: { getSession: ReturnType<typeof vi.fn>; cookie: string | undefined }): {
    guard: SessionAuthGuard;
    context: ExecutionContext;
    request: AuthenticatedRequest;
    setHeader: ReturnType<typeof vi.fn>;
} {
    const request = { headers: { cookie } } as unknown as AuthenticatedRequest;
    const setHeader = vi.fn();
    const reply = { header: setHeader };
    const authStub = { instance: { api: { getSession } } } as unknown as AuthService;
    const guard = new SessionAuthGuard(authStub);
    const context = {
        switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => reply,
        }),
    } as unknown as ExecutionContext;

    return { guard, context, request, setHeader };
}

/** The `{ headers, response }` pair `getSession` resolves to under `returnHeaders: true`. */
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
