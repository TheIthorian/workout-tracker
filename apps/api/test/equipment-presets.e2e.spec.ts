import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

let app: TestApp;

async function signUpUser(): Promise<{ cookie: string; workspaceId: string }> {
    const email = `presets-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';
    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });
    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { workspaces: { workspaceId: string }[] };
    return { cookie, workspaceId: body.workspaces[0]?.workspaceId as string };
}

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('equipment preset routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${randomUUID()}/equipment-presets`,
        });
        expect(response.statusCode).toBe(401);
    });

    it('creates, lists, updates and deletes a preset', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const base = `/api/v1/workspaces/${workspaceId}/equipment-presets`;

        const created = await app.inject({
            method: 'POST',
            url: base,
            headers: { cookie },
            payload: { name: 'Home', equipment: ['dumbbell', 'bench'] },
        });
        expect(created.statusCode).toBe(201);
        const preset = JSON.parse(created.body) as { id: string; name: string; equipment: string[] };
        expect(preset).toMatchObject({ name: 'Home', equipment: ['dumbbell', 'bench'] });

        const listed = await app.inject({ method: 'GET', url: base, headers: { cookie } });
        expect(JSON.parse(listed.body)).toEqual({ data: [expect.objectContaining({ id: preset.id })] });

        const patched = await app.inject({
            method: 'PATCH',
            url: `${base}/${preset.id}`,
            headers: { cookie },
            payload: { equipment: [] },
        });
        expect(patched.statusCode).toBe(200);
        expect(JSON.parse(patched.body)).toMatchObject({ name: 'Home', equipment: [] });

        const deleted = await app.inject({ method: 'DELETE', url: `${base}/${preset.id}`, headers: { cookie } });
        expect(deleted.statusCode).toBe(204);

        const after = await app.inject({ method: 'GET', url: base, headers: { cookie } });
        expect(JSON.parse(after.body)).toEqual({ data: [] });
    });

    it('answers 409 for a duplicate name', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const base = `/api/v1/workspaces/${workspaceId}/equipment-presets`;
        await app.inject({ method: 'POST', url: base, headers: { cookie }, payload: { name: 'Gym' } });

        const duplicate = await app.inject({
            method: 'POST',
            url: base,
            headers: { cookie },
            payload: { name: 'Gym' },
        });
        expect(duplicate.statusCode).toBe(409);
    });

    it("answers 404 for another workspace's preset and for a malformed id", async () => {
        const owner = await signUpUser();
        const outsider = await signUpUser();
        const created = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${owner.workspaceId}/equipment-presets`,
            headers: { cookie: owner.cookie },
            payload: { name: 'Theirs' },
        });
        const presetId = (JSON.parse(created.body) as { id: string }).id;

        const listed = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${owner.workspaceId}/equipment-presets`,
            headers: { cookie: outsider.cookie },
        });
        expect(listed.statusCode).toBe(404);

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${outsider.workspaceId}/equipment-presets/${presetId}`,
            headers: { cookie: outsider.cookie },
            payload: { name: 'Mine' },
        });
        expect(patched.statusCode).toBe(404);

        const malformed = await app.inject({
            method: 'DELETE',
            url: `/api/v1/workspaces/${outsider.workspaceId}/equipment-presets/not-a-uuid`,
            headers: { cookie: outsider.cookie },
        });
        expect(malformed.statusCode).toBe(404);
    });
});
