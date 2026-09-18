import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { buildLoggerOptions, type Logger } from '@app/logger';
import { PinoNestLogger } from './pino-nest-logger.js';

const ESCAPE = String.fromCharCode(27);

describe('PinoNestLogger', () => {
    it('writes Nest log lines as JSON with no ANSI escape codes', () => {
        const { nestLogger, lines } = makeLogger();

        nestLogger.log('Starting Nest application...', 'NestFactory');

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
            level: 30,
            name: 'nest',
            context: 'NestFactory',
            msg: 'Starting Nest application...',
        });
        expect(JSON.stringify(lines[0])).not.toContain(ESCAPE);
    });

    it('maps each Nest level onto its pino level', () => {
        const { nestLogger, lines } = makeLogger({ level: 'trace' });

        nestLogger.verbose('v');
        nestLogger.debug('d');
        nestLogger.log('l');
        nestLogger.warn('w');
        nestLogger.error('e');
        nestLogger.fatal('f');

        expect(lines.map((line) => line['level'])).toEqual([10, 20, 30, 40, 50, 60]);
    });

    it('keeps a stack out of the context field', () => {
        const { nestLogger, lines } = makeLogger();
        const stack = 'Error: boom\n    at start (file.ts:1:1)';

        nestLogger.error('Nest could not start', stack, 'ExceptionHandler');

        expect(lines[0]).toMatchObject({ msg: 'Nest could not start', context: 'ExceptionHandler', stack });
    });

    it('attaches a thrown Error through the err serialiser', () => {
        const { nestLogger, lines } = makeLogger();

        nestLogger.error(new Error('pool exhausted'), 'InstanceLoader');

        expect(lines[0]).toMatchObject({ msg: 'pool exhausted', context: 'InstanceLoader' });
        expect(lines[0]?.['err']).toMatchObject({ type: 'Error', message: 'pool exhausted' });
    });

    it('serialises a non-string message and keeps extra arguments', () => {
        const { nestLogger, lines } = makeLogger();

        nestLogger.log({ mapped: '/api/v1/exercises' }, 42, 'RoutesResolver');

        expect(lines[0]).toMatchObject({
            msg: '{"mapped":"/api/v1/exercises"}',
            context: 'RoutesResolver',
            details: [42],
        });
    });

    it('respects the pino level, so debug stays off at info', () => {
        const { nestLogger, lines } = makeLogger();

        nestLogger.debug('noisy');

        expect(lines).toHaveLength(0);
    });
});

function makeLogger({ level = 'info' }: { level?: 'trace' | 'info' } = {}): {
    nestLogger: PinoNestLogger;
    lines: Record<string, unknown>[];
} {
    const lines: Record<string, unknown>[] = [];
    const stream = {
        write: (line: string): void => {
            lines.push(JSON.parse(line) as Record<string, unknown>);
        },
    };

    const logger: Logger = pino(
        buildLoggerOptions({ context: 'api', config: { level, pretty: false, redact: true } }),
        stream,
    );

    return { nestLogger: new PinoNestLogger({ logger }), lines };
}
