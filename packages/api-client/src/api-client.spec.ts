import { describe, expect, it } from 'vitest';
import { AppError } from '@app/errors';
import { ApiClient } from './api-client.js';

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
