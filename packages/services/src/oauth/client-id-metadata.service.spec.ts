import { describe, expect, it } from 'vitest';
import {
    ClientIdMetadataService,
    MAX_METADATA_BYTES,
    MAX_METADATA_TTL_MS,
    MIN_METADATA_TTL_MS,
} from './client-id-metadata.service.js';
import type { FetchLike } from './safe-fetch.js';

const CLIENT_ID = 'https://client.example/oauth-client';

const VALID_DOCUMENT = {
    client_id: CLIENT_ID,
    client_name: 'Example Client',
    redirect_uris: ['https://client.example/callback'],
    grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
    response_types: ['code'],
};

function stubFetch(
    body: unknown,
    {
        headers = { 'content-type': 'application/json' },
        status = 200,
    }: { headers?: Record<string, string>; status?: number } = {},
): FetchLike {
    return async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function service(fetchImpl: FetchLike): ClientIdMetadataService {
    return new ClientIdMetadataService({ fetch: fetchImpl });
}

describe('ClientIdMetadataService.fetchMetadata', () => {
    it('accepts a document that describes the client id it was fetched from', async () => {
        const result = await service(stubFetch(VALID_DOCUMENT)).fetchMetadata({ clientId: CLIENT_ID });

        expect(result).toMatchObject({ ok: true, ttlMs: MIN_METADATA_TTL_MS });
    });

    // The equality is what makes publishing the document a claim only the URL's owner can make.
    it('refuses a document that names a different client_id', async () => {
        const result = await service(
            stubFetch({ ...VALID_DOCUMENT, client_id: 'https://other.example/oauth-client' }),
        ).fetchMetadata({ clientId: CLIENT_ID });

        expect(result.ok).toBe(false);
    });

    it('refuses a document declaring no usable grant or response type', async () => {
        const noGrant = await service(
            stubFetch({ ...VALID_DOCUMENT, grant_types: ['client_credentials'] }),
        ).fetchMetadata({ clientId: CLIENT_ID });
        const noResponse = await service(stubFetch({ ...VALID_DOCUMENT, response_types: ['token'] })).fetchMetadata({
            clientId: CLIENT_ID,
        });

        expect(noGrant.ok).toBe(false);
        expect(noResponse.ok).toBe(false);
    });

    // RFC 7591 §2 assigns defaults to a document that declares neither.
    it('accepts a document that declares neither grant nor response types', async () => {
        const result = await service(
            stubFetch({ client_id: CLIENT_ID, redirect_uris: ['https://client.example/callback'] }),
        ).fetchMetadata({ clientId: CLIENT_ID });

        expect(result.ok).toBe(true);
    });

    it('refuses a redirect_uri that is not a URL', async () => {
        const result = await service(stubFetch({ ...VALID_DOCUMENT, redirect_uris: ['nonsense'] })).fetchMetadata({
            clientId: CLIENT_ID,
        });

        expect(result.ok).toBe(false);
    });

    it('refuses a non-JSON content type, a non-200, and an unparseable body', async () => {
        await expect(
            service(stubFetch(VALID_DOCUMENT, { headers: { 'content-type': 'text/html' } })).fetchMetadata({
                clientId: CLIENT_ID,
            }),
        ).resolves.toMatchObject({ ok: false });
        await expect(
            service(stubFetch(VALID_DOCUMENT, { status: 404 })).fetchMetadata({ clientId: CLIENT_ID }),
        ).resolves.toMatchObject({ ok: false });
        await expect(
            service(stubFetch('{ not json', { headers: { 'content-type': 'application/json' } })).fetchMetadata({
                clientId: CLIENT_ID,
            }),
        ).resolves.toMatchObject({ ok: false });
    });

    it('refuses a document larger than the cap', async () => {
        const oversized = { ...VALID_DOCUMENT, client_name: 'x'.repeat(MAX_METADATA_BYTES) };

        const result = await service(stubFetch(oversized)).fetchMetadata({ clientId: CLIENT_ID });

        expect(result.ok).toBe(false);
    });

    // A `content-length` header is a claim. A server that omits it must not be able to make this
    // process buffer an endless body, so the cap is enforced while reading rather than after.
    it('stops reading a body that never ends and declares no length', async () => {
        let emitted = 0;

        const endless: FetchLike = async () =>
            new Response(
                new ReadableStream<Uint8Array>({
                    pull(controller) {
                        emitted += 1;
                        controller.enqueue(new Uint8Array(16 * 1024));
                    },
                }),
                { headers: { 'content-type': 'application/json' } },
            );

        const result = await service(endless).fetchMetadata({ clientId: CLIENT_ID });

        expect(result).toMatchObject({ ok: false, reason: 'document too large' });
        // Bounded by the cap, not by the stream deciding to stop.
        expect(emitted).toBeLessThanOrEqual(MAX_METADATA_BYTES / (16 * 1024) + 2);
    });

    it('refuses a document whose declared content-length already exceeds the cap', async () => {
        const declaresTooMuch: FetchLike = async () =>
            new Response('{}', {
                headers: {
                    'content-type': 'application/json',
                    'content-length': String(MAX_METADATA_BYTES + 1),
                },
            });

        const result = await service(declaresTooMuch).fetchMetadata({ clientId: CLIENT_ID });

        expect(result).toMatchObject({ ok: false, reason: 'document too large' });
    });

    it('clamps the origin cache-control into this server bounds', async () => {
        const short = await service(
            stubFetch(VALID_DOCUMENT, {
                headers: { 'content-type': 'application/json', 'cache-control': 'max-age=1' },
            }),
        ).fetchMetadata({ clientId: CLIENT_ID });
        const long = await service(
            stubFetch(VALID_DOCUMENT, {
                headers: { 'content-type': 'application/json', 'cache-control': 'max-age=99999999' },
            }),
        ).fetchMetadata({ clientId: CLIENT_ID });

        expect(short).toMatchObject({ ok: true, ttlMs: MIN_METADATA_TTL_MS });
        expect(long).toMatchObject({ ok: true, ttlMs: MAX_METADATA_TTL_MS });
    });

    it('reports a transport failure rather than throwing', async () => {
        const result = await service(async () => {
            throw new Error('connect ECONNREFUSED');
        }).fetchMetadata({ clientId: CLIENT_ID });

        expect(result).toMatchObject({ ok: false });
    });

    // A redirect would take the fetch off the allowlisted host and break the client_id equality.
    it('asks fetch to refuse redirects', async () => {
        let seen: RequestInit | undefined;

        await service(async (_url, init) => {
            seen = init;

            return new Response(JSON.stringify(VALID_DOCUMENT), { headers: { 'content-type': 'application/json' } });
        }).fetchMetadata({ clientId: CLIENT_ID });

        expect(seen?.redirect).toBe('error');
    });
});
