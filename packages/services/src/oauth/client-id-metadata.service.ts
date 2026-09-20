import { clientIdMetadataSchema, OAuthGrantType, OAuthResponseType, type ClientIdMetadata } from '@app/api-contract';
import { createSafeFetch, type FetchLike } from './safe-fetch.js';

/** A document larger than this is not a client's metadata, whatever else it is. */
export const MAX_METADATA_BYTES = 64 * 1024;

/** Bounds on how long a fetched document is reused, whatever the origin's cache headers claim. */
export const MIN_METADATA_TTL_MS = 5 * 60 * 1000;
export const MAX_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

/** How long the document fetch may take before the authorization request fails instead of hanging. */
export const METADATA_FETCH_TIMEOUT_MS = 5_000;

export type ClientIdMetadataResult =
    | { ok: true; metadata: ClientIdMetadata; ttlMs: number }
    | { ok: false; reason: string };

/**
 * Fetches and validates a Client ID Metadata Document from the `client_id` URL itself.
 *
 * Any user can name a `client_id`, so this reaches a URL nobody has vetted. Everything that follows
 * treats the response as hostile: {@link createSafeFetch} keeps the request on the public internet,
 * the body is read against a hard byte cap rather than buffered whole, and nothing is believed
 * until the schema and the `client_id` equality check have passed.
 */
export class ClientIdMetadataService {
    private readonly fetch: FetchLike;

    constructor({ fetch: fetchImpl }: { fetch?: FetchLike } = {}) {
        this.fetch = fetchImpl ?? createSafeFetch();
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
                // requested from, and would also escape the address check already made.
                redirect: 'error',
                signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
            });

            if (!response.ok) return { ok: false, reason: `origin answered ${response.status}` };

            const contentType = response.headers.get('content-type') ?? '';

            if (!contentType.toLowerCase().includes('application/json')) {
                return { ok: false, reason: `unexpected content-type ${contentType || '(none)'}` };
            }

            const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN);

            if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) {
                return { ok: false, reason: 'document too large' };
            }

            const body = await readCapped(response);

            if (body === null) return { ok: false, reason: 'document too large' };

            return { ok: true, json: JSON.parse(body), cacheControl: response.headers.get('cache-control') };
        } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : 'fetch failed' };
        }
    }
}

/**
 * Reads the body as text, giving up as soon as it passes the cap. Null when it does.
 *
 * Streaming rather than `response.text()`: a `content-length` header is a claim, and a server that
 * omits it or lies about it must not be able to make this process buffer an unbounded body.
 */
async function readCapped(response: Response): Promise<string | null> {
    const reader = response.body?.getReader();

    if (!reader) return '';

    const decoder = new TextDecoder();
    let read = 0;
    let text = '';

    try {
        for (;;) {
            const { done, value } = await reader.read();

            if (done) break;

            read += value.byteLength;

            if (read > MAX_METADATA_BYTES) return null;

            text += decoder.decode(value, { stream: true });
        }
    } finally {
        await reader.cancel().catch((): void => {});
    }

    return text + decoder.decode();
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
