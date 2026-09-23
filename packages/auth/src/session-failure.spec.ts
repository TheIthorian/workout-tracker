import { SessionUnavailableError, TooManyRequestsError, UnauthorizedError } from '@app/errors';
import { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';
import { toSessionFailure } from './session-failure.js';

/**
 * A session lookup that fails has two very different meanings, and the SPA acts on the status
 * code: its interceptor redirects to the sign-in page on a 401, so answering an unreachable store
 * with one signs a visitor out mid-workout over a session row that is still perfectly valid.
 */
describe('toSessionFailure', () => {
    it('is unauthorized when Better Auth refused the credential', () => {
        const failure = toSessionFailure(new APIError('UNAUTHORIZED', { message: 'invalid cookie' }));

        expect(failure).toBeInstanceOf(UnauthorizedError);
        expect(failure.statusCode).toBe(401);
    });

    it('is service-unavailable when the store did not answer', () => {
        const failure = toSessionFailure(new Error('connect ECONNREFUSED 10.0.0.4:5432'));

        expect(failure).toBeInstanceOf(SessionUnavailableError);
        expect(failure.statusCode).toBe(503);
    });

    // `getSession` catches a database failure itself and rethrows it as a 500 `APIError`, which is
    // exactly what a sleeping Postgres produces on its first connection after idling.
    it('is service-unavailable when Better Auth wrapped a store failure', () => {
        const failure = toSessionFailure(new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to get session' }));

        expect(failure).toBeInstanceOf(SessionUnavailableError);
        expect(failure.statusCode).toBe(503);
    });

    it('never carries the store failure into the problem body', () => {
        const failure = toSessionFailure(new Error('connect ECONNREFUSED 10.0.0.4:5432'));

        expect(JSON.stringify(failure.problem)).not.toContain('ECONNREFUSED');
    });

    // LockoutService's hooks run for every Better Auth endpoint, `getSession` included. They filter
    // to `/sign-in/email` today, so a 429 cannot actually reach a session lookup - passing an
    // AppError through unchanged means a typed error is never silently downgraded if that changes.
    it('passes a typed AppError through unchanged', () => {
        const lockout = new TooManyRequestsError('Too many attempts', 'Try again in 15 minutes');

        expect(toSessionFailure(lockout)).toBe(lockout);
    });
});
