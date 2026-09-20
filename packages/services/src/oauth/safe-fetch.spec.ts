import { describe, expect, it } from 'vitest';
import { BlockedAddressError, createSafeFetch } from './safe-fetch.js';

describe('createSafeFetch', () => {
    const safeFetch = createSafeFetch();

    it('refuses a non-https URL before resolving anything', async () => {
        await expect(safeFetch('http://example.com/oauth-client')).rejects.toBeInstanceOf(BlockedAddressError);
    });

    // The attack this exists for: a `client_id` that points back inside the deployment.
    it.each([
        'https://127.0.0.1/oauth-client',
        'https://10.0.0.1/oauth-client',
        'https://169.254.169.254/latest/meta-data/',
        'https://[::1]/oauth-client',
    ])('refuses %s', async (url) => {
        await expect(safeFetch(url)).rejects.toBeInstanceOf(BlockedAddressError);
    });

    // The development escape hatch must open the gate and nothing else - the request then fails
    // however a request to a closed port fails, not with this module's own error.
    it('lets a private address through when the caller opts in', async () => {
        const permissive = createSafeFetch({ allowPrivateHosts: true });

        await expect(
            permissive('https://127.0.0.1:9/oauth-client', { signal: AbortSignal.timeout(2_000) }),
        ).rejects.not.toBeInstanceOf(BlockedAddressError);
    });
});
