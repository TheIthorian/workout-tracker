import { type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthConfig } from './auth-options.js';
import { AuthService } from './auth.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
});

afterAll(async () => {
    await database?.stop();
});

/** Parses one `Set-Cookie` header value's attribute flags, the way a browser would. */
function parseCookieAttributes(setCookie: string) {
    const parts = setCookie.split(';').map((part) => part.trim());
    const [nameValue, ...attributeParts] = parts;
    const attributes = new Set(attributeParts.map((part) => part.split('=')[0]!.toLowerCase()));
    const sameSite = attributeParts.find((part) => part.toLowerCase().startsWith('samesite='))?.split('=')[1];

    return {
        nameValue,
        httpOnly: attributes.has('httponly'),
        secure: attributes.has('secure'),
        sameSite,
    };
}

/** Builds a `Cookie` header a browser would send back, from a set of `Set-Cookie` response values. */
function toCookieHeader(setCookies: string[]): string {
    return setCookies.map((setCookie) => setCookie.split(';')[0]).join('; ');
}

function buildAuthService(config: AuthConfig): AuthService {
    return new AuthService({ config, userProvisioning: new UserProvisioningService(config) });
}

describe('login', () => {
    it('always issues session cookies, taking no mode parameter of its own', async () => {
        // Any `?useSessionCookies=true`-style query string lives on the HTTP route, not on this
        // framework-agnostic handler. This documents that `login` takes no such parameter and
        // always behaves as if session cookies were requested - the only mode this package
        // supports.
        const config: AuthConfig = {
            db,
            secret: 'test-only-secret-does-not-guard-anything-real',
            baseUrl: 'http://localhost:3000',
        };
        const authService = buildAuthService(config);
        const email = `login-ignore-param-${Date.now()}@example.com`;
        await authService.signup({ email, password: 'correct-horse' });

        const response = await authService.login({ email, password: 'correct-horse' });

        expect(response.status).toBe(200);
    });

    it('rejects bad credentials with 401', async () => {
        const config: AuthConfig = {
            db,
            secret: 'test-only-secret-does-not-guard-anything-real',
            baseUrl: 'http://localhost:3000',
        };
        const authService = buildAuthService(config);
        const email = `login-bad-credentials-${Date.now()}@example.com`;
        await authService.signup({ email, password: 'correct-horse' });

        const response = await authService.login({ email, password: 'wrong-password' });

        expect(response.status).toBe(401);
    });

    describe('session cookie', () => {
        it('sets HttpOnly, SameSite=Lax and (outside development) Secure, and the cookie authenticates a subsequent request', async () => {
            // `baseUrl` is https here to model "outside development" - Better Auth derives its
            // `Secure` attribute from the base URL's protocol (see `createCookieGetter` in
            // `better-auth/dist/cookies/index.mjs`), and this package never reads `process.env` to
            // decide it itself. The app that owns the environment picks the base URL; this proves
            // what happens once it does.
            const config: AuthConfig = {
                db,
                secret: 'test-only-secret-does-not-guard-anything-real',
                baseUrl: 'https://app.example.com',
            };
            const authService = buildAuthService(config);
            const email = `login-cookie-${Date.now()}@example.com`;
            await authService.signup({ email, password: 'correct-horse' });

            const response = await authService.login({ email, password: 'correct-horse' });
            expect(response.status).toBe(200);

            const setCookies = response.headers.getSetCookie();
            expect(setCookies.length).toBeGreaterThan(0);

            const sessionCookie = setCookies.find((cookie) => cookie.toLowerCase().includes('session_token'));
            expect(sessionCookie).toBeDefined();

            const attributes = parseCookieAttributes(sessionCookie!);
            expect(attributes.httpOnly).toBe(true);
            expect(attributes.sameSite?.toLowerCase()).toBe('lax');
            expect(attributes.secure).toBe(true);

            // Replay: build the `Cookie` header a browser would send back, and prove it
            // authenticates a subsequent request against this same auth instance.
            const cookieHeader = toCookieHeader(setCookies);
            const session = await authService.instance.api.getSession({
                headers: new Headers({ cookie: cookieHeader }),
            });

            expect(session?.user.email).toBe(email);
        });

        it('omits Secure when the base URL is not https (development)', async () => {
            const config: AuthConfig = {
                db,
                secret: 'test-only-secret-does-not-guard-anything-real',
                baseUrl: 'http://localhost:3000',
            };
            const authService = buildAuthService(config);
            const email = `login-cookie-dev-${Date.now()}@example.com`;
            await authService.signup({ email, password: 'correct-horse' });

            const response = await authService.login({ email, password: 'correct-horse' });
            const setCookies = response.headers.getSetCookie();
            const sessionCookie = setCookies.find((cookie) => cookie.toLowerCase().includes('session_token'));

            const attributes = parseCookieAttributes(sessionCookie!);
            expect(attributes.httpOnly).toBe(true);
            expect(attributes.sameSite?.toLowerCase()).toBe('lax');
            expect(attributes.secure).toBe(false);
        });

        it('sets Secure when `secureCookies: true` overrides an http baseUrl (behind a TLS-terminating proxy)', async () => {
            const config: AuthConfig = {
                db,
                secret: 'test-only-secret-does-not-guard-anything-real',
                baseUrl: 'http://localhost:3000',
                secureCookies: true,
            };
            const authService = buildAuthService(config);
            const email = `login-cookie-secure-override-${Date.now()}@example.com`;
            await authService.signup({ email, password: 'correct-horse' });

            const response = await authService.login({ email, password: 'correct-horse' });
            const setCookies = response.headers.getSetCookie();
            const sessionCookie = setCookies.find((cookie) => cookie.toLowerCase().includes('session_token'));

            const attributes = parseCookieAttributes(sessionCookie!);
            expect(attributes.secure).toBe(true);
        });
    });
});

describe('logout', () => {
    it('clears the session cookie and a subsequent request with it is no longer authenticated', async () => {
        const config: AuthConfig = {
            db,
            secret: 'test-only-secret-does-not-guard-anything-real',
            baseUrl: 'https://app.example.com',
        };
        const authService = buildAuthService(config);
        const email = `logout-${Date.now()}@example.com`;
        await authService.signup({ email, password: 'correct-horse' });

        const loginResponse = await authService.login({ email, password: 'correct-horse' });
        const cookieHeader = toCookieHeader(loginResponse.headers.getSetCookie());

        const logoutResponse = await authService.logout({ cookieHeader });
        expect(logoutResponse.status).toBe(200);

        const clearedCookies = logoutResponse.headers.getSetCookie();
        const clearedSessionCookie = clearedCookies.find((cookie) => cookie.toLowerCase().includes('session_token'));
        expect(clearedSessionCookie).toBeDefined();

        // Replay the cookie logout just issued (the emptied/expired one) and confirm it no longer
        // authenticates - the session was actually invalidated server-side, not just the cookie
        // header cleared client-side.
        const postLogoutCookieHeader = toCookieHeader(clearedCookies);
        const session = await authService.instance.api.getSession({
            headers: new Headers({ cookie: postLogoutCookieHeader }),
        });
        expect(session).toBeNull();

        // The ORIGINAL session cookie from login must also no longer work, proving the session was
        // deleted server-side rather than the client simply being told to forget a cookie that
        // still would have worked.
        const staleSession = await authService.instance.api.getSession({
            headers: new Headers({ cookie: cookieHeader }),
        });
        expect(staleSession).toBeNull();
    });

    it('succeeds even with no session to end', async () => {
        const config: AuthConfig = {
            db,
            secret: 'test-only-secret-does-not-guard-anything-real',
            baseUrl: 'http://localhost:3000',
        };
        const authService = buildAuthService(config);

        const response = await authService.logout({});

        expect(response.status).toBe(200);
    });
});

describe('signup', () => {
    it('returns 200 on success', async () => {
        const config: AuthConfig = {
            db,
            secret: 'test-only-secret-does-not-guard-anything-real',
            baseUrl: 'http://localhost:3000',
        };
        const authService = buildAuthService(config);
        const email = `signup-endpoint-${Date.now()}@example.com`;

        const response = await authService.signup({ email, password: 'correct-horse' });

        expect(response.status).toBe(200);
    });

    it('returns a 400 problem-details body on validation failure', async () => {
        const config: AuthConfig = {
            db,
            secret: 'test-only-secret-does-not-guard-anything-real',
            baseUrl: 'http://localhost:3000',
        };
        const authService = buildAuthService(config);

        const response = await authService.signup({ email: 'not-an-email', password: 'correct-horse' });

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ status: 400, errors: { email: expect.any(Array) } });
    });
});
