import { AppError, SessionUnavailableError, UnauthorizedError } from '@app/errors';
import { isAPIError } from 'better-auth/api';

/**
 * Picks the error a failed session lookup should surface as.
 *
 * Better Auth reports a credential it examined and refused as a 4xx `APIError`. A store it could
 * not reach surfaces either as whatever the database adapter threw or, from `getSession`, as a 5xx
 * `APIError` wrapping it. Only the first means "not signed in" - answering the second with a 401
 * signs a valid session out over a connection blip, such as a sleeping database waking up. Neither
 * carries the original error, because an authentication failure must not leak store internals such
 * as a database error message.
 *
 * @param error anything thrown out of an `auth.api.*` session lookup.
 * @returns a typed error to throw: a caller's own `AppError` unchanged, otherwise a 401 or a 503.
 */
export function toSessionFailure(error: unknown): AppError {
    // A typed error from a hook (e.g. `LockoutService`'s 429) is the caller's own answer, not a
    // failure to look the session up.
    if (error instanceof AppError) return error;

    if (isAPIError(error) && error.statusCode < 500) return new UnauthorizedError();

    return new SessionUnavailableError();
}
