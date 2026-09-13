import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seedMcpToken, seedUser, seedWorkspace, signIn, type TestApp } from './harness.js';

describe('MCP token auth on REST routes', () => {
    let app: TestApp;
    let token: string;
    let workspaceId: string;
    let otherWorkspaceId: string;
    /** A real Better Auth session cookie, for asserting that PAT-only routes refuse it too. */
    let sessionCookie: string;

    beforeAll(async () => {
        app = await createTestApp();
        const user = await seedUser(app.db, { email: 'pat@example.com', displayName: 'Pat' });
        ({ id: workspaceId } = await seedWorkspace(app.db, { name: 'Scoped', ownerId: user.id }));
        ({ id: otherWorkspaceId } = await seedWorkspace(app.db, { name: 'Other', ownerId: user.id }));
        token = await seedMcpToken(app.db, { userId: user.id, workspaceId });

        // seedUser leaves the account with no sign-in credential (see its doc), so a real cookie
        // needs its own signed-up user, the same way test/me.e2e.spec.ts does it.
        const sessionEmail = 'pat-session@example.com';
        const sessionPassword = 'password123';
        const signupResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email: sessionEmail, password: sessionPassword, displayName: 'Pat Session' },
        });
        if (signupResponse.statusCode !== 200) {
            throw new Error(`signup: expected 200, got ${signupResponse.statusCode}`);
        }
        sessionCookie = await signIn(app, { email: sessionEmail, password: sessionPassword });
    });

    afterAll(async () => {
        await app?.close();
    });

    it('serves the token workspace', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
    });

    // The escalation this guard exists to prevent: same owner, different workspace.
    it('refuses another workspace the same user owns, with 404', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${otherWorkspaceId}/exercises`,
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(404);
    });

    it('refuses to mint further tokens', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/me/mcp-access-tokens',
            headers: { authorization: `Bearer ${token}` },
            payload: { workspaceId },
        });

        expect(response.statusCode).toBe(401);
    });

    it('still rejects a garbage token', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { authorization: 'Bearer not-a-token' },
        });

        expect(response.statusCode).toBe(401);
    });

    it('resolves the token to its user and workspace', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/me/mcp-session',
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ userId: expect.any(String), workspaceId });
    });

    // A real session cookie, not merely an absent one - mcp-session must refuse a caller who is
    // genuinely signed in but has no token, because answering would mean inventing a workspace.
    it('refuses a session cookie on the mcp-session route', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/me/mcp-session',
            headers: { cookie: sessionCookie },
        });

        expect(response.statusCode).toBe(401);
    });

    // Critical finding from review: these routes are inside the token's workspace pin, so without
    // an explicit guard a leaked PAT could add an attacker's own email as a member and then
    // promote them - persistent session-grade access from a single leaked token. No MCP tool calls
    // this route, so it must be unreachable by a token at all (401, not 404 - no credential this
    // route accepts was presented).
    it('refuses a PAT calling POST /:workspaceId/members', async () => {
        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/members`,
            headers: { authorization: `Bearer ${token}` },
            payload: { email: 'attacker@example.com' },
        });

        expect(response.statusCode).toBe(401);
    });

    // Critical finding from review: DELETE /v1/me was unpinned and PAT-reachable, and
    // `UsersService.deleteUser` only refuses when the caller owns a workspace - a member-only
    // user's account would be deleted outright by a leaked token. No MCP tool calls this route.
    it('refuses a PAT calling DELETE /v1/me', async () => {
        const response = await app.inject({
            method: 'DELETE',
            url: '/api/v1/me',
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(401);
    });
});
