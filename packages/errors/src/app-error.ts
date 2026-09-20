import { buildProblem, type ExtendedProblemDetails, type ProblemDetails } from './problem-details.js';

/**
 * Base application error. Every subclass carries the exact problem body the API returns, so the
 * exception filter can serialise `problem` without knowing which error it caught.
 */
export class AppError extends Error {
    constructor(
        message: string,
        public readonly problem: ProblemDetails,
    ) {
        super(message);
        this.name = new.target.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }

    get statusCode(): number {
        return this.problem.status;
    }
}

/** Thrown when a request lacks valid authentication (HTTP 401). */
export class UnauthorizedError extends AppError {
    constructor() {
        super(
            'Unauthorized',
            buildProblem({
                errorName: 'UnauthorizedError',
                title: 'Unauthorized',
                status: 401,
            }),
        );
    }
}

/** Thrown when input is structurally valid but unusable — a malformed file, an unparseable URL (HTTP 400). */
export class InvalidFormatError extends AppError {
    constructor(message: string, detail?: string) {
        super(
            message,
            buildProblem({
                errorName: 'InvalidFormatError',
                title: message,
                status: 400,
                detail,
            }),
        );
    }
}

/** Thrown when request fields fail validation, carrying a field-keyed error dictionary (HTTP 400). */
export class RequestValidationError extends AppError {
    // `declare` narrows the inherited property's type without emitting a field. A real field
    // declaration would be defined as `undefined` after `super()` under ES2022 class-field
    // semantics, clobbering what the base constructor just set.
    declare readonly problem: ExtendedProblemDetails;

    constructor(errors: Record<string, string[]>) {
        const problem: ExtendedProblemDetails = {
            ...buildProblem({
                errorName: 'RequestValidationError',
                title: 'Request validation failed',
                status: 400,
                detail: 'One or more validation errors occurred.',
            }),
            errors: Object.fromEntries(Object.entries(errors).map(([field, messages]) => [field, [...messages]])),
        };

        super('Request validation failed', problem);
    }
}

/** Thrown when the caller is authenticated but not permitted to act (HTTP 403). */
export class ForbiddenActionError extends AppError {
    constructor(message: string, detail?: string) {
        super(
            message,
            buildProblem({
                errorName: 'ForbiddenActionError',
                title: message,
                status: 403,
                detail,
            }),
        );
    }
}

/** Thrown when a requested entity does not exist, or is not visible to the caller (HTTP 404). */
export class EntityNotFoundError extends AppError {
    constructor(message: string, detail?: string) {
        super(
            message,
            buildProblem({
                errorName: 'EntityNotFoundError',
                title: message,
                status: 404,
                detail,
            }),
        );
    }
}

/** Thrown when adding a member who already belongs to the workspace (HTTP 400). */
export class UserAlreadyMemberError extends AppError {
    constructor() {
        super(
            'User already member',
            buildProblem({
                errorName: 'UserAlreadyMemberError',
                title: 'User already member',
                status: 400,
                detail: 'Cannot add member to workspace they are already member of',
            }),
        );
    }
}

/** Thrown when the caller has exceeded a rate or attempt limit (HTTP 429). */
export class TooManyRequestsError extends AppError {
    constructor(message: string, detail?: string) {
        super(
            message,
            buildProblem({
                errorName: 'TooManyRequestsError',
                title: message,
                status: 429,
                detail,
            }),
        );
    }
}

/** Thrown when an operation would collide with something that already exists (HTTP 409). */
export class ConflictError extends AppError {
    constructor(message: string, detail?: string) {
        super(
            message,
            buildProblem({
                errorName: 'ConflictError',
                title: message,
                status: 409,
                detail,
            }),
        );
    }
}

/** Thrown when the requested operation is not valid given the caller's current state (HTTP 400). */
export class InvalidOperationError extends AppError {
    constructor(message: string, detail?: string) {
        super(
            message,
            buildProblem({
                errorName: 'InvalidOperationError',
                title: message,
                status: 400,
                detail,
            }),
        );
    }
}

/**
 * Thrown when a set, or a routine target, carries measurements that do not fit the exercise's
 * tracking type — reps against a `distance_time` exercise, and equivalents (HTTP 400).
 */
export class SetShapeMismatchError extends AppError {
    constructor(message: string, detail?: string) {
        super(
            message,
            buildProblem({
                errorName: 'SetShapeMismatchError',
                title: message,
                status: 400,
                detail,
            }),
        );
    }
}

/** Thrown when the workspace already has a workout session in progress (HTTP 409). */
export class ActiveSessionExistsError extends AppError {
    constructor(detail?: string) {
        super(
            'An active session already exists',
            buildProblem({
                errorName: 'ActiveSessionExistsError',
                title: 'An active session already exists',
                status: 409,
                detail,
            }),
        );
    }
}

/**
 * Thrown when an image is a real image but larger than anything worth decoding, by bytes or by
 * pixel dimensions (HTTP 413). `detail` says which limit was hit.
 */
export class ImageTooLargeError extends AppError {
    constructor(detail: string) {
        super(
            'Image is too large',
            buildProblem({
                errorName: 'ImageTooLargeError',
                title: 'Image is too large',
                status: 413,
                detail,
            }),
        );
    }
}

/**
 * Thrown when the environment a process booted with is missing or contradictory. Always fatal at
 * startup; the status code exists only because every `AppError` carries one.
 */
export class ConfigurationError extends AppError {
    constructor(message: string) {
        super(
            message,
            buildProblem({
                errorName: 'ConfigurationError',
                title: message,
                status: 500,
            }),
        );
    }
}

/**
 * Thrown when the session store could not be reached, so whether the caller is signed in is
 * unknown rather than answered (HTTP 503).
 *
 * Distinct from {@link UnauthorizedError} on purpose: a client that treats every failure to resolve
 * a session as "signed out" logs a visitor out on a database blip. The detail is deliberately
 * generic - a caller learns to retry, never anything about the store.
 */
export class SessionUnavailableError extends AppError {
    constructor() {
        super(
            'Session unavailable',
            buildProblem({
                errorName: 'SessionUnavailableError',
                title: 'Session unavailable',
                status: 503,
                detail: 'Could not verify the session right now. Please try again.',
            }),
        );
    }
}

/**
 * The OAuth 2.0 error codes this project emits, as `error` in a token-endpoint body or an `error=`
 * redirect parameter. `UnsupportedClient` is not in RFC 6749 — it names this server's own rule that
 * a client must publish a Client ID Metadata Document on an allowlisted domain, which no registered
 * code describes.
 */
export enum OAuthErrorCode {
    InvalidRequest = 'invalid_request',
    InvalidClient = 'invalid_client',
    InvalidGrant = 'invalid_grant',
    UnauthorizedClient = 'unauthorized_client',
    UnsupportedGrantType = 'unsupported_grant_type',
    UnsupportedResponseType = 'unsupported_response_type',
    InvalidScope = 'invalid_scope',
    AccessDenied = 'access_denied',
    ServerError = 'server_error',
    UnsupportedClient = 'unsupported_client',
}

/**
 * Thrown when an OAuth request fails in a way the protocol itself defines an answer for.
 *
 * It carries a problem body like every other error here, so an unguarded path still renders RFC
 * 7807, but the OAuth endpoints are served through a filter that reads {@link oauthError} instead:
 * RFC 6749 §5.2 fixes the shape of a token-endpoint failure, and a client parsing that shape cannot
 * read a problem document.
 */
export class OAuthProtocolError extends AppError {
    constructor(
        public readonly oauthError: OAuthErrorCode,
        public readonly errorDescription: string,
        status = 400,
    ) {
        super(
            errorDescription,
            buildProblem({
                errorName: 'OAuthProtocolError',
                title: oauthError,
                status,
                detail: errorDescription,
            }),
        );
    }
}
