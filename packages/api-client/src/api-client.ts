import { toAppError, type ProblemBody } from './problem.js';

/** The subset of `fetch` this client uses, so a test supplies its own without a global stub. */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type ApiClientConfig = {
    /** The API's origin, without the `/api/v1` prefix. Trailing slashes are tolerated. */
    baseUrl: string;
    /** The MCP personal access token, forwarded as a bearer on every request. */
    token: string;
    /** Injected so tests never reach the network. Defaults to the global `fetch`. */
    fetch?: FetchLike;
};

/** Query values a caller may pass; `undefined` entries are dropped rather than sent as "undefined". */
export type QueryValue = string | number | boolean | undefined;

const API_PREFIX = '/api/v1';

/**
 * One typed `fetch` client for `apps/api`, holding the caller's token.
 *
 * It is constructed per MCP request rather than once per process, because the token IS the identity
 * - a shared client would either leak one caller's credential into another's request or need the
 * token threaded through every call site anyway.
 */
export class ApiClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly fetch: FetchLike;

    constructor(config: ApiClientConfig) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
        this.token = config.token;
        this.fetch = config.fetch ?? globalThis.fetch;
    }

    /** GET, with optional query parameters. */
    async get<T>({ path, query }: { path: string; query?: Record<string, QueryValue> }): Promise<T> {
        return this.send<T>({ method: 'GET', path, query });
    }

    /** POST with a JSON body. */
    async post<T>({ path, body }: { path: string; body?: unknown }): Promise<T> {
        return this.send<T>({ method: 'POST', path, body });
    }

    /** PATCH with a JSON body. */
    async patch<T>({ path, body }: { path: string; body?: unknown }): Promise<T> {
        return this.send<T>({ method: 'PATCH', path, body });
    }

    /** PUT with a JSON body. */
    async put<T>({ path, body }: { path: string; body?: unknown }): Promise<T> {
        return this.send<T>({ method: 'PUT', path, body });
    }

    /** DELETE. Named with a trailing underscore because `delete` is a reserved word. */
    async delete_({ path }: { path: string }): Promise<void> {
        await this.send<void>({ method: 'DELETE', path });
    }

    private async send<T>({
        method,
        path,
        body,
        query,
    }: {
        method: string;
        path: string;
        body?: unknown;
        query?: Record<string, QueryValue>;
    }): Promise<T> {
        const url = new URL(`${this.baseUrl}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`);

        for (const [key, value] of Object.entries(query ?? {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }

        const response = await this.fetch(url.toString(), {
            method,
            headers: {
                authorization: `Bearer ${this.token}`,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

        if (!response.ok) throw toAppError({ status: response.status, body: await readProblem(response) });

        // An empty body, not just a bare `204`: Nest's default success status for a void-returning
        // `@Delete()` handler with no explicit `@HttpCode` is `200`, not `204`, so a status-only
        // check would throw trying to JSON-parse nothing.
        const text = await response.text();
        if (text.length === 0) return undefined as T;

        return JSON.parse(text) as T;
    }
}

/** A problem body that is not JSON must not mask the status code, which is the part that matters. */
async function readProblem(response: Response): Promise<ProblemBody> {
    try {
        return (await response.json()) as ProblemBody;
    } catch {
        return { title: response.statusText };
    }
}
