import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '@app/errors';
import type { AuthService } from '@app/auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type CurrentUserContext = { userId: string; email: string };

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

        // `AuthService.resolveSession` owns which error a failed lookup is: a refused credential is
        // a 401, a session store that did not answer is a 503. Deciding that here would mean this
        // package importing Better Auth to recognise its errors, and every Nest app that uses the
        // validation pipe or the MCP guard loading it.
        const { response, headers } = await this.auth.resolveSession({ cookieHeader: cookie });

        if (!response?.user) throw new UnauthorizedError();

        forwardSetCookie({ reply: context.switchToHttp().getResponse<FastifyReply>(), headers });

        request.currentUser = { userId: String(response.user.id), email: String(response.user.email) };

        return true;
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
