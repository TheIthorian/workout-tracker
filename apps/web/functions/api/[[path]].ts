import { buildProxyRequest } from './proxy.js';

type Env = {
    API_ORIGIN: string;
};

/**
 * Same-origin proxy for the API. Everything under /api is forwarded to API_ORIGIN so the browser
 * and the API share an origin.
 *
 * This is what makes the deployed app work at all: the session cookie is SameSite=Lax, which a
 * browser will not send from a pages.dev origin to the API's own host. Behind this proxy the
 * cookie is first-party, and the Vite dev proxy's behaviour is reproduced in production.
 */
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
    if (!env.API_ORIGIN) {
        return new Response('API_ORIGIN is not configured for this Pages project', { status: 500 });
    }

    return fetch(buildProxyRequest({ request, apiOrigin: env.API_ORIGIN }));
};
