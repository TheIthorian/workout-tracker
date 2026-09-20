import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, TEST_WEB_APP_BASE_URL, type TestApp } from './harness.js';

/**
 * Exercises the plugin/CORS registration that lives in `configureApp` (`src/bootstrap.ts`) -
 * `createTestApp` boots through that exact function, so a failure here means production's boot
 * path is broken too, not just a hand-rolled test double of it.
 */
describe('app boot configuration (configureApp)', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it('gzip-compresses a response body over the compression threshold', async () => {
        const email = `${randomUUID()}@example.com`;
        const password = 'password123';

        const signupResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password, displayName: 'Compression Test' },
        });
        expect(signupResponse.statusCode).toBe(200);

        const cookie = await signIn(app, { email, password });

        const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
        const workspaceId = (JSON.parse(me.body) as { workspaces: { workspaceId: string }[] }).workspaces[0]
            ?.workspaceId as string;

        // Create enough exercise rows that the listing reliably crosses the compression threshold.
        for (let i = 0; i < 15; i += 1) {
            const createResponse = await app.inject({
                method: 'POST',
                url: `/api/v1/workspaces/${workspaceId}/exercises`,
                headers: { cookie },
                payload: { name: `Compression exercise ${i} ${randomUUID()}`, trackingType: 'weight_reps' },
            });
            expect(createResponse.statusCode).toBe(200);
        }

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie, 'accept-encoding': 'gzip' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-encoding']).toBe('gzip');

        // response.body is the raw (still-compressed) bytes decoded as utf-8, which is not valid
        // JSON - only rawPayload, gunzipped, recovers the real response.
        const decompressed = gunzipSync(response.rawPayload);
        const exerciseList = JSON.parse(decompressed.toString('utf-8')) as { data: unknown[] };

        expect(exerciseList.data.length).toBeGreaterThanOrEqual(15);
    });

    it('answers a CORS preflight from the configured web origin, cookies allowed', async () => {
        const response = await app.inject({
            method: 'OPTIONS',
            url: '/api/v1/workspaces',
            headers: {
                origin: TEST_WEB_APP_BASE_URL,
                'access-control-request-method': 'GET',
            },
        });

        expect(response.statusCode).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe(TEST_WEB_APP_BASE_URL);
        expect(response.headers['access-control-allow-methods']).toContain('GET');
        // The session cookie only travels cross-origin when this is set, and it is only safe to set
        // it because the origin above is a named one rather than a wildcard.
        expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('refuses a CORS preflight from any other origin on a session-authenticated route', async () => {
        const response = await app.inject({
            method: 'OPTIONS',
            url: '/api/v1/workspaces',
            headers: {
                origin: 'https://example.com',
                'access-control-request-method': 'GET',
            },
        });

        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
});
