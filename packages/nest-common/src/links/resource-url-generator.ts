import { Injectable } from '@nestjs/common';

/** The origins this generator builds absolute urls against. */
export type ResourceUrlConfig = {
    /** The SPA's origin. Trailing slashes are tolerated. */
    webAppBaseUrl: string;
    /** The REST API's origin, without the `/api/v1` prefix. Trailing slashes are tolerated. */
    apiBaseUrl: string;
    /** The MCP server's origin - `apps/mcp`, a separate deployment. Trailing slashes are tolerated. */
    mcpBaseUrl: string;
};

/**
 * DI token an app's own {@link ResourceUrlGenerator} provider must be reachable under. The
 * generator is built from configuration rather than reflected constructor types, so every consumer
 * resolves it through an explicit `@Inject()` - the same arrangement `SESSION_AUTH_SERVICE` uses,
 * for the reason documented there.
 */
export const RESOURCE_URL_GENERATOR = Symbol('RESOURCE_URL_GENERATOR');

/** Any payload with the two link fields attached. */
export type WithResourceUrls<T> = T & { webUrl: string; resourceUrl: string };

/** The version prefix every REST route sits under, applied by {@link ResourceUrlGenerator.apiUrl}. */
const API_PREFIX = '/api/v1';

/**
 * Builds absolute urls for anything this system exposes: a page in the web app, the API's own route
 * for the same thing, and the MCP endpoint an access token is used against. It knows
 * nothing about any particular resource - a caller supplies the path, and this turns it into an
 * absolute url against the right origin.
 *
 * It lives here, injectable and configured, because links are part of the API surface rather than
 * something each client derives: `apps/api` attaches them to the responses it serves, and
 * `apps/mcp` resolves the same generator from the same settings, so a resource reached through a
 * tool carries the identical urls to one reached over REST.
 *
 * Every origin is configuration rather than being derived from the current request. A
 * request-derived origin does not survive the split into separate processes - the request reaching
 * `apps/mcp` is addressed to the MCP host, not to the API its links point at - and it also follows
 * whatever a proxy puts in `X-Forwarded-Host`. The MCP origin is the sharpest case:
 * `GET /v1/me/mcp-connection` is served by `apps/api`, so a url built from that request's own host
 * addresses the API, which serves no `/mcp` route at all.
 *
 * Paths are passed in rather than looked up, because Nest has no named-route registry.
 */
@Injectable()
export class ResourceUrlGenerator {
    private readonly webAppBaseUrl: string;
    private readonly apiBaseUrl: string;
    private readonly mcpBaseUrl: string;

    constructor({ config }: { config: ResourceUrlConfig }) {
        this.webAppBaseUrl = stripTrailingSlashes(config.webAppBaseUrl);
        this.apiBaseUrl = stripTrailingSlashes(config.apiBaseUrl);
        this.mcpBaseUrl = stripTrailingSlashes(config.mcpBaseUrl);
    }

    /**
     * Absolute url for a page in the web app.
     *
     * @param path root-relative page path, e.g. `/exercises/{id}`.
     */
    webAppUrl({ path }: { path: string }): string {
        return `${this.webAppBaseUrl}${withLeadingSlash(path)}`;
    }

    /**
     * Absolute url for a route on this API, under the `/api/v1` prefix every route sits behind.
     *
     * @param path route path WITHOUT that prefix, e.g. `/exercises/{id}`.
     */
    apiUrl({ path }: { path: string }): string {
        return `${this.apiBaseUrl}${API_PREFIX}${withLeadingSlash(path)}`;
    }

    /**
     * Absolute url on this API's own origin, outside the `/api/v1` prefix. The OAuth issuer
     * identifier and the `.well-known` documents live here, because RFC 8414 derives their location
     * from the origin rather than from wherever the application mounts its routes.
     *
     * @param path root-relative path, e.g. `/.well-known/oauth-authorization-server`.
     */
    apiOriginUrl({ path }: { path: string }): string {
        return `${this.apiBaseUrl}${withLeadingSlash(path)}`;
    }

    /** The API's own origin, with no path. This is the OAuth issuer identifier. */
    get issuer(): string {
        return this.apiBaseUrl;
    }

    /**
     * Absolute url for a route on the MCP server, which is `apps/mcp` rather than this process.
     *
     * @param path route path on that server, e.g. `/mcp`.
     */
    mcpUrl({ path }: { path: string }): string {
        return `${this.mcpBaseUrl}${withLeadingSlash(path)}`;
    }

    /**
     * Attaches `webUrl` and `resourceUrl` to a payload, from the two paths its resource declares.
     * Generic on purpose: every resource attaches links the same way,
     * and only the caller knows which paths its resource lives at.
     */
    attach<T extends object>({
        resource,
        webPath,
        apiPath,
    }: {
        resource: T;
        webPath: string;
        apiPath: string;
    }): WithResourceUrls<T> {
        return {
            ...resource,
            webUrl: this.webAppUrl({ path: webPath }),
            resourceUrl: this.apiUrl({ path: apiPath }),
        };
    }
}

function stripTrailingSlashes(origin: string): string {
    return origin.replace(/\/+$/, '');
}

function withLeadingSlash(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
}
