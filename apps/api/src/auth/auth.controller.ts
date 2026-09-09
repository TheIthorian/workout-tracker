import { Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { loginRequestSchema, signupRequestSchema, type LoginRequest, type SignupRequest } from '@app/api-contract';
import type { AuthHandlerResponse, AuthService } from '@app/auth';
import { buildProblem } from '@app/errors';
import { ValidatedBody } from '@app/nest-common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_SERVICE } from '../providers.js';

/**
 * The three auth routes the SPA calls - `/login`, `/logout`, `/signup`. `AuthService` hands back a
 * framework-agnostic `{status, headers, body}`; this controller's whole job is copying that onto
 * the real Fastify reply, header for header, so a `Set-Cookie` Better Auth issued survives
 * verbatim. `@Res` is used with `passthrough: false` because Nest's own response handling does not
 * reproduce a `Set-Cookie` header byte for byte.
 */
@Controller('v1/auth')
export class AuthController {
    constructor(@Inject(AUTH_SERVICE) private readonly authService: AuthService) {}

    /**
     * Better Auth's own 401 body (`{message, code}`) is translated into an RFC 7807 problem body
     * before it is sent, so every error this API emits has one shape. A 429 lockout response is
     * already a problem body by the time it reaches here (`AuthService.login` translates
     * `LockoutService`'s thrown error itself) and passes through unchanged.
     */
    @Post('login')
    async login(
        @ValidatedBody(loginRequestSchema) body: LoginRequest,
        @Res({ passthrough: false }) reply: FastifyReply,
    ): Promise<void> {
        const response = await this.authService.login(body);

        if (response.status === 401) {
            const problem = buildProblem({
                errorName: 'UnauthorizedError',
                title: 'Unauthorized',
                status: 401,
            });
            // `application/json`, not `application/problem+json`, so every problem body this API
            // emits carries one content type - `AppErrorFilter` sets the same - and a caller does
            // not have to branch on which layer produced the error to know how to parse it.
            reply.header('content-type', 'application/json');
            reply.status(401).send(problem);
            return;
        }

        writeHandlerResponse(reply, response);
    }

    /** Clears the session cookie. Always responds 200, even when there was no valid session. */
    @Post('logout')
    async logout(@Req() request: FastifyRequest, @Res({ passthrough: false }) reply: FastifyReply): Promise<void> {
        const response = await this.authService.logout({ cookieHeader: request.headers.cookie });

        writeHandlerResponse(reply, response);
    }

    /**
     * Creates a new account. `AuthService.signup` already translates a validation failure or
     * duplicate email into a problem-body `AuthHandlerResponse` - this method only forwards it.
     */
    @Post('signup')
    async signup(
        @ValidatedBody(signupRequestSchema) body: SignupRequest,
        @Res({ passthrough: false }) reply: FastifyReply,
    ): Promise<void> {
        // `signupRequestSchema.displayName` is nullable (a client may send an explicit null);
        // `SignUpParams.displayName` only accepts `string | undefined`, so a sent `null` is
        // normalised here rather than widening the package type.
        const response = await this.authService.signup({ ...body, displayName: body.displayName ?? undefined });

        writeHandlerResponse(reply, response);
    }
}

/**
 * Copies every header from an `AuthHandlerResponse` onto the real Fastify reply, then sends the
 * body. `Set-Cookie` is handled separately via `Headers.getSetCookie()`: the Fetch `Headers`
 * iterator never combines multiple `Set-Cookie` entries into one comma-joined string (that would
 * be syntactically wrong), so a plain `for...of` loop calling `reply.header()` once per entry
 * would have the last `Set-Cookie` silently overwrite the others instead of appending.
 */
export function writeHandlerResponse(reply: FastifyReply, response: AuthHandlerResponse): void {
    for (const [key, value] of response.headers) {
        if (key.toLowerCase() === 'set-cookie') continue;

        reply.header(key, value);
    }

    const setCookieValues = response.headers.getSetCookie();
    if (setCookieValues.length > 0) {
        reply.header('set-cookie', setCookieValues);
    }

    reply.status(response.status).send(response.body);
}
