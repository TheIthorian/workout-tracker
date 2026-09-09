/** Pino levels this monorepo allows. Ordered quietest-last so the table reads like pino's own. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Everything the logger needs in order to be built. Always supplied by the caller: this package
 * never reads `process.env`, so the app that owns the environment owns validating it and choosing
 * the defaults. A library that reads env has two sources of truth and no way to be tested against
 * a value it was not started with.
 */
export type LoggerConfig = {
    level: LogLevel;
    pretty: boolean;
    redact: boolean;
};
