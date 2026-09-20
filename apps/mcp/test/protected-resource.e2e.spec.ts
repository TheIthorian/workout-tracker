import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TEST_API_BASE_URL, TEST_MCP_BASE_URL, type TestApp } from './harness.js';

describe('OAuth protected resource metadata', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app?.close();
    });

    // Both locations matter: a client that treats the origin as the resource reads the bare path,
    // and the `WWW-Authenticate` challenge names the path-insertion form (RFC 9728 §3.1).
    it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
        'serves the same document at %s, with no credential',
        async (url) => {
            const response = await app.inject({ method: 'GET', url });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toEqual({
                resource: `${TEST_MCP_BASE_URL}/mcp`,
                authorization_servers: [TEST_API_BASE_URL],
                scopes_supported: ['mcp'],
                bearer_methods_supported: ['header'],
            });
        },
    );

    // A browser-based client reads this from its own origin, and reads the challenge that points at
    // it off a 401 - both need CORS, and `WWW-Authenticate` needs to be explicitly exposed.
    it('lets any origin read the document', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/.well-known/oauth-protected-resource',
            headers: { origin: 'https://claude.ai' },
        });

        expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('exposes the WWW-Authenticate challenge to a cross-origin caller', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/mcp',
            headers: {
                origin: 'https://claude.ai',
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
            },
            payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        });

        expect(response.statusCode).toBe(401);
        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(String(response.headers['access-control-expose-headers'])).toContain('WWW-Authenticate');
    });
});
