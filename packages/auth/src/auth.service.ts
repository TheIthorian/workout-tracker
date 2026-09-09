import { AppError } from '@app/errors';
import type { Logger } from '@app/logger';
import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { AUTH_SCHEMA, buildAuthOptions, type AuthConfig } from './auth-options.js';
import { LockoutService } from './lockout.service.js';
import type { SignUpParams, UserProvisioningService } from './user-provisioning.service.js';

/**
 * A framework-agnostic HTTP response shape. Deliberately not a Fetch `Response` (which is
 * immutable to construct incrementally) nor tied to any web framework's request/response types -
 * callers wrap these into whatever their own runtime expects.
 */
export type AuthHandlerResponse = {
    status: number;
    headers: Headers;
    body?: unknown;
};

export type LoginParams = { email: string; password: string };
export type LogoutParams = {
    /** The incoming request's `Cookie` header, forwarded so Better Auth can find the session to end. */
    cookieHeader?: string;
};

export type AuthServiceDeps = {
    config: AuthConfig;
    /** The transactional user-creation service `signup()` delegates to - see its own class doc. */
    userProvisioning: UserProvisioningService;
    logger?: Logger;
};

/**
 * Better Auth's configured session/sign-in server, wired to the four tables in
 * `packages/db/src/schema/auth.ts`, plus the framework-agnostic `login`/`logout`/`signup` handlers
 * controllers call into.
 *
 * This class is deliberately NOT the entry point for creating new users - see
 * `UserProvisioningService`'s class doc for why - `signup()` here only translates that service's
 * result (or a thrown `AppError`) into an `AuthHandlerResponse`.
 */
export class AuthService {
    /**
     * The underlying Better Auth instance, exposed for a caller (or test) that needs Better Auth's
     * own `api`/`$context` directly - e.g. session lookups this class doesn't wrap.
     */
    public readonly instance: Auth<BetterAuthOptions>;

    private readonly userProvisioning: UserProvisioningService;

    constructor({ config, userProvisioning }: AuthServiceDeps) {
        this.userProvisioning = userProvisioning;

        // Built internally rather than injected: nothing else in this package or its callers needs
        // a `LockoutService` of its own, so constructing it here keeps the public constructor
        // shaped around what a caller actually configures (`AuthConfig`), not an internal
        // implementation detail.
        const lockout = new LockoutService({ db: config.db });
        const options = buildAuthOptions(config);

        // Typed explicitly as `BetterAuthOptions` rather than left to inference: `betterAuth`'s
        // return type is generic over its options object, and `instance` is typed
        // `Auth<BetterAuthOptions>` (not the narrower literal type TypeScript would otherwise infer
        // from a fully-literal argument) so a caller sees the general Better Auth API, not one
        // pinned to this exact options shape.
        const authOptions: BetterAuthOptions = {
            ...options,
            // Spread `options.emailAndPassword` (not replaced wholesale): this object is exactly
            // where `disableSignUp` below lives, and `disableSignUp` is load-bearing for the
            // shadow-row invariant this class's doc describes. Replacing the whole object instead
            // of spreading it would silently discard any option `buildAuthOptions` adds to
            // `emailAndPassword` in future, with no test to catch the loss.
            emailAndPassword: {
                ...options.emailAndPassword,
                // `buildAuthOptions` always sets this, but the spread above types it as optional
                // (Better Auth's own type does too) - restated explicitly so `authOptions` still
                // satisfies `BetterAuthOptions` without widening `options.emailAndPassword` itself.
                enabled: true,
                // LOAD-BEARING, not documentation-only: `UserProvisioningService.signUp` is the
                // only path that validates the request and runs any per-account bootstrapping in
                // the same transaction as the user insert. Better Auth's own `/sign-up/email` route
                // bypasses both, so if it were ever reachable it would create bare `user` rows that
                // skipped validation and left the account half-provisioned.
                //
                // Setting `disableSignUp` here means the CONFIG refuses account creation through
                // that route regardless of which routes a caller mounts later - it fails safe even
                // if the comment on `UserProvisioningService` goes unread.
                //
                // Sign-in is unaffected: `sign-in.mjs`'s email/password handler only checks
                // `emailAndPassword.enabled` and never reads `disableSignUp`.
                disableSignUp: true,
            },
            database: drizzleAdapter(config.db, { provider: 'pg', schema: AUTH_SCHEMA }),
            // See `LockoutService`'s class doc for why per-account lockout needs its own hooks
            // rather than `rateLimit` alone: `login()` below invokes `auth.api.signInEmail`
            // directly, which `rateLimit` never covers.
            hooks: {
                before: lockout.createBeforeHook(),
                after: lockout.createAfterHook(),
            },
        };

        this.instance = betterAuth(authOptions);
    }

    /**
     * Logs a user in and issues a session cookie.
     *
     * Delegates to Better Auth's own `/sign-in/email` endpoint via `auth.api.signInEmail`, asking
     * for the result `asResponse: true` so the real `Set-Cookie` header (with whatever cookie
     * attributes this class's constructor computed) comes back untouched, and a bad-credentials
     * rejection surfaces as a 401 response rather than a thrown `APIError`.
     */
    async login(params: LoginParams): Promise<AuthHandlerResponse> {
        try {
            const response = await this.instance.api.signInEmail({
                body: { email: params.email, password: params.password },
                asResponse: true,
            });

            return toHandlerResponse(response);
        } catch (error) {
            // The account-lockout `hooks.before` in `LockoutService` throws a typed `AppError`
            // rather than returning a response - see its class doc for why - so unlike a
            // bad-credentials 401 (which Better Auth's own dispatch already turns into a
            // `Response` before this call returns), that throw surfaces here as a rejected promise
            // and must be translated by hand, the same way `signup()` below already translates one.
            if (error instanceof AppError) {
                return {
                    status: error.problem.status,
                    headers: new Headers({ 'content-type': 'application/problem+json' }),
                    body: error.problem,
                };
            }
            throw error;
        }
    }

    /**
     * Logs the current user out, clearing the session cookie. Delegates to Better Auth's
     * `/sign-out` endpoint, which always responds 200 and clears the cookie even when the caller
     * had no valid session.
     */
    async logout(params: LogoutParams): Promise<AuthHandlerResponse> {
        const response = await this.instance.api.signOut({
            headers: new Headers(params.cookieHeader ? { cookie: params.cookieHeader } : {}),
            asResponse: true,
        });

        return toHandlerResponse(response);
    }

    /**
     * Creates a new account. Delegates the actual creation to `UserProvisioningService.signUp`;
     * this method only translates its result (or a thrown `AppError`) into an
     * `AuthHandlerResponse` so the caller gets a status/body pair rather than a thrown validation
     * error. Anything that is not an `AppError` is rethrown, because it is not this package's job
     * to pick a status code for an error it does not recognise.
     */
    async signup(params: SignUpParams): Promise<AuthHandlerResponse> {
        try {
            const { id } = await this.userProvisioning.signUp(params);

            return { status: 200, headers: new Headers(), body: { id } };
        } catch (error) {
            if (error instanceof AppError) {
                return {
                    status: error.problem.status,
                    headers: new Headers({ 'content-type': 'application/problem+json' }),
                    body: error.problem,
                };
            }
            throw error;
        }
    }
}

async function toHandlerResponse(response: Response): Promise<AuthHandlerResponse> {
    const body = await response
        .clone()
        .json()
        .catch(() => undefined);

    return { status: response.status, headers: response.headers, body };
}
