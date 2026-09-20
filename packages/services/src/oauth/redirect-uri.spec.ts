import { describe, expect, it } from 'vitest';
import { isRedirectUriPermitted } from './redirect-uri.js';

describe('isRedirectUriPermitted', () => {
    it('accepts an exact match', () => {
        expect(
            isRedirectUriPermitted({
                registered: ['https://client.example/callback'],
                requested: 'https://client.example/callback',
            }),
        ).toBe(true);
    });

    it('refuses a different path on a registered host', () => {
        expect(
            isRedirectUriPermitted({
                registered: ['https://client.example/callback'],
                requested: 'https://client.example/callback/../evil',
            }),
        ).toBe(false);
    });

    it('refuses an unregistered host', () => {
        expect(
            isRedirectUriPermitted({
                registered: ['https://client.example/callback'],
                requested: 'https://evil.example/callback',
            }),
        ).toBe(false);
    });

    // RFC 8252 §7.3: a native client cannot know its loopback port in advance.
    it('accepts a loopback URI on any port when the registered one is loopback', () => {
        expect(
            isRedirectUriPermitted({
                registered: ['http://127.0.0.1:1234/callback'],
                requested: 'http://127.0.0.1:59321/callback',
            }),
        ).toBe(true);
    });

    it('does not extend the port exception to a different loopback path or scheme', () => {
        expect(
            isRedirectUriPermitted({
                registered: ['http://127.0.0.1:1234/callback'],
                requested: 'http://127.0.0.1:59321/other',
            }),
        ).toBe(false);
        expect(
            isRedirectUriPermitted({
                registered: ['http://127.0.0.1:1234/callback'],
                requested: 'https://127.0.0.1:59321/callback',
            }),
        ).toBe(false);
    });

    // RFC 8252 §8.3: `localhost` resolves through whatever the host's name resolution says.
    it('does not extend the port exception to localhost', () => {
        expect(
            isRedirectUriPermitted({
                registered: ['http://localhost:1234/callback'],
                requested: 'http://localhost:59321/callback',
            }),
        ).toBe(false);
    });

    it('refuses a requested value that is not a URL', () => {
        expect(isRedirectUriPermitted({ registered: ['https://client.example/cb'], requested: 'nonsense' })).toBe(
            false,
        );
    });
});
