import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AppError, SessionUnavailableError, UnauthorizedError } from '@app/errors';
import { isCredentialRejection, type AuthService } from '@app/auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type CurrentUserContext = { userId: string; email: string };

/**
 * What `getSession` resolves to with `returnHeaders: true`: the session body it would otherwise
 * return on its own, plus the response headers Better Auth built alongside it.
 */
type ResolvedSession = {
    headers: Headers;
    response: Awaited<ReturnType<AuthService['instance']['api']['getSession']>>;
};

/** The request property the guard writes and `@CurrentUser()` reads. */
export type AuthenticatedRequest = FastifyRequest & { currentUser?: CurrentUserContext };

/**
 * DI token an app's own `AuthService` provider must also be reachable under for
 * `SessionAuthGuard` to resolve through Nest's container. A plain constructor-typed
 * `AuthService` param can't be used here: this guard is applied via `@UseGuards(SessionAuthGuard)`,
 * which Nest resolves through its class-metatype injector (see `GuardsContextCreator`), a
 * separate path from ordinary provider injection that relies on reflected constructor parameter
 * types - and those are unreliable for a type-only imported class under this repo's `swc`
 * transpilation. An explicit `@Inject()` token sidesteps that reflection entirely. The consuming
 * app aliases its own `AUTH_SERVICE` provider onto this token (e.g. `{ provide:
 * SESSION_AUTH_SERVICE, useExisting: AUTH_SERVICE }`).
 */
export const SESSION_AUTH_SERVICE = Symbol('SESSION_AUTH_SERVICE');

/**
 * Requires a valid Better Auth session cookie, and attaches the resolved user to the request so
 * `@CurrentUser()` can read it.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
    constructor(@Inject(SESSION_AUTH_SERVICE) private readonly auth: AuthService) {}

    /**
     * Resolves the Better Auth session from the request cookie, attaching `currentUser` on success
     * and forwarding any refreshed session cookie onto the reply.
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const cookie = request.headers.cookie;

        if (!cookie) throw new UnauthorizedError();

        const { response, headers } = await this.resolveSession(cookie);

        if (!response?.user) throw new UnauthorizedError();

        forwardSetCookie({ reply: context.switchToHttp().getResponse<FastifyReply>(), headers });

        request.currentUser = { userId: String(response.user.id), email: String(response.user.email) };

        return true;
    }

    /**
     * No rejection from `getSession` escapes as an unhandled 500, but they do not all mean the
     * same thing. A credential Better Auth examined and refused (a malformed cookie) is a 401. A
     * session store that did not answer - a dropped connection, an exhausted pool - is a 503:
     * whether the caller is signed in is unknown, and a 401 there tells the browser to sign a
     * perfectly valid session out. Neither carries the original error, because an authentication
     * failure must not leak store internals such as a database error message. A typed `AppError`
     * (e.g. a 429 from `LockoutService`'s hooks, which run for every Better Auth endpoint
     * including `getSession`, though they currently no-op outside `/sign-in/email`) is passed
     * through unflattened, so a future typed error is never silently swallowed.
     */
    private async resolveSession(cookie: string): Promise<ResolvedSession> {
        try {
            return await this.auth.instance.api.getSession({
                headers: new Headers({ cookie }),
                // Better Auth slides a session forward once it is older than `session.updateAge`:
                // it extends `expires_at` in the database AND emits a fresh `Set-Cookie` carrying
                // the new `Max-Age`. Without `returnHeaders` that header is dropped, so the row
                // slides but the browser's cookie keeps the `Max-Age` it was issued at sign-in and
                // the user is signed out `session.expiresIn` after signing in however active they
                // were.
                returnHeaders: true,
            });
        } catch (error) {
            if (error instanceof AppError) throw error;

            if (isCredentialRejection(error)) throw new UnauthorizedError();

            throw new SessionUnavailableError();
        }
    }
}

/**
 * Copies any `Set-Cookie` Better Auth produced onto the outgoing reply.
 *
 * Uses `Headers.getSetCookie()` and sets the whole array in one call: the `Headers` iterator never
 * combines multiple `Set-Cookie` entries into one comma-joined string, so a loop calling
 * `reply.header()` per entry would have the last entry overwrite the others.
 */
function forwardSetCookie({ reply, headers }: { reply: FastifyReply; headers: Headers }): void {
    const setCookie = headers.getSetCookie();

    if (setCookie.length > 0) reply.header('set-cookie', setCookie);
}
