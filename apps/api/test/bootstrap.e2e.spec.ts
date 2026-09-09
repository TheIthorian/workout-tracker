import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

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

        // Signup alone creates one default workspace, whose listing is well under the
        // 1024-byte compression threshold - create enough more that it's reliably crossed.
        for (let i = 0; i < 15; i += 1) {
            const createResponse = await app.inject({
                method: 'POST',
                url: '/api/v1/workspaces',
                headers: { cookie },
                payload: { name: `Compression workspace ${i} ${randomUUID()}` },
            });
            expect(createResponse.statusCode).toBe(200);
        }

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/workspaces',
            headers: { cookie, 'accept-encoding': 'gzip' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-encoding']).toBe('gzip');

        // response.body is the raw (still-compressed) bytes decoded as utf-8, which is not valid
        // JSON - only rawPayload, gunzipped, recovers the real response.
        const decompressed = gunzipSync(response.rawPayload);
        const workspaceList = JSON.parse(decompressed.toString('utf-8')) as unknown[];

        expect(workspaceList.length).toBeGreaterThanOrEqual(16);
    });

    it('answers a CORS preflight request with the configured origin policy', async () => {
        const response = await app.inject({
            method: 'OPTIONS',
            url: '/api/v1/workspaces',
            headers: {
                origin: 'https://example.com',
                'access-control-request-method': 'GET',
            },
        });

        expect(response.statusCode).toBe(204);
        // CORS_ORIGIN defaults to '*' (see load-env.ts) when unset, as it is in this test process,
        // which bootstrap.ts turns into `origin: true` - the underlying cors middleware then
        // reflects the requesting origin back rather than emitting a literal wildcard.
        expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
        expect(response.headers['access-control-allow-methods']).toContain('GET');
        // credentials is false whenever CORS_ORIGIN is '*' (see bootstrap.ts), so no
        // access-control-allow-credentials header should be present.
        expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });
});
