import { OAuthErrorCode, type ClientIdMetadata } from '@app/api-contract';
import { schema, type Db } from '@app/db';
import { eq } from 'drizzle-orm';
import { isClientIdMetadataDocumentUrl, isVerifiedClientId } from './client-id.js';
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
    /** Whether this deployment vouches for the client. Never a gate; the consent screen says so. */
    verified: boolean;
};

export type ClientResolution =
    | { ok: true; client: ResolvedOAuthClient }
    | { ok: false; code: OAuthErrorCode; description: string };

/**
 * Resolves a `client_id` to the client it names.
 *
 * One gate: the id has to be a Client ID Metadata Document URL, because this server issues no
 * client ids and runs no registration endpoint. Any such client may then authorize — publishing a
 * document is a claim anyone can make, and refusing every unknown one would make this server
 * usable only by clients an operator had heard of.
 *
 * What the verified list changes is what the user is told, not who gets in: a client outside it
 * reaches the consent screen carrying an unverified warning that names where approving would send
 * them. It is evaluated per read rather than stored, so editing the list takes effect without
 * waiting for cached documents to expire.
 */
export class OAuthClientsService {
    private readonly db: Db;
    private readonly metadata: ClientIdMetadataService;
    private readonly verifiedClientIds: string[];

    constructor({
        db,
        metadata,
        verifiedClientIds,
    }: {
        db: Db;
        metadata: ClientIdMetadataService;
        verifiedClientIds: string[];
    }) {
        this.db = db;
        this.metadata = metadata;
        this.verifiedClientIds = verifiedClientIds;
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

        const cached = await this.findCached({ clientId });

        if (cached && !isExpired(cached.metadataExpiresAt)) return { ok: true, client: this.present(cached) };

        const fetched = await this.metadata.fetchMetadata({ clientId });

        if (!fetched.ok) {
            if (cached) return { ok: true, client: this.present(cached) };

            return {
                ok: false,
                code: OAuthErrorCode.InvalidClient,
                description: `Could not read the client's metadata document: ${fetched.reason}`,
            };
        }

        const cachedNow = await this.cache({ clientId, metadata: fetched.metadata, ttlMs: fetched.ttlMs });

        return { ok: true, client: this.present(cachedNow) };
    }

    /** Whether this deployment vouches for a client, without fetching or resolving anything. */
    isVerified({ clientId }: { clientId: string }): boolean {
        return isVerifiedClientId({ clientId, verifiedClientIds: this.verifiedClientIds });
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

    private present(row: CachedClient): ResolvedOAuthClient {
        return { ...toResolved(row), verified: this.isVerified({ clientId: row.clientId }) };
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
function toResolved(row: CachedClient): Omit<ResolvedOAuthClient, 'verified'> {
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
