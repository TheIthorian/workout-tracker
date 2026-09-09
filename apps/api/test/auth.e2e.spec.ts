import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema } from '@app/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

const { user, workspaceUsers } = schema;

// LockoutService's MAX_FAILED_ATTEMPTS - read from packages/auth/src/lockout.service.ts rather
// than assumed, per the task brief.
const LOCKOUT_THRESHOLD = 5;

describe('POST /api/v1/auth/{login,logout,signup}', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it('signs up, then signs in and receives a session cookie', async () => {
        const email = `${randomUUID()}@example.com`;

        const signupResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password: 'password123', displayName: 'Signup User' },
        });

        expect(signupResponse.statusCode).toBe(200);

        const loginResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login?useSessionCookies=true',
            payload: { email, password: 'password123' },
        });

        expect(loginResponse.statusCode).toBe(200);

        // Assert the cookie Better Auth actually issued, not merely that some cookie exists. The
        // controller's whole job on this route is header fidelity: it must copy `set-cookie` across
        // verbatim, attributes included, rather than reconstructing it. A `toContain('=')` check
        // passes against a cookie with the wrong name, no HttpOnly and no Path.
        const setCookie = String(loginResponse.headers['set-cookie']);
        expect(setCookie).toContain('better-auth.session_token=');
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie).toContain('Path=/');
        expect(setCookie).toContain('SameSite=Lax');
    });

    it('rejects a duplicate email with a 400 problem body', async () => {
        const email = `${randomUUID()}@example.com`;

        const first = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password: 'password123' },
        });
        expect(first.statusCode).toBe(200);

        const second = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password: 'password123' },
        });

        expect(second.statusCode).toBe(400);
        const body = JSON.parse(second.body) as { title: string; errors: Record<string, string[]> };
        expect(body.errors.email).toContain('Email is already in use.');
    });

    it('rejects a password shorter than 8 characters before it reaches Better Auth', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email: `${randomUUID()}@example.com`, password: 'short1' },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as { title: string };
        expect(body.title).toBe('Request validation failed');
    });

    it('returns 401 with title "Unauthorized" for a wrong password', async () => {
        const email = `${randomUUID()}@example.com`;
        await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password: 'password123' },
        });

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email, password: 'wrong-password' },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body) as { title: string };
        expect(body.title).toBe('Unauthorized');
    });

    it('returns 429 TooManyRequestsError after the lockout threshold', async () => {
        const email = `${randomUUID()}@example.com`;
        await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password: 'password123' },
        });

        let lastResponse;
        for (let attempt = 0; attempt < LOCKOUT_THRESHOLD; attempt += 1) {
            lastResponse = await app.inject({
                method: 'POST',
                url: '/api/v1/auth/login',
                payload: { email, password: 'wrong-password' },
            });
        }

        // The threshold-th failure itself is still a 401 (it locks the account for the NEXT attempt).
        expect(lastResponse?.statusCode).toBe(401);

        const lockedResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email, password: 'password123' },
        });

        expect(lockedResponse.statusCode).toBe(429);
        const body = JSON.parse(lockedResponse.body) as { title: string; type: string };
        expect(body.type).toContain('TooManyRequestsError');
    });

    it('clears the session cookie on logout', async () => {
        const email = `${randomUUID()}@example.com`;
        await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password: 'password123' },
        });

        const loginResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email, password: 'password123' },
        });
        const cookie = String(loginResponse.headers['set-cookie']);

        const logoutResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/logout',
            headers: { cookie },
        });

        expect(logoutResponse.statusCode).toBe(200);
        const clearedCookie = String(logoutResponse.headers['set-cookie']);
        expect(clearedCookie).toBeDefined();
        // A cleared cookie carries Max-Age=0 or an epoch Expires - not a re-issued session value.
        expect(clearedCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    });

    it('signup creates the user and their default workspace as one unit', async () => {
        const email = `${randomUUID()}@example.com`;

        await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email, password: 'password123' },
        });

        const [createdUser] = await app.db.select().from(user).where(eq(user.email, email));
        expect(createdUser).toBeDefined();

        const memberships = await app.db.select().from(workspaceUsers).where(eq(workspaceUsers.userId, createdUser.id));
        expect(memberships).toEqual([expect.objectContaining({ role: 'owner' })]);
    });

    // Proves SessionAuthGuard works through a real HTTP round trip, against the test-only guarded
    // route `GET /api/health/whoami` that HealthController exposes for exactly this purpose.
    describe('SessionAuthGuard on a real guarded route (GET /api/health/whoami)', () => {
        it('returns 401 with no cookie at all', async () => {
            const response = await app.inject({ method: 'GET', url: '/api/health/whoami' });

            expect(response.statusCode).toBe(401);
            const body = JSON.parse(response.body) as { title: string };
            expect(body.title).toBe('Unauthorized');
        });

        it('returns 401 for a garbage, malformed cookie', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/health/whoami',
                headers: { cookie: 'better-auth.session_token=not-a-real-session-value' },
            });

            expect(response.statusCode).toBe(401);
            const body = JSON.parse(response.body) as { title: string };
            expect(body.title).toBe('Unauthorized');
        });

        it('returns 200 with the current user for a valid session', async () => {
            const email = `${randomUUID()}@example.com`;
            await app.inject({
                method: 'POST',
                url: '/api/v1/auth/signup',
                payload: { email, password: 'password123' },
            });
            const cookie = await signIn(app, { email, password: 'password123' });

            const response = await app.inject({ method: 'GET', url: '/api/health/whoami', headers: { cookie } });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body) as { email: string };
            expect(body.email).toBe(email);
        });
    });
});
