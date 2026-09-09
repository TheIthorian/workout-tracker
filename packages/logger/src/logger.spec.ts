import { describe, it, expect } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import { buildLoggerOptions, createLogger, REDACT_PATHS, REDACTION_PLACEHOLDER, type LoggerConfig } from './index.js';
import { runWithRequestContext } from './request-context.js';

const TEST_CONFIG: LoggerConfig = { level: 'trace', pretty: false, redact: true };

describe('createLogger', () => {
    it('returns a logger with the given context name', () => {
        const logger = createLogger({ context: 'test-context', config: TEST_CONFIG });

        expect(logger.bindings()).toMatchObject({ name: 'test-context' });
    });

    it('returns a child logger when child() is called', () => {
        const logger = createLogger({ context: 'parent', config: TEST_CONFIG });
        const child = logger.child({ requestId: 'abc' });

        expect(child.bindings()).toMatchObject({ name: 'parent', requestId: 'abc' });
    });

    it('takes its level from the config it was handed, not the environment', () => {
        process.env['LOG_LEVEL'] = 'trace';

        const logger = createLogger({ context: 'explicit', config: { ...TEST_CONFIG, level: 'warn' } });

        expect(logger.level).toBe('warn');

        delete process.env['LOG_LEVEL'];
    });

    it('adds the request context to every line logged inside a request', () => {
        const { logger, lines } = captureLogger();

        runWithRequestContext({
            context: { requestId: 'req-1', userId: 'user-1' },
            fn: () => logger.info('inside'),
        });

        logger.info('outside');

        expect(lines[0]).toMatchObject({ requestId: 'req-1', userId: 'user-1', msg: 'inside' });
        expect(lines[1]).not.toHaveProperty('requestId');
    });

    it('carries the request context across awaits', async () => {
        const { logger, lines } = captureLogger();

        await runWithRequestContext({
            context: { requestId: 'req-2' },
            fn: async () => {
                await Promise.resolve();

                logger.info('after await');
            },
        });

        expect(lines[0]).toMatchObject({ requestId: 'req-2' });
    });

    it('redacts secrets at the top level and one level down', () => {
        const { logger, lines } = captureLogger();

        logger.info({ access_token: 'at', state: 'st', nested: { client_secret: 'cs', botToken: 'bt' } }, 'oauth');

        expect(lines[0]).toMatchObject({
            access_token: REDACTION_PLACEHOLDER,
            state: REDACTION_PLACEHOLDER,
            nested: { client_secret: REDACTION_PLACEHOLDER, botToken: REDACTION_PLACEHOLDER },
        });
    });

    it('redacts authorization and cookie headers', () => {
        const { logger, lines } = captureLogger();

        logger.info({ headers: { authorization: 'Bearer abc', cookie: 'sid=1' } }, 'request');

        expect(lines[0]).toMatchObject({
            headers: { authorization: REDACTION_PLACEHOLDER, cookie: REDACTION_PLACEHOLDER },
        });
    });

    it('serializes an error into type, message and stack', () => {
        const { logger, lines } = captureLogger();

        logger.error({ err: new TypeError('boom') }, 'failed');

        const line = lines[0] as unknown as { err: { type: string; message: string; stack: string } };
        expect(line.err.type).toBe('TypeError');
        expect(line.err.message).toBe('boom');
        expect(line.err.stack).toContain('logger.spec');
    });

    it('reduces a request object to its routing fields', () => {
        const { logger, lines } = captureLogger();

        logger.info({ req: { method: 'GET', url: '/tasks', socket: {}, body: { password: 'p' } } }, 'req');

        expect(lines[0]).toMatchObject({ req: { method: 'GET', url: '/tasks' } });
        expect(lines[0]?.['req']).not.toHaveProperty('body');
    });

    it('leaves secrets intact when redaction is switched off for local debugging', () => {
        const { logger, lines } = captureLogger({ level: 'trace', pretty: false, redact: false });

        logger.info({ access_token: 'at' }, 'oauth');

        expect(lines[0]).toMatchObject({ access_token: 'at' });
    });

    it('exposes redaction paths for the bare, nested and header positions', () => {
        expect(REDACT_PATHS).toContain('password');
        expect(REDACT_PATHS).toContain('*.password');
        expect(REDACT_PATHS).toContain('req.headers.authorization');
    });
});

// Exercises the real logger options against an in-memory stream, so the assertions above are
// about the shipped redaction and serializer config rather than a copy of it.
function captureLogger(config: LoggerConfig = TEST_CONFIG): { logger: pino.Logger; lines: Record<string, unknown>[] } {
    const lines: Record<string, unknown>[] = [];

    const stream = new Writable({
        write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
            lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
            callback();
        },
    });

    return { logger: pino(buildLoggerOptions({ context: 'capture', config }), stream), lines };
}
