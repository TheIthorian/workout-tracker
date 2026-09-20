import { describe, expect, it } from 'vitest';
import { BlockedAddressError, createSafeFetch } from './safe-fetch.js';

describe('createSafeFetch', () => {
    const safeFetch = createSafeFetch();

    it('refuses a non-https URL before resolving anything', async () => {
        await expect(safeFetch('http://example.com/thing')).rejects.toBeInstanceOf(BlockedAddressError);
    });

    // The attack this exists for: a caller-supplied URL pointing back inside the deployment.
    it.each([
        'https://127.0.0.1/thing',
        'https://10.0.0.1/thing',
        'https://192.168.1.1/thing',
        'https://169.254.169.254/latest/meta-data/',
        'https://[::1]/thing',
        'https://[::ffff:169.254.169.254]/latest/meta-data/',
    ])('refuses %s', async (url) => {
        await expect(safeFetch(url)).rejects.toBeInstanceOf(BlockedAddressError);
    });
});
