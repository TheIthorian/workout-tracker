/**
 * Returns true when a `client_id` is a Client ID Metadata Document URL: an https URL with a path
 * component, no fragment and no embedded credentials
 * (draft-ietf-oauth-client-id-metadata-document §3).
 *
 * A bare origin is refused along with everything else: the document has to live somewhere the
 * client chose to publish it, not at the root of whatever host serves it.
 */
export function isClientIdMetadataDocumentUrl(clientId: string): boolean {
    if (!URL.canParse(clientId)) return false;

    const url = new URL(clientId);

    if (url.protocol !== 'https:') return false;

    if (url.pathname === '' || url.pathname === '/') return false;

    if (url.hash.length > 0) return false;

    // Credentials in the URL would be sent on every fetch of the document.
    return url.username === '' && url.password === '';
}

/**
 * Parses the configured verified-client list: whole `client_id` URLs, or path prefixes ending in
 * `/`. Anything that is not a usable https URL with a path is dropped rather than silently
 * matching nothing.
 */
export function parseVerifiedClientIds(raw: string): string[] {
    return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && isClientIdMetadataDocumentUrl(entry.endsWith('/') ? `${entry}x` : entry))
        .map((entry) => new URL(entry).href);
}

/**
 * Whether this deployment vouches for the party publishing a metadata document.
 *
 * Matching is on the whole URL, never the host alone. A host says nothing about who wrote the
 * document it serves: `claude.ai` serves both Claude's own metadata document and every published
 * Artifact, and trusting the host would vouch for anything any user put there. An entry ending in
 * `/` matches by path prefix, so a vendor publishing one document per client lists the directory
 * once; the trailing slash is required, otherwise `…/oauth` would also vouch for `…/oauthevil`.
 *
 * Both sides are compared as parsed URLs, so `..` segments and host casing cannot be used to dress
 * one path up as another.
 */
export function isVerifiedClientId({
    clientId,
    verifiedClientIds,
}: {
    clientId: string;
    verifiedClientIds: string[];
}): boolean {
    if (!URL.canParse(clientId)) return false;

    const candidate = new URL(clientId).href;

    return verifiedClientIds.some((entry) =>
        entry.endsWith('/') ? candidate.startsWith(entry) && candidate.length > entry.length : candidate === entry,
    );
}
