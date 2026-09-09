import pino from 'pino';
import type { LoggerConfig } from './config.js';
import { getRequestContext } from './request-context.js';
import { REDACT_PATHS, REDACTION_PLACEHOLDER } from './redaction.js';

export { LOG_LEVELS, type LoggerConfig, type LogLevel } from './config.js';
export { bindRequestUser, getRequestContext, runWithRequestContext, type RequestContext } from './request-context.js';
export { installProcessErrorHandlers } from './process-errors.js';
export { REDACT_PATHS, REDACTION_PLACEHOLDER } from './redaction.js';

/** Re-exported Pino logger type used across the monorepo. */
export type Logger = pino.Logger;

/** Creates a named Pino logger from config the caller has already validated. */
export function createLogger({ context, config }: { context: string; config: LoggerConfig }): pino.Logger {
    return pino({
        ...buildLoggerOptions({ context, config }),
        transport: config.pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
    });
}

/**
 * The redaction, serializer and correlation config shared by every logger in the monorepo,
 * separated from the transport so it can be pointed at a test stream.
 */
export function buildLoggerOptions({ context, config }: { context: string; config: LoggerConfig }): pino.LoggerOptions {
    return {
        name: context,
        level: config.level,
        ...(config.redact ? { redact: { paths: REDACT_PATHS, censor: REDACTION_PLACEHOLDER } } : {}),
        serializers: {
            err: pino.stdSerializers.err,
            req: serializeRequest,
            res: serializeResponse,
        },
        mixin: () => ({ ...getRequestContext() }),
    };
}

// Framework request objects carry the socket, the raw headers and the body. Only the routing
// fields are useful in a log line, and everything else is a redaction risk.
function serializeRequest(req: unknown): Record<string, unknown> {
    if (typeof req !== 'object' || req === null) return { value: req };

    const { method, url } = req as { method?: unknown; url?: unknown };

    return { method, url };
}

function serializeResponse(res: unknown): Record<string, unknown> {
    if (typeof res !== 'object' || res === null) return { value: res };

    const { statusCode } = res as { statusCode?: unknown };

    return { statusCode };
}
