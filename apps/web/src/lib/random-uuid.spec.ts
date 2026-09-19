// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from './random-uuid';
import { withoutRandomUUID } from './testing';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('randomUuid', () => {
    it('uses the platform generator where the page has one', () => {
        const native = vi.spyOn(crypto, 'randomUUID').mockReturnValue('3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d');

        expect(randomUuid()).toBe('3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d');
        expect(native).toHaveBeenCalledOnce();
    });

    it('still returns a v4 uuid on a page with no secure context', async () => {
        await withoutRandomUUID(() => {
            expect(randomUuid()).toMatch(UUID_V4);
        });
    });

    it('sets the version and variant bits the fallback is responsible for', async () => {
        await withoutRandomUUID(() => {
            // 0xff everywhere would leave version 'f' and variant 'f' if the bits were not masked.
            vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
                new Uint8Array((array as Uint8Array).buffer).fill(0xff);
                return array;
            });

            expect(randomUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
        });
    });

    it('does not repeat itself', async () => {
        await withoutRandomUUID(() => {
            const ids = new Set(Array.from({ length: 200 }, () => randomUuid()));

            expect(ids.size).toBe(200);
        });
    });
});
