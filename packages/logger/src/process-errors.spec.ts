import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { installProcessErrorHandlers } from './process-errors.js';

const uninstallers: (() => void)[] = [];

afterEach(() => {
    while (uninstallers.length) uninstallers.pop()?.();
});

describe('installProcessErrorHandlers', () => {
    it('logs an uncaught exception at fatal', () => {
        const { logger, fatal } = fakeLogger();
        uninstallers.push(installProcessErrorHandlers({ logger }));

        process.emit('uncaughtException', new Error('boom'));

        expect(fatal).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Uncaught exception');
    });

    it('logs an unhandled rejection at fatal, wrapping a non-error reason', () => {
        const { logger, fatal } = fakeLogger();
        uninstallers.push(installProcessErrorHandlers({ logger }));

        process.emit('unhandledRejection', 'nope', Promise.resolve());

        expect(fatal).toHaveBeenCalledWith(
            { err: expect.objectContaining({ message: 'nope' }) },
            'Unhandled rejection',
        );
    });

    it('removes its handlers when uninstalled', () => {
        const { logger, fatal } = fakeLogger();
        const before = process.listenerCount('uncaughtException');

        installProcessErrorHandlers({ logger })();

        expect(process.listenerCount('uncaughtException')).toBe(before);
        expect(fatal).not.toHaveBeenCalled();
    });
});

function fakeLogger(): { logger: Logger; fatal: ReturnType<typeof vi.fn> } {
    const fatal = vi.fn();

    return { logger: { fatal } as unknown as Logger, fatal };
}
