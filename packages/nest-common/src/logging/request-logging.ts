import type { FastifyInstance } from 'fastify';
import type { Logger } from '@app/logger';

/** Largest payload written to the log. Anything longer is replaced by a description of it. */
export const MAX_LOGGED_PAYLOAD_BYTES = 4096;

/** Media types whose payload is readable in a log line. Anything else is described, not printed. */
const TEXTUAL_MEDIA_TYPES = ['application/json', 'application/x-www-form-urlencoded', 'text/', '+json'];

/**
 * Logs every request this app serves.
 *
 * Two levels, deliberately:
 *
 * - **info/warn, always on**: one line per completed request - method, url, status, duration.
 *   Warn from 400 up, so a failing route is greppable without reading every line.
 * - **debug, only when the logger is at debug**: headers and bodies, inbound and outbound. The
 *   hooks are not even registered otherwise, so a production deployment pays nothing for them.
 *
 * Registered as Fastify hooks rather than Nest middleware for the same reason
 * `registerRequestContextHook` is: under `@nestjs/platform-fastify`, middleware runs through
 * `@fastify/middie` and receives the raw Node `req`/`res`, not the Fastify wrappers these hooks
 * need. The payload hooks additionally have to run late - `preHandler` is the first point at which
 * the body is parsed, and `onSend` the first at which the response payload exists.
 *
 * Payloads reach the log as objects wherever possible rather than as pre-serialised strings,
 * because pino's redaction matches on keys: a body stringified here would sail past
 * `REDACT_PATHS` and put passwords in the log. That is the single most important property of this
 * file - see `describePayload`.
 */
export function registerRequestLogging({ app, logger }: { app: FastifyInstance; logger: Logger }): void {
    const httpLogger = logger.child({ name: 'http' });

    app.addHook('onResponse', async (request, reply) => {
        // CORS preflight is noise: one per real request, carrying nothing worth keeping.
        if (request.method === 'OPTIONS') return;

        const log = {
            method: request.method,
            url: request.url,
            status: reply.statusCode,
            durationMs: Math.round(reply.elapsedTime),
        };
        const message = `${request.method} ${request.url} ${reply.statusCode}`;

        if (reply.statusCode >= 400) {
            httpLogger.warn(log, message);
        } else {
            httpLogger.info(log, message);
        }
    });

    if (!httpLogger.isLevelEnabled('debug')) return;

    app.addHook('preHandler', async (request) => {
        if (request.method === 'OPTIONS') return;

        httpLogger.debug(
            {
                method: request.method,
                url: request.url,
                headers: request.headers,
                body: describePayload({ payload: request.body, contentType: request.headers['content-type'] }),
            },
            'inbound request',
        );
    });

    app.addHook('onSend', async (request, reply, payload: unknown) => {
        if (request.method === 'OPTIONS') return payload;

        httpLogger.debug(
            {
                method: request.method,
                url: request.url,
                status: reply.statusCode,
                responseHeaders: reply.getHeaders(),
                responseBody: describePayload({
                    payload,
                    contentType: String(reply.getHeader('content-type') ?? ''),
                }),
            },
            'outbound response',
        );

        return payload;
    });
}

/**
 * Returns the payload in a form that is safe to log.
 *
 * Objects are passed through UNSERIALISED so pino's redaction can reach their keys - this is what
 * keeps a `password` field out of the log. Text is truncated, and anything binary or oversized is
 * reduced to a one-line summary rather than dumped.
 */
function describePayload({ payload, contentType }: { payload: unknown; contentType?: string }): unknown {
    if (payload === undefined || payload === null) return undefined;

    if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
        if (!isTextual(contentType)) return summarise({ contentType, length: undefined });

        const encoded = safeStringify(payload);

        return encoded !== undefined && encoded.length <= MAX_LOGGED_PAYLOAD_BYTES
            ? payload
            : summarise({ contentType, length: encoded?.length });
    }

    const text = Buffer.isBuffer(payload) ? undefined : typeof payload === 'string' ? payload : String(payload);
    const length = Buffer.isBuffer(payload) ? payload.byteLength : (text?.length ?? 0);

    if (!isTextual(contentType) || length > MAX_LOGGED_PAYLOAD_BYTES) return summarise({ contentType, length });

    return text;
}

function isTextual(contentType?: string): boolean {
    return TEXTUAL_MEDIA_TYPES.some((type) => (contentType ?? '').toLowerCase().includes(type));
}

function summarise({ contentType, length }: { contentType?: string; length?: number }): string {
    return `${contentType || 'unknown content type'} of length ${length ?? -1}`;
}

function safeStringify(value: unknown): string | undefined {
    try {
        return JSON.stringify(value);
    } catch {
        return undefined;
    }
}
