import { randomUUID } from 'node:crypto';
import { schema } from '@app/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, TEST_MCP_BASE_URL, type TestApp } from './harness.js';

const { mcpPersonalAccessTokens, workspaceUsers } = schema;

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

        it('returns 403 when the user owns a workspace', async () => {
            const { cookie } = await signUpAndSignIn(app, { displayName: 'Owner' });

            const response = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: { cookie } });

            expect(response.statusCode).toBe(403);
            const body = JSON.parse(response.body) as { title: string; detail: string };
            expect(body.title).toBe('Cannot delete account');
            expect(body.detail).toBe(
                'You cannot delete your account while you own one or more workspaces. Transfer ownership or delete them first.',
            );
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

describe('/api/v1/me/mcp-access-tokens', () => {
    let app: TestApp;

    beforeAll(async () => {
        app = await createTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    describe('POST /api/v1/me/mcp-access-tokens', () => {
        it('returns 401 when signed out', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/me/mcp-access-tokens',
                payload: { workspaceId: randomUUID() },
            });

            expect(response.statusCode).toBe(401);
        });

        it('returns 404 when the caller is not a member of the workspace', async () => {
            const userA = await signUpAndSignIn(app, { displayName: 'User A' });
            const userB = await signUpAndSignIn(app, { displayName: 'User B' });
            const meResponseB = await app.inject({
                method: 'GET',
                url: '/api/v1/me',
                headers: { cookie: userB.cookie },
            });
            const workspaceIdB = (JSON.parse(meResponseB.body) as { workspaces: { workspaceId: string }[] })
                .workspaces[0]?.workspaceId as string;

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie: userA.cookie },
                payload: { workspaceId: workspaceIdB },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.body) as { title: string };
            expect(body.title).toBe('Workspace not found');
        });

        it('creates a token, storing only its hash, and returns the plaintext exactly once', async () => {
            const { userId, cookie } = await signUpAndSignIn(app, { displayName: 'Alice' });
            const meResponse = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
            const workspaceId = (JSON.parse(meResponse.body) as { workspaces: { workspaceId: string }[] }).workspaces[0]
                ?.workspaceId as string;

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie },
                payload: { workspaceId, name: 'my token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body) as {
                id: string;
                workspaceId: string;
                token: string;
                mcpUrl: string;
            };
            expect(body.workspaceId).toBe(workspaceId);
            expect(body.token.length).toBeGreaterThan(32);
            expect(body.mcpUrl).toBe(`${TEST_MCP_BASE_URL}/mcp/${body.token}`);

            const [row] = await app.db
                .select()
                .from(mcpPersonalAccessTokens)
                .where(eq(mcpPersonalAccessTokens.id, body.id));
            expect(row).toBeDefined();
            expect(row?.userId).toBe(userId);
            expect(Buffer.isBuffer(row?.tokenHash)).toBe(true);
        });
    });

    describe('GET /api/v1/me/mcp-access-tokens', () => {
        it('returns 401 when signed out', async () => {
            const response = await app.inject({ method: 'GET', url: '/api/v1/me/mcp-access-tokens' });

            expect(response.statusCode).toBe(401);
        });

        it('lists every token for the caller, most recent first, including revoked ones, and never a token value', async () => {
            const { cookie } = await signUpAndSignIn(app, { displayName: 'Alice' });
            const meResponse = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
            const workspaceId = (JSON.parse(meResponse.body) as { workspaces: { workspaceId: string }[] }).workspaces[0]
                ?.workspaceId as string;

            const first = await app.inject({
                method: 'POST',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie },
                payload: { workspaceId, name: 'first' },
            });
            const firstId = (JSON.parse(first.body) as { id: string }).id;

            const second = await app.inject({
                method: 'POST',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie },
                payload: { workspaceId, name: 'second' },
            });
            const secondId = (JSON.parse(second.body) as { id: string }).id;

            const revokeResponse = await app.inject({
                method: 'DELETE',
                url: `/api/v1/me/mcp-access-tokens/${firstId}`,
                headers: { cookie },
            });
            expect(revokeResponse.statusCode).toBe(200);

            const listResponse = await app.inject({
                method: 'GET',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie },
            });

            expect(listResponse.statusCode).toBe(200);
            const list = JSON.parse(listResponse.body) as {
                id: string;
                revokedAt: string | null;
            }[];
            expect(list.map((item) => item.id)).toEqual([secondId, firstId]);
            expect(list.find((item) => item.id === firstId)?.revokedAt).not.toBeNull();
            expect(list.find((item) => item.id === secondId)?.revokedAt).toBeNull();
            for (const item of list) {
                expect(item).not.toHaveProperty('token');
                expect(item).not.toHaveProperty('tokenHash');
            }
        });

        // Cross-tenant regression: a dropped userId filter would return every user's tokens.
        it('does not return another user tokens', async () => {
            const userA = await signUpAndSignIn(app, { displayName: 'User A' });
            const userB = await signUpAndSignIn(app, { displayName: 'User B' });
            const meResponseB = await app.inject({
                method: 'GET',
                url: '/api/v1/me',
                headers: { cookie: userB.cookie },
            });
            const workspaceIdB = (JSON.parse(meResponseB.body) as { workspaces: { workspaceId: string }[] })
                .workspaces[0]?.workspaceId as string;

            await app.inject({
                method: 'POST',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie: userB.cookie },
                payload: { workspaceId: workspaceIdB },
            });

            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie: userA.cookie },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)).toEqual([]);
        });
    });

    describe('DELETE /api/v1/me/mcp-access-tokens/:tokenId', () => {
        it('returns 401 when signed out', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/me/mcp-access-tokens/${randomUUID()}`,
            });

            expect(response.statusCode).toBe(401);
        });

        it('returns 404 for a token that does not exist', async () => {
            const { cookie } = await signUpAndSignIn(app, { displayName: 'Alice' });

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/me/mcp-access-tokens/${randomUUID()}`,
                headers: { cookie },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.body) as { title: string };
            expect(body.title).toBe('Token not found');
        });

        // Cross-tenant regression: must 404 rather than revoke another user's token.
        it('returns 404 and does not revoke another user token', async () => {
            const userA = await signUpAndSignIn(app, { displayName: 'User A' });
            const userB = await signUpAndSignIn(app, { displayName: 'User B' });
            const meResponseB = await app.inject({
                method: 'GET',
                url: '/api/v1/me',
                headers: { cookie: userB.cookie },
            });
            const workspaceIdB = (JSON.parse(meResponseB.body) as { workspaces: { workspaceId: string }[] })
                .workspaces[0]?.workspaceId as string;

            const createResponse = await app.inject({
                method: 'POST',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie: userB.cookie },
                payload: { workspaceId: workspaceIdB },
            });
            const tokenId = (JSON.parse(createResponse.body) as { id: string }).id;

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/me/mcp-access-tokens/${tokenId}`,
                headers: { cookie: userA.cookie },
            });

            expect(response.statusCode).toBe(404);

            const [row] = await app.db
                .select()
                .from(mcpPersonalAccessTokens)
                .where(eq(mcpPersonalAccessTokens.id, tokenId));
            expect(row?.revokedAt).toBeNull();
        });

        it('revokes the caller own token and returns 200 with an empty body', async () => {
            const { cookie } = await signUpAndSignIn(app, { displayName: 'Alice' });
            const meResponse = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
            const workspaceId = (JSON.parse(meResponse.body) as { workspaces: { workspaceId: string }[] }).workspaces[0]
                ?.workspaceId as string;
            const createResponse = await app.inject({
                method: 'POST',
                url: '/api/v1/me/mcp-access-tokens',
                headers: { cookie },
                payload: { workspaceId },
            });
            const tokenId = (JSON.parse(createResponse.body) as { id: string }).id;

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/me/mcp-access-tokens/${tokenId}`,
                headers: { cookie },
            });

            expect(response.statusCode).toBe(200);
            expect(response.body).toBe('');

            const [row] = await app.db
                .select()
                .from(mcpPersonalAccessTokens)
                .where(eq(mcpPersonalAccessTokens.id, tokenId));
            expect(row?.revokedAt).not.toBeNull();
        });
    });
});
