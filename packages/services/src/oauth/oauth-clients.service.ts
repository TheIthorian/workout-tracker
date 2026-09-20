import { OAuthErrorCode, type ClientIdMetadata } from '@app/api-contract';
import { schema, type Db } from '@app/db';
import { eq } from 'drizzle-orm';
import { isAllowlistedClientDomain, isClientIdMetadataDocumentUrl } from './client-id.js';
import type { ClientIdMetadataService } from './client-id-metadata.service.js';

const { oauthClients } = schema;

/** A client this server is willing to talk to, as last described by its metadata document. */
export type ResolvedOAuthClient = {
    clientId: string;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
    tosUri: string | null;
    policyUri: string | null;
    redirectUris: string[];
};

export type ClientResolution =
    | { ok: true; client: ResolvedOAuthClient }
    | { ok: false; code: OAuthErrorCode; description: string };

/**
 * Resolves a `client_id` to the client it names.
 *
 * Two gates, in this order and for different reasons: the id has to be a Client ID Metadata
 * Document URL, because this server issues no client ids and runs no registration endpoint; and its
 * host has to be on the deployment's allowlist, because publishing a document is a claim anyone can
 * make and the allowlist is where an operator says whose claims count. Only then is anything
 * fetched, which is also what keeps the fetch from being a server-side request forgery primitive.
 */
export class OAuthClientsService {
    private readonly db: Db;
    private readonly metadata: ClientIdMetadataService;
    private readonly allowedDomains: string[];

    constructor({
        db,
        metadata,
        allowedDomains,
    }: {
        db: Db;
        metadata: ClientIdMetadataService;
        allowedDomains: string[];
    }) {
        this.db = db;
        this.metadata = metadata;
        this.allowedDomains = allowedDomains;
    }

    /**
     * Resolves a client, refreshing its cached metadata document when the cached copy has expired.
     *
     * A document that has stopped resolving falls back to the last good copy: it does not retract
     * consent the user already gave, and a client whose CDN is briefly down is still that client.
     */
    async resolve({ clientId }: { clientId: string }): Promise<ClientResolution> {
        if (!isClientIdMetadataDocumentUrl(clientId)) {
            return {
                ok: false,
                code: OAuthErrorCode.UnsupportedClient,
                description: 'client_id must be an https URL serving a Client ID Metadata Document.',
            };
        }

        if (!isAllowlistedClientDomain({ clientId, allowedDomains: this.allowedDomains })) {
            return {
                ok: false,
                code: OAuthErrorCode.UnsupportedClient,
                description: 'This server does not accept clients from that domain.',
            };
        }

        const cached = await this.findCached({ clientId });

        if (cached && !isExpired(cached.metadataExpiresAt)) return { ok: true, client: toResolved(cached) };

        const fetched = await this.metadata.fetchMetadata({ clientId });

        if (!fetched.ok) {
            if (cached) return { ok: true, client: toResolved(cached) };

            return {
                ok: false,
                code: OAuthErrorCode.InvalidClient,
                description: `Could not read the client's metadata document: ${fetched.reason}`,
            };
        }

        return {
            ok: true,
            client: toResolved(await this.cache({ clientId, metadata: fetched.metadata, ttlMs: fetched.ttlMs })),
        };
    }

    /** The cached row for a client, without fetching anything. Null when the client is unknown. */
    async findCached({ clientId }: { clientId: string }): Promise<CachedClient | null> {
        const [row] = await this.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));

        return row ?? null;
    }

    private async cache({
        clientId,
        metadata,
        ttlMs,
    }: {
        clientId: string;
        metadata: ClientIdMetadata;
        ttlMs: number;
    }): Promise<CachedClient> {
        const values = {
            clientId,
            clientName: metadata.client_name ?? null,
            clientUri: metadata.client_uri ?? null,
            logoUri: metadata.logo_uri ?? null,
            tosUri: metadata.tos_uri ?? null,
            policyUri: metadata.policy_uri ?? null,
            redirectUris: metadata.redirect_uris,
            scopes: metadata.scope ? metadata.scope.split(/\s+/).filter(Boolean) : [],
            metadataExpiresAt: new Date(Date.now() + ttlMs).toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const [row] = await this.db
            .insert(oauthClients)
            .values(values)
            .onConflictDoUpdate({ target: oauthClients.clientId, set: values })
            .returning();

        return row;
    }
}

/** The cached client row, as both `resolve` and the Connected Apps screen read it. */
export type CachedClient = typeof oauthClients.$inferSelect;

/**
 * Presents a cached row as the client the rest of the flow works with.
 *
 * `logoUri` survives only when it is served from the same host as the metadata document. A logo is
 * loaded by the browser on the consent screen, so an arbitrary URI there would let a client point
 * the user's browser at a third party at exactly the moment they are being asked to trust it.
 */
function toResolved(row: CachedClient): ResolvedOAuthClient {
    return {
        clientId: row.clientId,
        clientName: row.clientName ?? new URL(row.clientId).hostname,
        clientUri: row.clientUri,
        logoUri: sameHostHttpsUri({ candidate: row.logoUri, clientId: row.clientId }),
        tosUri: row.tosUri,
        policyUri: row.policyUri,
        redirectUris: row.redirectUris,
    };
}

function sameHostHttpsUri({ candidate, clientId }: { candidate: string | null; clientId: string }): string | null {
    if (!candidate || !URL.canParse(candidate)) return null;

    const uri = new URL(candidate);

    if (uri.protocol !== 'https:') return null;

    return uri.hostname === new URL(clientId).hostname ? candidate : null;
}

function isExpired(timestamp: string): boolean {
    return new Date(timestamp).getTime() <= Date.now();
}
