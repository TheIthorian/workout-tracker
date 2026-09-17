import { describe, expect, it } from 'vitest';
import { buildAuthOptions, SESSION_EXPIRES_IN_SECONDS, SESSION_UPDATE_AGE_SECONDS } from './auth-options.js';

const config = {
    secret: 'test-only-secret-does-not-guard-anything-real',
    baseUrl: 'https://api.example.com',
};

describe('buildAuthOptions', () => {
    // Better Auth falls back to a 7-day window when `session` is absent, which is both shorter than
    // this app wants and invisible in the repository - pinning it here makes a silent change to the
    // library default a failing test rather than a support ticket.
    it('sets the session window explicitly rather than inheriting Better Auth defaults', () => {
        const options = buildAuthOptions(config);

        expect(options.session?.expiresIn).toBe(SESSION_EXPIRES_IN_SECONDS);
        expect(options.session?.updateAge).toBe(SESSION_UPDATE_AGE_SECONDS);
    });

    it('refreshes a session well before it expires', () => {
        expect(SESSION_UPDATE_AGE_SECONDS).toBeLessThan(SESSION_EXPIRES_IN_SECONDS);
    });
});
