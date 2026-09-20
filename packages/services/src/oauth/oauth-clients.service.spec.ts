import { OAuthErrorCode } from '@app/api-contract';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClientIdMetadataService, type FetchLike } from './client-id-metadata.service.js';
import { OAuthClientsService } from './oauth-clients.service.js';

const { oauthClients } = schema;

const CLIENT_ID = 'https://client.test/oauth-client';
const ALLOWED_DOMAINS = ['client.test'];

const DOCUMENT = {
    client_id: CLIENT_ID,
    client_name: 'Test Client',
    client_uri: 'https://client.test',
    logo_uri: 'https://client.test/logo.png',
    redirect_uris: ['https://client.test/callback'],
};

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
});

afterAll(async () => {
    await database?.stop();
});

function serviceWith(fetchImpl: FetchLike): OAuthClientsService {
    return new OAuthClientsService({
        db,
        metadata: new ClientIdMetadataService({ fetch: fetchImpl }),
        allowedDomains: ALLOWED_DOMAINS,
    });
}

function servingDocument(document: unknown = DOCUMENT): { fetch: FetchLike; calls: () => number } {
    let calls = 0;

    return {
        fetch: async () => {
            calls += 1;

            return new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } });
        },
        calls: () => calls,
    };
}

const failingFetch: FetchLike = async () => {
    throw new Error('origin unreachable');
};

describe('OAuthClientsService.resolve', () => {
    it('resolves an allowlisted client from its metadata document', async () => {
        const result = await serviceWith(servingDocument().fetch).resolve({ clientId: CLIENT_ID });

        expect(result).toMatchObject({
            ok: true,
            client: { clientId: CLIENT_ID, clientName: 'Test Client', redirectUris: ['https://client.test/callback'] },
        });
    });

    // The gate the whole design rests on: an unlisted host is refused before anything is fetched.
    it('refuses a client from a host that is not allowlisted, without fetching', async () => {
        const stub = servingDocument();

        const result = await serviceWith(stub.fetch).resolve({ clientId: 'https://elsewhere.test/oauth-client' });

        expect(result).toMatchObject({ ok: false, code: OAuthErrorCode.UnsupportedClient });
        expect(stub.calls()).toBe(0);
    });

    it('refuses a client_id that is not a metadata document URL, without fetching', async () => {
        const stub = servingDocument();

        const result = await serviceWith(stub.fetch).resolve({ clientId: 'some-registered-id' });

        expect(result).toMatchObject({ ok: false, code: OAuthErrorCode.UnsupportedClient });
        expect(stub.calls()).toBe(0);
    });

    it('refuses an allowlisted client whose document cannot be read and was never cached', async () => {
        const result = await serviceWith(failingFetch).resolve({ clientId: 'https://client.test/unknown-client' });

        expect(result).toMatchObject({ ok: false, code: OAuthErrorCode.InvalidClient });
    });

    it('serves the cached document without re-fetching while it is fresh', async () => {
        const clientId = 'https://client.test/fresh-client';
        const stub = servingDocument({ ...DOCUMENT, client_id: clientId });
        const service = serviceWith(stub.fetch);

        await service.resolve({ clientId });
        await service.resolve({ clientId });

        expect(stub.calls()).toBe(1);
    });

    // Consent the user already gave must not be retracted because a CDN is briefly down.
    it('falls back to the last good copy when a refresh fails', async () => {
        const clientId = 'https://client.test/stale-client';
        await serviceWith(servingDocument({ ...DOCUMENT, client_id: clientId }).fetch).resolve({ clientId });

        await db
            .update(oauthClients)
            .set({ metadataExpiresAt: new Date(Date.now() - 1_000).toISOString() })
            .where(eq(oauthClients.clientId, clientId));

        const result = await serviceWith(failingFetch).resolve({ clientId });

        expect(result).toMatchObject({ ok: true, client: { clientId, clientName: 'Test Client' } });
    });

    // A logo is loaded by the browser on the consent screen; an off-host one would point the user
    // at a third party at exactly the moment they are being asked to trust this client.
    it('drops a logo served from a different host than the metadata document', async () => {
        const clientId = 'https://client.test/offsite-logo-client';
        const stub = servingDocument({
            ...DOCUMENT,
            client_id: clientId,
            logo_uri: 'https://cdn.elsewhere.test/logo.png',
        });

        const result = await serviceWith(stub.fetch).resolve({ clientId });

        expect(result).toMatchObject({ ok: true, client: { logoUri: null } });
    });

    it('falls back to the host as a display name when the document names none', async () => {
        const clientId = 'https://client.test/anonymous-client';
        const stub = servingDocument({ client_id: clientId, redirect_uris: ['https://client.test/callback'] });

        const result = await serviceWith(stub.fetch).resolve({ clientId });

        expect(result).toMatchObject({ ok: true, client: { clientName: 'client.test' } });
    });
});
