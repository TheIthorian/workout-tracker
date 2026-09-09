import { describe, it, expect } from 'vitest';
import { bindRequestUser, getRequestContext, runWithRequestContext } from './request-context.js';

describe('request context', () => {
    it('returns undefined outside a request', () => {
        expect(getRequestContext()).toBeUndefined();
    });

    it('exposes the context inside the callback', () => {
        const seen = runWithRequestContext({
            context: { requestId: 'req-1' },
            fn: () => getRequestContext(),
        });

        expect(seen).toEqual({ requestId: 'req-1' });
    });

    it('keeps concurrent requests apart', async () => {
        const run = (requestId: string): Promise<string | undefined> =>
            runWithRequestContext({
                context: { requestId },
                fn: async () => {
                    await new Promise((resolve) => setTimeout(resolve, requestId === 'a' ? 20 : 1));

                    return getRequestContext()?.requestId;
                },
            });

        await expect(Promise.all([run('a'), run('b')])).resolves.toEqual(['a', 'b']);
    });

    it('binds the user onto the request already in flight', () => {
        const seen = runWithRequestContext({
            context: { requestId: 'req-1' },
            fn: () => {
                bindRequestUser({ userId: 'user-1' });

                return getRequestContext();
            },
        });

        expect(seen).toEqual({ requestId: 'req-1', userId: 'user-1' });
    });

    it('ignores a user binding made outside a request', () => {
        expect(() => bindRequestUser({ userId: 'user-1' })).not.toThrow();
    });

    it('carries an optional correlation id alongside the request id', () => {
        const seen = runWithRequestContext({
            context: { requestId: 'req-1', correlationId: 'corr-1' },
            fn: () => getRequestContext(),
        });

        expect(seen).toEqual({ requestId: 'req-1', correlationId: 'corr-1' });
    });
});
