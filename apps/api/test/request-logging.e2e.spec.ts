import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { buildLoggerOptions, REDACTION_PLACEHOLDER } from '@app/logger';
import { createTestApp, type TestApp } from './harness.js';

describe('request logging', () => {
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
            // debug, because the payload hooks are only registered when the logger is at debug.
            buildLoggerOptions({ context: 'api-test', config: { level: 'debug', pretty: false, redact: true } }),
            stream,
        );

        app = await createTestApp({ logger });
    });

    afterAll(async () => {
        await app.close();
    });

    function linesFor(url: string): Record<string, unknown>[] {
        return lines.filter((line) => line['url'] === url);
    }

    it('logs one summary line per completed request, with method, status and duration', async () => {
        await app.inject({ method: 'GET', url: '/api/health' });

        const summary = linesFor('/api/health').find((line) => line['msg'] === 'GET /api/health 200');

        expect(summary).toBeDefined();
        expect(summary?.['method']).toBe('GET');
        expect(summary?.['status']).toBe(200);
        expect(typeof summary?.['durationMs']).toBe('number');
    });

    it('logs a failing request at warn rather than info', async () => {
        await app.inject({ method: 'GET', url: '/api/v1/workspaces' });

        const summary = linesFor('/api/v1/workspaces').find((line) => line['msg'] === 'GET /api/v1/workspaces 401');

        expect(summary).toBeDefined();
        // pino: 40 is warn, 30 is info. A 4xx should stand out from ordinary traffic.
        expect(summary?.['level']).toBe(40);
    });

    it('logs inbound and outbound payloads at debug', async () => {
        await app.inject({ method: 'GET', url: '/api/health' });

        const messages = linesFor('/api/health').map((line) => line['msg']);

        expect(messages).toContain('inbound request');
        expect(messages).toContain('outbound response');
    });

    it('never writes the plaintext password from a sign-up request', async () => {
        // The single most important property of this file. `/api/v1/auth/signup` carries a
        // plaintext password, and payload logging would put it on stdout if the body were
        // serialised before pino's redaction could see its keys.
        const password = `never-log-me-${randomUUID()}`;

        await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email: `${randomUUID()}@example.com`, password, displayName: 'Redaction Probe' },
        });

        expect(JSON.stringify(lines)).not.toContain(password);

        // Not merely absent - present and censored, which proves the body reached the log as an
        // object that redaction could walk, rather than being dropped for some unrelated reason.
        const inbound = linesFor('/api/v1/auth/signup').find((line) => line['msg'] === 'inbound request');
        expect(inbound).toBeDefined();
        expect((inbound?.['body'] as Record<string, unknown>)['password']).toBe(REDACTION_PLACEHOLDER);
    });
});
