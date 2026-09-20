/**
 * Returns true when a `client_id` is a Client ID Metadata Document URL: an https URL with a path
 * component, no fragment and no embedded credentials
 * (draft-ietf-oauth-client-id-metadata-document §3).
 *
 * A bare origin is refused along with everything else: the document has to live somewhere the
 * client chose to publish it, not at the root of whatever host happens to be allowlisted.
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
 * Splits the configured allowlist into hostnames. Entries are compared exactly and
 * case-insensitively, so a subdomain has to be listed in its own right.
 */
export function parseAllowedClientDomains(raw: string): string[] {
    return raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0);
}

/**
 * Whether the host serving a client's metadata document is one this deployment has chosen to
 * accept.
 *
 * Exact host match, never a suffix match: `evil-claude.ai` ends with `claude.ai`, and a host that
 * merely ends with an allowlisted one is a different party. A deployment that wants a subdomain
 * lists the subdomain.
 */
export function isAllowlistedClientDomain({
    clientId,
    allowedDomains,
}: {
    clientId: string;
    allowedDomains: string[];
}): boolean {
    if (!URL.canParse(clientId)) return false;

    return allowedDomains.includes(new URL(clientId).hostname.toLowerCase());
}
