import type { LoggerService } from '@nestjs/common';
import type { Logger } from '@app/logger';

/** Pino methods this adapter routes Nest's log levels to. */
type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

type NestLogCall = { message: unknown; optionalParams: unknown[] };

type SplitParams = { context?: string; stack?: string; details: unknown[] };

/**
 * Routes Nest's own framework logging - `NestFactory`, `InstanceLoader`, `RoutesResolver` and
 * anything injecting Nest's `Logger` - through this monorepo's pino logger.
 *
 * Without it Nest writes colourised, human-formatted text to the same stdout pino writes JSON to,
 * so a log collector sees two formats on one stream: the pino lines parse into fields, while the
 * Nest lines arrive as one opaque string carrying raw ANSI escape codes.
 */
export class PinoNestLogger implements LoggerService {
    private readonly logger: Logger;

    constructor({ logger }: { logger: Logger }) {
        this.logger = logger.child({ name: 'nest' });
    }

    /** Logs at Nest's default level, which maps to pino `info`. */
    log(message: unknown, ...optionalParams: unknown[]): void {
        this.write('info', { message, optionalParams });
    }

    /** Logs an error, attaching the `Error` or stack Nest passes so pino's `err` serialiser sees it. */
    error(message: unknown, ...optionalParams: unknown[]): void {
        this.write('error', { message, optionalParams });
    }

    /** Logs a warning. */
    warn(message: unknown, ...optionalParams: unknown[]): void {
        this.write('warn', { message, optionalParams });
    }

    /** Logs a debug line, emitted only when the pino logger is itself at debug or below. */
    debug(message: unknown, ...optionalParams: unknown[]): void {
        this.write('debug', { message, optionalParams });
    }

    /** Logs Nest's most verbose level, mapped to pino `trace` because pino has no `verbose`. */
    verbose(message: unknown, ...optionalParams: unknown[]): void {
        this.write('trace', { message, optionalParams });
    }

    /** Logs a fatal error. */
    fatal(message: unknown, ...optionalParams: unknown[]): void {
        this.write('fatal', { message, optionalParams });
    }

    private write(level: PinoLevel, { message, optionalParams }: NestLogCall): void {
        const { context, stack, details } = splitParams(optionalParams);
        const bindings: Record<string, unknown> = {};

        if (context !== undefined) bindings['context'] = context;
        if (details.length > 0) bindings['details'] = details;

        if (message instanceof Error) {
            bindings['err'] = message;
        } else if (stack !== undefined) {
            bindings['stack'] = stack;
        }

        this.logger[level](bindings, formatMessage(message));
    }
}

/**
 * Separates Nest's trailing positional arguments into the pieces pino wants as fields.
 *
 * Nest passes the context as the final argument and, on `error`, a stack string just before it -
 * both as bare strings with nothing to tell them apart but their shape. A stack spans lines and a
 * context never does, which is the only distinction available at this boundary.
 */
function splitParams(optionalParams: unknown[]): SplitParams {
    const params = [...optionalParams];
    let context: string | undefined;
    let stack: string | undefined;

    const last = params.at(-1);
    if (typeof last === 'string' && !last.includes('\n')) {
        context = last;
        params.pop();
    }

    const beforeContext = params.at(-1);
    if (typeof beforeContext === 'string' && beforeContext.includes('\n')) {
        stack = beforeContext;
        params.pop();
    }

    return { context, stack, details: params };
}

function formatMessage(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;

    return safeStringify(message) ?? String(message);
}

function safeStringify(value: unknown): string | undefined {
    try {
        return JSON.stringify(value);
    } catch {
        return undefined;
    }
}
