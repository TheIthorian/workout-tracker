import { createHash, randomUUID } from 'node:crypto';
import { startTestDatabase } from '@app/db/testing';
import { ClientIdMetadataService, OAuthClientsService, type FetchLike } from '@app/services';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OAUTH_CLIENTS_SERVICE } from '../src/oauth/oauth.providers.js';
import {
    createTestApp,
    signIn,
    TEST_ALLOWED_CLIENT_DOMAINS,
    TEST_API_BASE_URL,
    TEST_OAUTH_CLIENT_ID,
    TEST_WEB_APP_BASE_URL,
    type TestApp,
} from './harness.js';

const REDIRECT_URI = 'https://client.test/callback';
const UNLISTED_CLIENT_ID = 'https://elsewhere.test/oauth-client';
const VERIFIER = 'a-code-verifier-with-enough-entropy-to-be-real';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

const METADATA_DOCUMENT = {
    client_id: TEST_OAUTH_CLIENT_ID,
    client_name: 'Test Client',
    client_uri: 'https://client.test',
    redirect_uris: [REDIRECT_URI],
};

/** Serves the one metadata document this suite's client publishes, without touching the network. */
const stubFetch: FetchLike = async (url) =>
    String(url) === TEST_OAUTH_CLIENT_ID
        ? new Response(JSON.stringify(METADATA_DOCUMENT), { headers: { 'content-type': 'application/json' } })
        : new Response('not found', { status: 404 });

describe('OAuth authorization server', () => {
    let database: Awaited<ReturnType<typeof startTestDatabase>>;
    let app: TestApp;
    let cookie: string;

    beforeAll(async () => {
        // Started here rather than by the harness so the stubbed client resolver below can be built
        // against the same handle the app is. The client resolver is the one collaborator that
        // would otherwise reach the internet, so it is replaced through DI rather than by stubbing
        // a global `fetch`.
        database = await startTestDatabase();
        const { db } = database;

        app = await createTestApp({
            db,
            overrides: [
                {
                    provide: OAUTH_CLIENTS_SERVICE,
                    useValue: new OAuthClientsService({
                        db,
                        metadata: new ClientIdMetadataService({ fetch: stubFetch }),
                        allowedDomains: TEST_ALLOWED_CLIENT_DOMAINS.split(','),
                    }),
                },
            ],
        });

        const email = `${randomUUID()}@example.com`;
        const password = 'password123';
        await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password, displayName: 'Ada' },
        });
        cookie = await signIn(app, { email, password });
    });

    afterAll(async () => {
        await app?.close();
        await database?.stop();
    });

    function authorizeUrl(overrides: Record<string, string> = {}): string {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: TEST_OAUTH_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code_challenge: CHALLENGE,
            code_challenge_method: 'S256',
            scope: 'mcp',
            state: 'opaque-state',
            ...overrides,
        });

        return `/api/v1/oauth/authorize?${params.toString()}`;
    }

    async function startAuthorization(overrides: Record<string, string> = {}): Promise<URL> {
        const response = await app.inject({ method: 'GET', url: authorizeUrl(overrides) });

        expect(response.statusCode).toBe(302);

        return new URL(response.headers.location as string);
    }

    async function approvedCode(): Promise<string> {
        const consent = await startAuthorization();
        const requestId = consent.searchParams.get('request_id') as string;

        const decision = await app.inject({
            method: 'POST',
            url: `/api/v1/oauth/consent/${requestId}`,
            headers: { cookie },
            payload: { decision: 'approve' },
        });

        expect(decision.statusCode).toBe(200);
        const { redirectTo } = JSON.parse(decision.body) as { redirectTo: string };

        return new URL(redirectTo).searchParams.get('code') as string;
    }

    describe('discovery', () => {
        it('serves RFC 8414 metadata at the origin, outside the api prefix', async () => {
            const response = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toMatchObject({
                issuer: TEST_API_BASE_URL,
                authorization_endpoint: `${TEST_API_BASE_URL}/api/v1/oauth/authorize`,
                token_endpoint: `${TEST_API_BASE_URL}/api/v1/oauth/token`,
                client_id_metadata_document_supported: true,
                code_challenge_methods_supported: ['S256'],
            });
        });

        // No dynamic registration: a client identifies itself by publishing a document.
        it('advertises no registration endpoint', async () => {
            const response = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });

            expect(JSON.parse(response.body)).not.toHaveProperty('registration_endpoint');
        });
    });

    describe('GET /oauth/authorize', () => {
        it('redirects an allowlisted client to the consent screen', async () => {
            const location = await startAuthorization();

            expect(location.origin + location.pathname).toBe(`${TEST_WEB_APP_BASE_URL}/oauth/consent`);
            expect(location.searchParams.get('request_id')).toBeTruthy();
        });

        // A client this server does not accept must not receive an error redirect: the redirect_uri
        // it supplied has been proven by nothing, so honouring it would be an open redirect.
        it('sends an unlisted client to the error page, never back to its redirect_uri', async () => {
            const location = await startAuthorization({ client_id: UNLISTED_CLIENT_ID });

            expect(location.origin + location.pathname).toBe(`${TEST_WEB_APP_BASE_URL}/oauth/error`);
            expect(location.searchParams.get('error')).toBe('unsupported_client');
        });

        it('sends an unregistered redirect_uri to the error page rather than to that URI', async () => {
            const location = await startAuthorization({ redirect_uri: 'https://client.test/not-registered' });

            expect(location.origin + location.pathname).toBe(`${TEST_WEB_APP_BASE_URL}/oauth/error`);
        });

        // Once the client and its redirect_uri are proven, a protocol error is the client's to see.
        it('redirects a missing code_challenge back to the client as invalid_request', async () => {
            const response = await app.inject({
                method: 'GET',
                url: authorizeUrl().replace(`&code_challenge=${encodeURIComponent(CHALLENGE)}`, ''),
            });
            const location = new URL(response.headers.location as string);

            expect(location.origin + location.pathname).toBe(REDIRECT_URI);
            expect(location.searchParams.get('error')).toBe('invalid_request');
            expect(location.searchParams.get('state')).toBe('opaque-state');
        });

        it('redirects an unsupported response_type back to the client', async () => {
            const location = await startAuthorization({ response_type: 'token' });

            expect(location.searchParams.get('error')).toBe('unsupported_response_type');
        });
    });

    describe('consent', () => {
        it('refuses to describe a pending request to a signed-out caller', async () => {
            const consent = await startAuthorization();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/oauth/consent/${consent.searchParams.get('request_id')}`,
            });

            expect(response.statusCode).toBe(401);
        });

        it('describes the client and the hosts approving would send the user to', async () => {
            const consent = await startAuthorization();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/oauth/consent/${consent.searchParams.get('request_id')}`,
                headers: { cookie },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toMatchObject({
                clientId: TEST_OAUTH_CLIENT_ID,
                clientName: 'Test Client',
                redirectHosts: ['client.test'],
                scopes: ['mcp'],
            });
        });

        it('returns 404 for an unknown request id', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/oauth/consent/${randomUUID()}`,
                headers: { cookie },
            });

            expect(response.statusCode).toBe(404);
        });

        it('sends a denial back to the client as access_denied, with the state intact', async () => {
            const consent = await startAuthorization();

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/oauth/consent/${consent.searchParams.get('request_id')}`,
                headers: { cookie },
                payload: { decision: 'deny' },
            });

            const location = new URL((JSON.parse(response.body) as { redirectTo: string }).redirectTo);
            expect(location.searchParams.get('error')).toBe('access_denied');
            expect(location.searchParams.get('state')).toBe('opaque-state');
        });

        it('an approved request cannot be approved twice', async () => {
            const consent = await startAuthorization();
            const requestId = consent.searchParams.get('request_id') as string;
            const url = `/api/v1/oauth/consent/${requestId}`;

            await app.inject({ method: 'POST', url, headers: { cookie }, payload: { decision: 'approve' } });
            const second = await app.inject({
                method: 'POST',
                url,
                headers: { cookie },
                payload: { decision: 'approve' },
            });

            expect(second.statusCode).toBe(404);
        });
    });

    describe('POST /oauth/token', () => {
        // RFC 6749 §4.1.3 specifies a form post; JSON-only parsing would break every stock client.
        it('exchanges a code presented as a form post', async () => {
            const code = await approvedCode();

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/oauth/token',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                payload: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI,
                    code_verifier: VERIFIER,
                    client_id: TEST_OAUTH_CLIENT_ID,
                }).toString(),
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['cache-control']).toBe('no-store');
            expect(JSON.parse(response.body)).toMatchObject({ token_type: 'Bearer', scope: 'mcp' });
        });

        it('answers a bad grant with an OAuth error body, not a problem document', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/oauth/token',
                payload: {
                    grant_type: 'authorization_code',
                    code: 'nope',
                    redirect_uri: REDIRECT_URI,
                    code_verifier: VERIFIER,
                    client_id: TEST_OAUTH_CLIENT_ID,
                },
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body)).toMatchObject({ error: 'invalid_grant' });
        });

        it('issues a token that reaches the MCP session route and names the right workspace', async () => {
            const code = await approvedCode();
            const tokenResponse = await app.inject({
                method: 'POST',
                url: '/api/v1/oauth/token',
                payload: {
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI,
                    code_verifier: VERIFIER,
                    client_id: TEST_OAUTH_CLIENT_ID,
                },
            });
            const { access_token: accessToken } = JSON.parse(tokenResponse.body) as { access_token: string };

            const session = await app.inject({
                method: 'GET',
                url: '/api/v1/me/mcp-session',
                headers: { authorization: `Bearer ${accessToken}` },
            });

            expect(session.statusCode).toBe(200);
            expect(JSON.parse(session.body)).toMatchObject({ workspaceId: expect.any(String) });
        });

        it('refuses a code whose verifier does not match', async () => {
            const code = await approvedCode();

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/oauth/token',
                payload: {
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI,
                    code_verifier: `${VERIFIER}x`,
                    client_id: TEST_OAUTH_CLIENT_ID,
                },
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body)).toMatchObject({ error: 'invalid_grant' });
        });
    });

    describe('POST /oauth/revoke', () => {
        it('stops a revoked access token reaching the API, and answers 200 for an unknown one', async () => {
            const code = await approvedCode();
            const tokenResponse = await app.inject({
                method: 'POST',
                url: '/api/v1/oauth/token',
                payload: {
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI,
                    code_verifier: VERIFIER,
                    client_id: TEST_OAUTH_CLIENT_ID,
                },
            });
            const { access_token: accessToken } = JSON.parse(tokenResponse.body) as { access_token: string };

            const revoked = await app.inject({
                method: 'POST',
                url: '/api/v1/oauth/revoke',
                payload: { token: accessToken, client_id: TEST_OAUTH_CLIENT_ID },
            });
            const afterRevoke = await app.inject({
                method: 'GET',
                url: '/api/v1/me/mcp-session',
                headers: { authorization: `Bearer ${accessToken}` },
            });
            const unknown = await app.inject({
                method: 'POST',
                url: '/api/v1/oauth/revoke',
                payload: { token: 'never-existed', client_id: TEST_OAUTH_CLIENT_ID },
            });

            expect(revoked.statusCode).toBe(200);
            expect(afterRevoke.statusCode).toBe(401);
            expect(unknown.statusCode).toBe(200);
        });
    });
});
