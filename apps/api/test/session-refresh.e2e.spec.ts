import { randomUUID } from 'node:crypto';
import { SESSION_EXPIRES_IN_SECONDS, SESSION_UPDATE_AGE_SECONDS } from '@app/auth';
import { schema } from '@app/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

const { session, user } = schema;

const SESSION_COOKIE_NAME = 'better-auth.session_token';

/**
 * Proves the rolling session refresh survives the whole request path, not just Better Auth's own.
 *
 * `SessionAuthGuard` resolves every authenticated request through `getSession`, which slides a
 * session forward once it is older than `updateAge` by extending `expires_at` AND reissuing the
 * cookie with a fresh `Max-Age`. The database half happens inside Better Auth either way; the
 * cookie half only reaches the browser if the guard forwards the header it gets back. When it does
 * not, sessions look healthy in the database while every visitor is signed out `expiresIn` after
 * signing in, however active they were.
 */
describe('session refresh', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it('reissues the session cookie once the session is older than updateAge', async () => {
        const { cookie, userId } = await signUpAndSignIn(app);

        const before = await readSessionExpiry(app, userId);
        await ageSessionPastUpdateAge(app, userId);

        const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

        expect(response.statusCode).toBe(200);

        const setCookie = response.headers['set-cookie'];
        expect(setCookie).toBeDefined();

        const reissued = [setCookie].flat().find((value) => String(value).includes(SESSION_COOKIE_NAME));
        expect(reissued).toBeDefined();

        // The point of the reissue is the renewed lifetime, so assert the attribute that carries
        // it rather than merely that some cookie came back.
        expect(String(reissued)).toContain(`Max-Age=${SESSION_EXPIRES_IN_SECONDS}`);

        // The row must slide forward too: a cookie renewed past an unchanged `expires_at` would
        // still be rejected on the next request.
        const after = await readSessionExpiry(app, userId);
        expect(after.getTime()).toBeGreaterThan(before.getTime() - SESSION_UPDATE_AGE_SECONDS * 1000);
    });

    it('does not reissue the cookie while the session is younger than updateAge', async () => {
        const { cookie } = await signUpAndSignIn(app);

        const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

        expect(response.statusCode).toBe(200);

        const setCookie = response.headers['set-cookie'];
        const reissued = [setCookie].flat().filter((value) => String(value).includes(SESSION_COOKIE_NAME));
        expect(reissued).toHaveLength(0);
    });

    it('keeps serving the request on the refreshed cookie', async () => {
        const { cookie, userId } = await signUpAndSignIn(app);
        await ageSessionPastUpdateAge(app, userId);

        const refreshResponse = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
        const reissued = [refreshResponse.headers['set-cookie']]
            .flat()
            .find((value) => String(value).includes(SESSION_COOKIE_NAME));

        const replayCookie = String(reissued).split(';')[0];
        const replay = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: replayCookie } });

        expect(replay.statusCode).toBe(200);
        expect((JSON.parse(replay.body) as { userId: string }).userId).toBe(userId);
    });
});

/** Signs a brand-new user up and in, returning their id and the session cookie header. */
async function signUpAndSignIn(app: TestApp): Promise<{ cookie: string; userId: string }> {
    const email = `${randomUUID()}@example.com`;
    const password = 'password123';

    const signupResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: { email, password, displayName: 'Session Refresh User' },
    });
    expect(signupResponse.statusCode).toBe(200);

    const cookie = await signIn(app, { email, password });
    const [row] = await app.db.select({ id: user.id }).from(user).where(eq(user.email, email));

    return { cookie, userId: String(row?.id) };
}

/**
 * Backdates the session so the next request crosses Better Auth's refresh threshold, which fires
 * when `expiresAt - expiresIn + updateAge <= now`. Shifting `expires_at` back by one minute more
 * than `updateAge` is the smallest change that satisfies it, and stays valid rather than expired.
 */
async function ageSessionPastUpdateAge(app: TestApp, userId: string): Promise<void> {
    const current = await readSessionExpiry(app, userId);
    const aged = new Date(current.getTime() - (SESSION_UPDATE_AGE_SECONDS + 60) * 1000);

    await app.db.update(session).set({ expiresAt: aged }).where(eq(session.userId, userId));
}

/** Reads the one session row belonging to a freshly signed-in user. */
async function readSessionExpiry(app: TestApp, userId: string): Promise<Date> {
    const [row] = await app.db.select({ expiresAt: session.expiresAt }).from(session).where(eq(session.userId, userId));

    if (!row) throw new Error('readSessionExpiry: no session row for user');

    return row.expiresAt;
}
