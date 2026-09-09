import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    createTestApp,
    seedMcpToken,
    seedUser,
    seedWorkspace,
    signIn,
    TEST_WEB_APP_BASE_URL,
    type TestApp,
} from './harness.js';

let app: TestApp;

/** A signed-up user, their default workspace, and a session cookie for them. */
async function signUpUser(): Promise<{ cookie: string; workspaceId: string; userId: string }> {
    const email = `items-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';

    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });

    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { userId: string; workspaces: { workspaceId: string }[] };

    return { cookie, userId: body.userId, workspaceId: body.workspaces[0]?.workspaceId as string };
}

async function createItem(cookie: string, workspaceId: string, name: string): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/items`,
        headers: { cookie },
        payload: { name },
    });

    return (JSON.parse(response.body) as { id: string }).id;
}

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('items routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/v1/workspaces/${randomUUID()}/items` });

        expect(response.statusCode).toBe(401);
    });

    it('creates and reads back an item', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const created = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/items`,
            headers: { cookie },
            payload: { name: 'Widget', description: 'A widget' },
        });

        expect(created.statusCode).toBe(200);
        const item = JSON.parse(created.body) as { id: string; name: string; description: string };
        expect(item).toMatchObject({ name: 'Widget', description: 'A widget' });

        const fetched = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/items/${item.id}`,
            headers: { cookie },
        });

        expect(JSON.parse(fetched.body)).toMatchObject({
            id: item.id,
            webUrl: `${TEST_WEB_APP_BASE_URL}/workspaces/${workspaceId}/items/${item.id}`,
        });
    });

    it('rejects a body that fails validation with a 400 and a field-keyed errors dictionary', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/items`,
            headers: { cookie },
            payload: { name: '' },
        });

        expect(response.statusCode).toBe(400);
        expect((JSON.parse(response.body) as { errors: Record<string, string[]> }).errors).toHaveProperty('name');
    });

    it('returns 404 for a malformed item id rather than 400', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/items/not-a-guid`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(404);
    });

    it('returns the paginated envelope', async () => {
        const { cookie, workspaceId } = await signUpUser();
        await createItem(cookie, workspaceId, 'one');
        await createItem(cookie, workspaceId, 'two');

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/items?page=1&pageSize=1`,
            headers: { cookie },
        });

        expect(JSON.parse(response.body)).toMatchObject({ page: 1, pageSize: 1, totalCount: 2, totalPages: 2 });
    });

    it('updates and deletes an item', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const itemId = await createItem(cookie, workspaceId, 'Before');

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/items/${itemId}`,
            headers: { cookie },
            payload: { name: 'After' },
        });

        expect(JSON.parse(patched.body)).toMatchObject({ name: 'After' });

        const deleted = await app.inject({
            method: 'DELETE',
            url: `/api/v1/workspaces/${workspaceId}/items/${itemId}`,
            headers: { cookie },
        });

        expect(deleted.statusCode).toBe(200);

        const fetched = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/items/${itemId}`,
            headers: { cookie },
        });

        expect(fetched.statusCode).toBe(404);
    });

    // The tenancy property this whole slice exists to demonstrate.
    it("returns 404, not 403, for another workspace's item", async () => {
        const a = await signUpUser();
        const b = await signUpUser();
        const itemId = await createItem(b.cookie, b.workspaceId, 'theirs');

        const byId = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${a.workspaceId}/items/${itemId}`,
            headers: { cookie: a.cookie },
        });
        expect(byId.statusCode).toBe(404);

        const byWorkspace = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${b.workspaceId}/items`,
            headers: { cookie: a.cookie },
        });
        expect(byWorkspace.statusCode).toBe(404);
    });

    it('is reachable by an MCP token pinned to the same workspace', async () => {
        const user = await seedUser(app.db, { email: `mcp-items-${randomUUID()}@example.com`, displayName: 'Mcp' });
        const workspace = await seedWorkspace(app.db, { name: 'Mcp Workspace', ownerId: user.id });
        const token = await seedMcpToken(app.db, { userId: user.id, workspaceId: workspace.id });

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspace.id}/items`,
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
    });
});
