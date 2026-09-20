import type { OAuthErrorResponse } from '@app/api-contract';
import { OAuthProtocolError } from '@app/errors';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/**
 * Renders an {@link OAuthProtocolError} in the shape RFC 6749 §5.2 fixes, rather than as the RFC
 * 7807 problem body every other route returns.
 *
 * Applied only to the OAuth endpoints. A client parsing a token response reads `error` and nothing
 * else, so a problem document there is an unparseable failure however correct it is elsewhere.
 * Every other error on those routes still falls through to `AppErrorFilter`.
 */
@Catch(OAuthProtocolError)
export class OAuthErrorFilter implements ExceptionFilter<OAuthProtocolError> {
    /** Writes the OAuth error body, with the no-store RFC 6749 §5.1 requires of token responses. */
    catch(exception: OAuthProtocolError, host: ArgumentsHost): void {
        const reply = host.switchToHttp().getResponse<FastifyReply>();
        const body: OAuthErrorResponse = {
            error: exception.oauthError,
            error_description: exception.errorDescription,
        };

        void reply
            .status(exception.statusCode)
            .header('cache-control', 'no-store')
            .header('pragma', 'no-cache')
            .send(body);
    }
}
