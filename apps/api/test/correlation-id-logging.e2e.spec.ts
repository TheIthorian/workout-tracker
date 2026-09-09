import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { buildLoggerOptions } from '@app/logger';
import { createTestApp, type TestApp } from './harness.js';

describe('correlation id propagation into log lines', () => {
    let app: TestApp;
    let lines: Record<string, unknown>[];

    beforeAll(async () => {
        lines = [];
        const stream = new Writable({
            write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
                lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
                callback();
            },
        });
        const logger = pino(
            // debug, because the health route logs at debug - see the comment in health.controller.ts.
            buildLoggerOptions({ context: 'api-test', config: { level: 'debug', pretty: false, redact: true } }),
            stream,
        );

        app = await createTestApp({ logger });
    });

    afterAll(async () => {
        await app.close();
    });

    it('carries the request and correlation id onto a log line emitted inside the request', async () => {
        await app.inject({
            method: 'GET',
            url: '/api/health',
            headers: { 'x-request-id': 'req-under-test', 'x-correlation-id': 'corr-under-test' },
        });

        const line = lines.find((entry) => entry['msg'] === 'Health check handled');

        expect(line).toMatchObject({ requestId: 'req-under-test', correlationId: 'corr-under-test' });
    });
});
