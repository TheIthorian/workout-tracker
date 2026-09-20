import { clientIdMetadataSchema, OAuthGrantType, OAuthResponseType, type ClientIdMetadata } from '@app/api-contract';

/** A document larger than this is not a client's metadata, whatever else it is. */
export const MAX_METADATA_BYTES = 64 * 1024;

/** Bounds on how long a fetched document is reused, whatever the origin's cache headers claim. */
export const MIN_METADATA_TTL_MS = 5 * 60 * 1000;
export const MAX_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

/** How long the document fetch may take before the authorization request fails instead of hanging. */
export const METADATA_FETCH_TIMEOUT_MS = 5_000;

/** The subset of `fetch` this service uses, so a test supplies its own without a global stub. */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type ClientIdMetadataResult =
    | { ok: true; metadata: ClientIdMetadata; ttlMs: number }
    | { ok: false; reason: string };

/**
 * Fetches and validates a Client ID Metadata Document from the `client_id` URL itself.
 *
 * It performs no allowlist check of its own — {@link OAuthClientsService} rejects a host this
 * deployment has not accepted before anything here runs, which is also what keeps this fetch from
 * being an open server-side request forgery primitive.
 */
export class ClientIdMetadataService {
    private readonly fetch: FetchLike;

    constructor({ fetch: fetchImpl }: { fetch?: FetchLike } = {}) {
        this.fetch = fetchImpl ?? globalThis.fetch;
    }

    /** Fetches the document at `clientId` and validates that it really describes that client. */
    async fetchMetadata({ clientId }: { clientId: string }): Promise<ClientIdMetadataResult> {
        const response = await this.request({ clientId });

        if (!response.ok) return response;

        const parsed = clientIdMetadataSchema.safeParse(response.json);

        if (!parsed.success) {
            return { ok: false, reason: parsed.error.issues.map((issue) => issue.message).join('; ') };
        }

        const metadata = parsed.data;

        if (metadata.client_id !== clientId) {
            return { ok: false, reason: 'document declares a different client_id than the URL it was served from' };
        }

        if (!declares({ declared: metadata.grant_types, required: OAuthGrantType.AuthorizationCode })) {
            return { ok: false, reason: 'document does not declare the authorization_code grant' };
        }

        if (!declares({ declared: metadata.response_types, required: OAuthResponseType.Code })) {
            return { ok: false, reason: 'document does not declare the code response type' };
        }

        if (metadata.redirect_uris.some((uri) => !URL.canParse(uri))) {
            return { ok: false, reason: 'document declares a redirect_uri that is not a URL' };
        }

        return { ok: true, metadata, ttlMs: cacheTtlMs(response.cacheControl) };
    }

    private async request({
        clientId,
    }: {
        clientId: string;
    }): Promise<{ ok: true; json: unknown; cacheControl: string | null } | { ok: false; reason: string }> {
        try {
            const response = await this.fetch(clientId, {
                method: 'GET',
                headers: { accept: 'application/json' },
                // A redirect would make the document's `client_id` disagree with the URL it was
                // requested from, and could move the fetch off the allowlisted host entirely.
                redirect: 'error',
                signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
            });

            if (!response.ok) return { ok: false, reason: `origin answered ${response.status}` };

            const contentType = response.headers.get('content-type') ?? '';

            if (!contentType.toLowerCase().includes('application/json')) {
                return { ok: false, reason: `unexpected content-type ${contentType || '(none)'}` };
            }

            const body = Buffer.from(await response.arrayBuffer());

            if (body.byteLength > MAX_METADATA_BYTES) return { ok: false, reason: 'document too large' };

            return {
                ok: true,
                json: JSON.parse(body.toString('utf8')),
                cacheControl: response.headers.get('cache-control'),
            };
        } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : 'fetch failed' };
        }
    }
}

/** A document that declares nothing is taken to want the defaults RFC 7591 §2 assigns it. */
function declares({ declared, required }: { declared: string[] | undefined; required: string }): boolean {
    return declared === undefined || declared.includes(required);
}

/** `max-age` from a `Cache-Control` response header, clamped to this server's own bounds. */
function cacheTtlMs(cacheControl: string | null): number {
    const directives = cacheControl ?? '';

    if (/(?:^|,)\s*no-(?:store|cache)\s*(?:,|$)/i.test(directives)) return MIN_METADATA_TTL_MS;

    const maxAge = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(directives);

    if (!maxAge?.[1]) return MIN_METADATA_TTL_MS;

    return Math.min(Math.max(Number(maxAge[1]) * 1000, MIN_METADATA_TTL_MS), MAX_METADATA_TTL_MS);
}
