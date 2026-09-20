/**
 * Whether a requested `redirect_uri` is one the client registered.
 *
 * Exact string comparison, with one exception RFC 8252 §7.3 requires: a native client listening on
 * loopback cannot know which port it will get, so a registered loopback URI matches any port as
 * long as scheme, host and path agree. The exception is confined to `127.0.0.1` and `[::1]` —
 * `localhost` is excluded, as RFC 8252 §8.3 asks, because it resolves through whatever the host's
 * name resolution says.
 */
export function isRedirectUriPermitted({
    registered,
    requested,
}: {
    registered: string[];
    requested: string;
}): boolean {
    if (registered.includes(requested)) return true;

    if (!URL.canParse(requested)) return false;

    const candidate = new URL(requested);

    if (!isLoopback(candidate)) return false;

    return registered.some((entry) => {
        if (!URL.canParse(entry)) return false;

        const known = new URL(entry);

        return (
            isLoopback(known) &&
            known.protocol === candidate.protocol &&
            known.hostname === candidate.hostname &&
            known.pathname === candidate.pathname
        );
    });
}

/** The hosts a native client may be redirected to on a port it could not register in advance. */
function isLoopback(url: URL): boolean {
    return url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
}
