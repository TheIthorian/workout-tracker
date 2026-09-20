import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seedMcpToken, seedUser, seedWorkspace, signIn, type TestApp } from './harness.js';

describe('MCP token auth on REST routes', () => {
    let app: TestApp;
    let token: string;
    let workspaceId: string;
    let otherWorkspaceId: string;
    /** A real Better Auth session cookie, for asserting that token-only routes refuse it too. */
    let sessionCookie: string;

    beforeAll(async () => {
        app = await createTestApp();
        const user = await seedUser(app.db, { email: 'bearer@example.com', displayName: 'Bearer' });
        ({ id: workspaceId } = await seedWorkspace(app.db, { name: 'Scoped', ownerId: user.id }));
        ({ id: otherWorkspaceId } = await seedWorkspace(app.db, { name: 'Other', ownerId: user.id }));
        token = await seedMcpToken(app.db, { userId: user.id, workspaceId });

        // seedUser leaves the account with no sign-in credential (see its doc), so a real cookie
        // needs its own signed-up user, the same way test/me.e2e.spec.ts does it.
        const sessionEmail = 'bearer-session@example.com';
        const sessionPassword = 'password123';
        const signupResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: { email: sessionEmail, password: sessionPassword, displayName: 'Bearer Session' },
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

    // A leaked token must not be able to see, let alone revoke, the user's other connections.
    it('refuses to read the connected-apps list', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/me/connected-apps',
            headers: { authorization: `Bearer ${token}` },
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

    // Workspace management is unavailable in the current product, so none of its routes are
    // registered even for the workspace owner using a browser session.
    it('does not expose workspace management routes', async () => {
        const routes = [
            { method: 'POST', url: '/api/v1/workspaces' },
            { method: 'PATCH', url: `/api/v1/workspaces/${workspaceId}` },
            { method: 'DELETE', url: `/api/v1/workspaces/${workspaceId}` },
            { method: 'GET', url: `/api/v1/workspaces/${workspaceId}/members` },
            { method: 'POST', url: `/api/v1/workspaces/${workspaceId}/members` },
            { method: 'PATCH', url: `/api/v1/workspaces/${workspaceId}/members/${workspaceId}` },
            { method: 'DELETE', url: `/api/v1/workspaces/${workspaceId}/members/${workspaceId}` },
        ] as const;

        for (const route of routes) {
            const response = await app.inject({ ...route, headers: { cookie: sessionCookie } });

            expect(response.statusCode).toBe(404);
        }
    });

    // Critical finding from review: DELETE /v1/me was unpinned and token-reachable, and
    // `UsersService.deleteUser` only refuses when the caller owns a workspace - a member-only
    // user's account would be deleted outright by a leaked token. No MCP tool calls this route.
    it('refuses an access token calling DELETE /v1/me', async () => {
        const response = await app.inject({
            method: 'DELETE',
            url: '/api/v1/me',
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(401);
    });
});
