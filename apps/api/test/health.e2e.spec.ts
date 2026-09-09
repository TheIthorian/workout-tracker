import { PROBLEM_TYPE_BASE } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

describe('GET /api/health', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it('returns the literal text "ok"', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/health' });

        expect(response.statusCode).toBe(200);
        // Results.Text("ok") - a bare string, not JSON, and not a wrapped object.
        expect(response.body).toBe('ok');
        expect(response.headers['content-type']).toContain('text/plain');
    });

    it('echoes an incoming request id and generates a correlation id', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'abc123' } });

        expect(response.headers['x-request-id']).toBe('abc123');
        expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f]{32}$/);
    });

    it('returns the plain-text 500 body for an unhandled throw', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/health/boom' });

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({
            type: `${PROBLEM_TYPE_BASE}/InternalServerError`,
            title: 'Unexpected error',
            status: 500,
        });
    });
});
