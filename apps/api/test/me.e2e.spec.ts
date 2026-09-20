import { randomUUID } from 'node:crypto';
import { schema } from '@app/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, TEST_MCP_BASE_URL, TEST_OAUTH_CLIENT_ID, type TestApp } from './harness.js';

const { oauthAccessTokens, oauthGrants, workspaceUsers } = schema;

/** Signs a brand-new user up (which also creates their own owned default workspace) and signs them in. */
async function signUpAndSignIn(
    app: TestApp,
    { displayName }: { displayName: string },
): Promise<{ userId: string; email: string; cookie: string }> {
    const email = `${randomUUID()}@example.com`;
    const password = 'password123';

    const signupResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: { email, password, displayName },
    });
    expect(signupResponse.statusCode).toBe(200);

    const cookie = await signIn(app, { email, password });

    const meResponse = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const userId = (JSON.parse(meResponse.body) as { userId: string }).userId;

    return { userId, email, cookie };
}

/** Removes every WorkspaceUsers row for a user, so they own no workspace - the precondition DELETE /me requires. */
async function clearOwnership(app: TestApp, userId: string): Promise<void> {
    await app.db.delete(workspaceUsers).where(eq(workspaceUsers.userId, userId));
}

describe('/api/v1/me', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    describe('GET /api/v1/me', () => {
        it('returns 401 when signed out', async () => {
            const response = await app.inject({ method: 'GET', url: '/api/v1/me' });

            expect(response.statusCode).toBe(401);
        });

        it('returns the user with every workspace they belong to', async () => {
            const { cookie, email } = await signUpAndSignIn(app, { displayName: 'Alice' });

            const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body) as {
                displayName: string;
                email: string;
                workspaces: { role: string }[];
            };
            expect(body.displayName).toBe('Alice');
            expect(body.email).toBe(email);
            expect(body.workspaces).toHaveLength(1);
            expect(body.workspaces[0]?.role).toBe('owner');
        });

        // Cross-tenant regression: a dropped userId filter on the workspace join would leak
        // another user's workspace memberships into this response.
        it('does not include another user workspace', async () => {
            const userA = await signUpAndSignIn(app, { displayName: 'User A' });
            const userB = await signUpAndSignIn(app, { displayName: 'User B' });

            const responseA = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: userA.cookie } });
            const bodyA = JSON.parse(responseA.body) as { workspaces: { workspaceId: string }[] };

            const responseB = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: userB.cookie } });
            const bodyB = JSON.parse(responseB.body) as { workspaces: { workspaceId: string }[] };

            const workspaceIdsA = new Set(bodyA.workspaces.map((workspace) => workspace.workspaceId));
            const workspaceIdsB = new Set(bodyB.workspaces.map((workspace) => workspace.workspaceId));
            expect([...workspaceIdsA].some((id) => workspaceIdsB.has(id))).toBe(false);
        });
    });

    describe('PATCH /api/v1/me', () => {
        it('returns 401 when signed out', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/api/v1/me',
                payload: { displayName: 'New Name' },
            });

            expect(response.statusCode).toBe(401);
        });

        it('sets the display name and returns the updated user', async () => {
            const { cookie } = await signUpAndSignIn(app, { displayName: 'Old Name' });

            const response = await app.inject({
                method: 'PATCH',
                url: '/api/v1/me',
                headers: { cookie },
                payload: { displayName: 'New Name' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body) as { displayName: string };
            expect(body.displayName).toBe('New Name');

            const meResponse = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
            expect((JSON.parse(meResponse.body) as { displayName: string }).displayName).toBe('New Name');
        });
    });

    describe('DELETE /api/v1/me', () => {
        it('returns 401 when signed out', async () => {
            const response = await app.inject({ method: 'DELETE', url: '/api/v1/me' });

            expect(response.statusCode).toBe(401);
        });

        it('deletes the account and its personal workspace', async () => {
            const { cookie } = await signUpAndSignIn(app, { displayName: 'Owner' });

            const response = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: { cookie } });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toEqual({ message: 'Account deleted successfully' });
        });

        it('deletes the account, signs out, and returns the success message when the user owns no workspace', async () => {
            const { userId, cookie } = await signUpAndSignIn(app, { displayName: 'Member' });
            await clearOwnership(app, userId);

            const response = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: { cookie } });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toEqual({ message: 'Account deleted successfully' });

            const followUp = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
            expect(followUp.statusCode).toBe(401);
        });
    });
});

describe('/api/v1/me/mcp-connection', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it('returns 401 when signed out', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/v1/me/mcp-connection' });

        expect(response.statusCode).toBe(401);
    });

    // The url has to name `apps/mcp`, not this API: it is the one thing a user copies, and this
    // process serves no `/mcp` route to fall back on.
    it('returns the MCP origin, not this API origin, and carries no credential', async () => {
        const { cookie } = await signUpAndSignIn(app, { displayName: 'Ada' });

        const response = await app.inject({ method: 'GET', url: '/api/v1/me/mcp-connection', headers: { cookie } });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ mcpUrl: `${TEST_MCP_BASE_URL}/mcp` });
    });
});

describe('/api/v1/me/connected-apps', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    async function seedGrantFor({ userId }: { userId: string }): Promise<{ grantId: string; workspaceId: string }> {
        const [membership] = await app.db
            .select({ workspaceId: workspaceUsers.workspaceId })
            .from(workspaceUsers)
            .where(eq(workspaceUsers.userId, userId));

        const [grant] = await app.db
            .insert(oauthGrants)
            .values({
                userId,
                clientId: TEST_OAUTH_CLIENT_ID,
                workspaceId: membership.workspaceId,
                scopes: ['mcp'],
            })
            .returning({ id: oauthGrants.id });

        await app.db.insert(oauthAccessTokens).values({
            tokenHash: Buffer.from(randomUUID().replace(/-/g, ''), 'hex'),
            grantId: grant.id,
            clientId: TEST_OAUTH_CLIENT_ID,
            userId,
            workspaceId: membership.workspaceId,
            scopes: ['mcp'],
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });

        return { grantId: grant.id, workspaceId: membership.workspaceId };
    }

    it('returns 401 when signed out', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/v1/me/connected-apps' });

        expect(response.statusCode).toBe(401);
    });

    it("lists the caller's own connections and nobody else's", async () => {
        const mine = await signUpAndSignIn(app, { displayName: 'Mine' });
        const theirs = await signUpAndSignIn(app, { displayName: 'Theirs' });
        await seedGrantFor({ userId: mine.userId });
        await seedGrantFor({ userId: theirs.userId });

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/me/connected-apps',
            headers: { cookie: mine.cookie },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as { clientId: string; verified: boolean }[];
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ clientId: TEST_OAUTH_CLIENT_ID, verified: true });
    });

    it('disconnecting revokes the grant and every token issued under it', async () => {
        const { userId, cookie } = await signUpAndSignIn(app, { displayName: 'Ada' });
        const { grantId } = await seedGrantFor({ userId });

        const response = await app.inject({
            method: 'DELETE',
            url: `/api/v1/me/connected-apps?clientId=${encodeURIComponent(TEST_OAUTH_CLIENT_ID)}`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(204);

        const [grant] = await app.db.select().from(oauthGrants).where(eq(oauthGrants.id, grantId));
        const [token] = await app.db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.grantId, grantId));

        expect(grant.revokedAt).not.toBeNull();
        expect(token.revokedAt).not.toBeNull();
    });

    // Another user's client id must be indistinguishable from one nobody has connected.
    it('returns 404 for a client the caller has not connected', async () => {
        const { cookie } = await signUpAndSignIn(app, { displayName: 'Ada' });

        const response = await app.inject({
            method: 'DELETE',
            url: `/api/v1/me/connected-apps?clientId=${encodeURIComponent('https://other.test/oauth-client')}`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(404);
    });
});
