import type { Logger } from 'pino';

/**
 * Logs anything that escapes every handler at `fatal`. Without this the process dies (or, for a
 * rejection, keeps running in an unknown state) with nothing written, which is the one failure
 * mode that leaves no trace at all.
 *
 * Returns a function that removes the handlers, so tests do not leak listeners between suites.
 * Deliberately does not call `process.exit`: the platform's restart policy owns that decision.
 */
export function installProcessErrorHandlers({ logger }: { logger: Logger }): () => void {
    const onUncaughtException = (err: Error): void => {
        logger.fatal({ err }, 'Uncaught exception');
    };

    const onUnhandledRejection = (reason: unknown): void => {
        logger.fatal({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'Unhandled rejection');
    };

    process.on('uncaughtException', onUncaughtException);
    process.on('unhandledRejection', onUnhandledRejection);

    return () => {
        process.off('uncaughtException', onUncaughtException);
        process.off('unhandledRejection', onUnhandledRejection);
    };
}
