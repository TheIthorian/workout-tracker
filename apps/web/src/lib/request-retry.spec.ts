import { describe, expect, it } from 'vitest';
import { retryDelayFor } from './request-retry';

const policy = { maxAttempts: 5, initialDelayMs: 500, maxDelayMs: 8_000 };

// A sleeping Railway database refuses the API's first query after idling, and the API answers that
// with a 503. Surfacing it as a failed "log set" is the bug these retries exist to prevent.
describe('retryDelayFor', () => {
    it('retries a 503 on a write, because no handler ran', () => {
        expect(retryDelayFor({ method: 'post', status: 503, attempt: 1, policy })).toBe(500);
    });

    it('backs off exponentially', () => {
        const delays = [1, 2, 3, 4].map((attempt) => retryDelayFor({ method: 'get', status: 502, attempt, policy }));

        expect(delays).toEqual([500, 1_000, 2_000, 4_000]);
    });

    it('gives up once the attempts are spent', () => {
        expect(retryDelayFor({ method: 'get', status: 503, attempt: 5, policy })).toBeNull();
    });

    it('does not retry a status the app itself produced', () => {
        expect(retryDelayFor({ method: 'get', status: 500, attempt: 1, policy })).toBeNull();
        expect(retryDelayFor({ method: 'get', status: 401, attempt: 1, policy })).toBeNull();
    });

    it('retries a read that got no response', () => {
        expect(retryDelayFor({ method: 'get', status: undefined, attempt: 1, policy })).toBe(500);
    });

    // The request may have been handled with only the reply lost, so repeating it could log a set twice.
    it('does not retry a write that got no response', () => {
        expect(retryDelayFor({ method: 'post', status: undefined, attempt: 1, policy })).toBeNull();
    });
});
