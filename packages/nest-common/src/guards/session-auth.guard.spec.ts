import type { ExecutionContext } from '@nestjs/common';
import { TooManyRequestsError, UnauthorizedError } from '@app/errors';
import type { AuthService } from '@app/auth';
import { describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard, type AuthenticatedRequest } from './session-auth.guard.js';

describe('SessionAuthGuard', () => {
    it('attaches currentUser and returns true for a valid session', async () => {
        const getSession = vi.fn().mockResolvedValue({ user: { id: 'user-1', email: 'a@example.com' } });
        const { guard, context, request } = makeGuard({ getSession, cookie: 'session=abc' });

        const result = await guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.currentUser).toEqual({ userId: 'user-1', email: 'a@example.com' });
        expect(getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
    });

    it('throws UnauthorizedError when there is no cookie header', async () => {
        const getSession = vi.fn();
        const { guard, context } = makeGuard({ getSession, cookie: undefined });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedError);
        expect(getSession).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when getSession resolves to null', async () => {
        const getSession = vi.fn().mockResolvedValue(null);
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
});

function makeGuard({ getSession, cookie }: { getSession: ReturnType<typeof vi.fn>; cookie: string | undefined }): {
    guard: SessionAuthGuard;
    context: ExecutionContext;
    request: AuthenticatedRequest;
} {
    const request = { headers: { cookie } } as unknown as AuthenticatedRequest;
    const authStub = { instance: { api: { getSession } } } as unknown as AuthService;
    const guard = new SessionAuthGuard(authStub);
    const context = {
        switchToHttp: () => ({
            getRequest: () => request,
        }),
    } as unknown as ExecutionContext;

    return { guard, context, request };
}
