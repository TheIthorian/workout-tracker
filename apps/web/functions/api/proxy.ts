/**
 * Rewrite a browser request for `/api/*` into a request against the API origin.
 *
 * The path prefix is kept, not stripped: the API's own routes are mounted under `/api/v1`, so
 * `/api/v1/me` in the browser is `/api/v1/me` on the API.
 */
export function buildProxyRequest({ request, apiOrigin }: { request: Request; apiOrigin: string }): Request {
    const url = new URL(request.url);
    const target = new URL(`${url.pathname}${url.search}`, apiOrigin);

    // Cloning the original request preserves streamed bodies; a hand-built init loses them
    // and needs `duplex: 'half'`.
    return new Request(target, request);
}
