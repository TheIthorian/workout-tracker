import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { runWithRequestContext } from '@app/logger';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Header carrying the per-request identifier. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Header carrying the cross-service correlation identifier. */
export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

/**
 * Reads the request and correlation ids from the incoming headers, generating one when absent or
 * blank, and echoes both back on the request and the response so logs and the client agree on the
 * same values for a request.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
    /** Attaches the request and correlation ids to `request`, `reply`, and the logger context. */
    use(request: FastifyRequest, reply: FastifyReply, next: (error?: unknown) => void): void {
        const requestId = getOrCreateHeaderValue(request, REQUEST_ID_HEADER);
        const correlationId = getOrCreateHeaderValue(request, CORRELATION_ID_HEADER);

        reply.header(REQUEST_ID_HEADER, requestId);
        reply.header(CORRELATION_ID_HEADER, correlationId);

        runWithRequestContext({ context: { requestId, correlationId }, fn: next });
    }
}

/** Reads the header if the caller sent one, otherwise mints 32 undashed hex characters. */
function getOrCreateHeaderValue(request: FastifyRequest, headerName: string): string {
    const headerKey = headerName.toLowerCase();
    const existing = request.headers[headerKey];
    const value = Array.isArray(existing) ? existing[0] : existing;

    if (value !== undefined && value.trim() !== '') return value;

    const generated = randomUUID().replace(/-/g, '');
    request.headers[headerKey] = generated;
    return generated;
}
