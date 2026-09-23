import { describe, expect, it } from 'vitest';
import { AppError } from '@app/errors';
import { ApiClient } from './api-client.js';
import type { RetryPolicy } from './retry.js';

function clientWith(handler: (url: string, init: RequestInit) => Response): ApiClient {
    return new ApiClient({
        baseUrl: 'https://api.test',
        token: 'tok',
        fetch: async (url, init) => handler(String(url), init ?? {}),
    });
}

describe('ApiClient', () => {
    it('prefixes /api/v1 and forwards the token as a bearer', async () => {
        let seen: { url: string; auth: string | undefined } | undefined;
        const client = clientWith((url, init) => {
            seen = { url, auth: new Headers(init.headers).get('authorization') ?? undefined };
            return new Response(JSON.stringify({ id: 'r1' }), { status: 200 });
        });

        await expect(client.get<{ id: string }>({ path: '/exercises/e1' })).resolves.toEqual({
            id: 'r1',
        });
        expect(seen?.url).toBe('https://api.test/api/v1/exercises/e1');
        expect(seen?.auth).toBe('Bearer tok');
    });

    it('appends only the query parameters that have a value', async () => {
        let seen = '';
        const client = clientWith((url) => {
            seen = url;
            return new Response('[]', { status: 200 });
        });

        await client.get({ path: '/exercises', query: { page: 2, search: undefined, sort: 'name' } });

        expect(seen).toBe('https://api.test/api/v1/exercises?page=2&sort=name');
    });

    // The mapped error must be the API's own problem body, not a locally reconstructed subclass -
    // see problem.ts. Asserting on `problem` (rather than `toThrow(SomeSubclass)`) is what proves
    // that: a reconstructed `EntityNotFoundError` would also satisfy `toBeInstanceOf(AppError)`,
    // but it would carry a locally-invented `type`/`title` instead of the API's.
    it('throws the mapped AppError for a problem response, carrying the problem body through', async () => {
        const client = clientWith(
            () => new Response(JSON.stringify({ title: 'Not Found', detail: 'gone', status: 404 }), { status: 404 }),
        );

        const failure = client.get({ path: '/exercises/e1' });

        await expect(failure).rejects.toBeInstanceOf(AppError);
        await expect(failure).rejects.toMatchObject({
            problem: { title: 'Not Found', detail: 'gone', status: 404 },
        });
    });

    // readProblem's non-JSON fallback (api-client.ts) must not mask the status code - that is the
    // part of a failure a caller can always act on, even when the body itself is unreadable (e.g.
    // an upstream proxy's plain-text 502 page, or a 4xx from something that isn't apps/api at all).
    it('still reports the real status when the error body is not JSON', async () => {
        const client = clientWith(() => new Response('<html>not found</html>', { status: 404 }));

        const failure = client.get({ path: '/exercises/e1' });

        await expect(failure).rejects.toBeInstanceOf(AppError);
        await expect(failure).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns undefined for 204', async () => {
        const client = clientWith(() => new Response(null, { status: 204 }));

        await expect(client.delete_({ path: '/exercises/e1' })).resolves.toBeUndefined();
    });

    // Nest's default success status for a void-returning `@Delete()` handler with no explicit
    // `@HttpCode` is 200, not 204, for a void-returning `@Delete()` - an empty-but-ok body must
    // resolve the same way a 204's does, rather than failing to JSON-parse nothing.
    it('returns undefined for a 200 with an empty body', async () => {
        const client = clientWith(() => new Response('', { status: 200 }));

        await expect(client.delete_({ path: '/exercises/e1' })).resolves.toBeUndefined();
    });
});

/** One queued attempt: either the response the server gives, or the transport failure it throws. */
type Attempt = () => Response;

function retryingClientWith({ attempts, retry }: { attempts: Attempt[]; retry?: Partial<RetryPolicy> }): {
    client: ApiClient;
    delays: number[];
    attemptCount: () => number;
} {
    const delays: number[] = [];
    let made = 0;

    const client = new ApiClient({
        baseUrl: 'https://api.test',
        token: 'tok',
        retry,
        sleep: async (ms) => {
            delays.push(ms);
        },
        fetch: async () => (attempts[made++] ?? unqueued)(),
    });

    return { client, delays, attemptCount: () => made };
}

const asleep: Attempt = () => new Response('<html>service unavailable</html>', { status: 503 });
const awake: Attempt = () => new Response(JSON.stringify({ id: 'e1' }), { status: 200 });

/** Never retried, so an attempt past the queued ones fails the test rather than looping. */
const unqueued: Attempt = () => new Response(JSON.stringify({ title: 'Unqueued attempt' }), { status: 500 });

// A container scaled to zero answers the first calls from its edge proxy, or refuses the connection
// outright, until it has booted. Surfacing that to an MCP client as a failed tool call is the bug
// this loop exists to prevent.
describe('ApiClient retries', () => {
    it('retries a gateway status until the server is awake', async () => {
        const { client, attemptCount } = retryingClientWith({ attempts: [asleep, asleep, awake] });

        await expect(client.get({ path: '/exercises/e1' })).resolves.toEqual({ id: 'e1' });
        expect(attemptCount()).toBe(3);
    });

    it('retries a refused connection', async () => {
        const refused: Attempt = () => {
            throw new TypeError('fetch failed');
        };
        const { client, attemptCount } = retryingClientWith({ attempts: [refused, refused, awake] });

        await expect(client.get({ path: '/exercises/e1' })).resolves.toEqual({ id: 'e1' });
        expect(attemptCount()).toBe(3);
    });

    // Retrying a POST is safe for these conditions specifically: each one means no handler ever saw
    // the request, so the retry cannot duplicate a logged set.
    it('retries a write, re-sending its body and bearer', async () => {
        const sent: { method: string | undefined; body: string | undefined; auth: string | null }[] = [];
        const client = new ApiClient({
            baseUrl: 'https://api.test',
            token: 'tok',
            sleep: async () => {},
            fetch: async (_url, init) => {
                sent.push({
                    method: init?.method,
                    body: typeof init?.body === 'string' ? init.body : undefined,
                    auth: new Headers(init?.headers).get('authorization'),
                });

                return sent.length === 1 ? asleep() : awake();
            },
        });

        await expect(client.post({ path: '/exercises', body: { name: 'Squat' } })).resolves.toEqual({ id: 'e1' });
        expect(sent).toEqual([
            { method: 'POST', body: '{"name":"Squat"}', auth: 'Bearer tok' },
            { method: 'POST', body: '{"name":"Squat"}', auth: 'Bearer tok' },
        ]);
    });

    it('doubles each delay up to maxDelayMs', async () => {
        const { client, delays } = retryingClientWith({
            attempts: [asleep, asleep, asleep, asleep, awake],
            retry: { initialDelayMs: 500, maxDelayMs: 2_000 },
        });

        await client.get({ path: '/exercises/e1' });

        expect(delays).toEqual([500, 1_000, 2_000, 2_000]);
    });

    it('reports the failure once the attempts are spent', async () => {
        const { client, attemptCount } = retryingClientWith({
            attempts: [asleep, asleep],
            retry: { maxAttempts: 2 },
        });

        await expect(client.get({ path: '/exercises/e1' })).rejects.toThrow(/503/);
        expect(attemptCount()).toBe(2);
    });

    // A 500 came from the app, so the request was handled and repeating it just fails again.
    it('does not retry a status the app itself produced', async () => {
        const { client, attemptCount } = retryingClientWith({
            attempts: [() => new Response(JSON.stringify({ title: 'Internal Server Error' }), { status: 500 })],
        });

        await expect(client.get({ path: '/exercises/e1' })).rejects.toThrow(/500/);
        expect(attemptCount()).toBe(1);
    });

    it('does not retry a 404', async () => {
        const { client, attemptCount } = retryingClientWith({
            attempts: [() => new Response(JSON.stringify({ title: 'Not Found' }), { status: 404 })],
        });

        await expect(client.get({ path: '/exercises/e1' })).rejects.toBeInstanceOf(AppError);
        expect(attemptCount()).toBe(1);
    });

    it('does not retry an aborted request', async () => {
        const aborted: Attempt = () => {
            throw new DOMException('The operation was aborted.', 'AbortError');
        };
        const { client, attemptCount } = retryingClientWith({ attempts: [aborted, awake] });

        await expect(client.get({ path: '/exercises/e1' })).rejects.toThrow(/aborted/);
        expect(attemptCount()).toBe(1);
    });
});
