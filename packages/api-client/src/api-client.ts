import { toAppError, type ProblemBody } from './problem.js';

/** The subset of `fetch` this client uses, so a test supplies its own without a global stub. */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Waits out a backoff delay, so a test drives the retry loop without real time passing. */
export type SleepLike = (ms: number) => Promise<void>;

/** How often, and how patiently, a request is retried while the API is unreachable. */
export type RetryPolicy = {
    /** Attempts in total, including the first. `1` disables retrying. */
    maxAttempts: number;
    /** Delay before the second attempt; each later delay doubles the previous one. */
    initialDelayMs: number;
    /** Upper bound on a single delay, so the doubling cannot run away. */
    maxDelayMs: number;
};

export type ApiClientConfig = {
    /** The API's origin, without the `/api/v1` prefix. Trailing slashes are tolerated. */
    baseUrl: string;
    /** The MCP OAuth access token, forwarded as a bearer on every request. */
    token: string;
    /** Injected so tests never reach the network. Defaults to the global `fetch`. */
    fetch?: FetchLike;
    /** Overrides individual {@link DEFAULT_RETRY_POLICY} fields. */
    retry?: Partial<RetryPolicy>;
    /** Injected so tests never wait out a backoff. Defaults to a `setTimeout` sleep. */
    sleep?: SleepLike;
};

/** Query values a caller may pass; `undefined` entries are dropped rather than sent as "undefined". */
export type QueryValue = string | number | boolean | undefined;

const API_PREFIX = '/api/v1';

/**
 * Spends about 7.5s across four backoffs, which covers a scale-to-zero cold start while staying
 * inside the time an MCP client will wait for a tool result.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
    maxAttempts: 5,
    initialDelayMs: 500,
    maxDelayMs: 8_000,
};

/**
 * Statuses an edge proxy emits when nothing is listening behind it yet. The app's own 500 is
 * deliberately absent: that one means the request WAS handled, and repeating it would only ask a
 * running server to fail the same way again.
 */
enum RetryableStatus {
    RequestTimeout = 408,
    BadGateway = 502,
    ServiceUnavailable = 503,
    GatewayTimeout = 504,
}

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
    private readonly retry: RetryPolicy;
    private readonly sleep: SleepLike;

    constructor(config: ApiClientConfig) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
        this.token = config.token;
        this.fetch = config.fetch ?? globalThis.fetch;
        this.retry = { ...DEFAULT_RETRY_POLICY, ...config.retry };
        this.sleep = config.sleep ?? sleepFor;
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

        const response = await this.sendWithRetry({
            url: url.toString(),
            init: {
                method,
                headers: {
                    authorization: `Bearer ${this.token}`,
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            },
        });

        if (!response.ok) throw toAppError({ status: response.status, body: await readProblem(response) });

        // An empty body, not just a bare `204`: Nest's default success status for a void-returning
        // `@Delete()` handler with no explicit `@HttpCode` is `200`, not `204`, so a status-only
        // check would throw trying to JSON-parse nothing.
        const text = await response.text();
        if (text.length === 0) return undefined as T;

        return JSON.parse(text) as T;
    }

    /**
     * Sends one request, retrying with exponential backoff while the API looks asleep rather than
     * broken: a refused or dropped connection, or a gateway status from the proxy in front of it.
     *
     * Every method is retried, not just the idempotent ones, because the conditions above all mean
     * the request never reached a handler - a running app that rejects or mishandles a request
     * answers with a status this loop passes straight back to the caller.
     */
    private async sendWithRetry({ url, init }: { url: string; init: RequestInit }): Promise<Response> {
        for (let attempt = 1; ; attempt++) {
            const isLastAttempt = attempt >= this.retry.maxAttempts;

            try {
                const response = await this.fetch(url, init);

                if (isLastAttempt || !isRetryableStatus(response.status)) return response;

                // An unread body holds its connection open, and this one is never looked at.
                void response.body?.cancel().catch(() => undefined);
            } catch (error) {
                if (isLastAttempt || isAbort(error)) throw error;
            }

            await this.sleep(this.backoffFor({ attempt }));
        }
    }

    /** The delay owed after `attempt`, doubling each time and clamped to the policy's ceiling. */
    private backoffFor({ attempt }: { attempt: number }): number {
        return Math.min(this.retry.initialDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs);
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

function isRetryableStatus(status: number): boolean {
    // A numeric enum carries a reverse mapping, so its own values are exactly its numeric keys.
    return status in RetryableStatus;
}

/** An abort is the caller's own decision, so it is the one transport failure not worth repeating. */
function isAbort(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function sleepFor(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
