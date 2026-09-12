import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

let app: TestApp;

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('guide link routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${randomUUID()}/exercises/${randomUUID()}/links`,
            payload: { url: 'https://example.com' },
        });

        expect(response.statusCode).toBe(401);
    });

    it('appends links in order', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });

        const first = await postLink({ cookie, workspaceId, exerciseId, payload: { url: 'https://example.com/a' } });
        const second = await postLink({
            cookie,
            workspaceId,
            exerciseId,
            payload: { url: 'https://example.com/b', label: 'Second' },
        });

        expect(first.statusCode).toBe(200);
        expect(JSON.parse(first.body)).toMatchObject({ url: 'https://example.com/a', label: null, position: 0 });
        expect(JSON.parse(second.body)).toMatchObject({ url: 'https://example.com/b', label: 'Second', position: 1 });
    });

    it('patches only the field given', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });
        const link = JSON.parse(
            (
                await postLink({
                    cookie,
                    workspaceId,
                    exerciseId,
                    payload: { url: 'https://example.com/x', label: 'Old' },
                })
            ).body,
        ) as { id: string };

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links/${link.id}`,
            headers: { cookie },
            payload: { label: 'New' },
        });

        expect(patched.statusCode).toBe(200);
        expect(JSON.parse(patched.body)).toMatchObject({ url: 'https://example.com/x', label: 'New' });
    });

    it('deletes a link, and it leaves the exercise detail', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({ cookie, workspaceId });
        const link = JSON.parse(
            (await postLink({ cookie, workspaceId, exerciseId, payload: { url: 'https://example.com/doomed' } })).body,
        ) as { id: string };

        const deleted = await app.inject({
            method: 'DELETE',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links/${link.id}`,
            headers: { cookie },
        });

        expect(deleted.statusCode).toBe(200);

        const detail = await getDetail({ cookie, workspaceId, exerciseId });
        expect(detail.links).toHaveLength(0);
    });
});

describe('cross-workspace access', () => {
    it("returns 404 on every guide link route for another workspace's exercise", async () => {
        const owner = await signUpUser();
        const outsider = await signUpUser();
        const exerciseId = await createExercise({ cookie: owner.cookie, workspaceId: owner.workspaceId });

        const link = JSON.parse(
            (
                await postLink({
                    cookie: owner.cookie,
                    workspaceId: owner.workspaceId,
                    exerciseId,
                    payload: { url: 'https://example.com/theirs' },
                })
            ).body,
        ) as { id: string };

        // The outsider names their OWN workspace with the owner's exercise id: the workspace is
        // one they belong to, so only the tenant filter on the exercise itself refuses them.
        const base = `/api/v1/workspaces/${outsider.workspaceId}/exercises/${exerciseId}`;
        const headers = { cookie: outsider.cookie };

        const responses = await Promise.all([
            app.inject({ method: 'POST', url: `${base}/links`, headers, payload: { url: 'https://example.com/x' } }),
            app.inject({ method: 'PATCH', url: `${base}/links/${link.id}`, headers, payload: { label: 'Hijacked' } }),
            app.inject({ method: 'DELETE', url: `${base}/links/${link.id}`, headers }),
        ]);

        expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404]);

        const detail = await getDetail({
            cookie: owner.cookie,
            workspaceId: owner.workspaceId,
            exerciseId,
        });
        expect(detail.links).toEqual([expect.objectContaining({ id: link.id, label: null })]);
    });
});

/** A signed-up user, their default workspace, and a session cookie for them. */
async function signUpUser(): Promise<{ cookie: string; workspaceId: string; userId: string }> {
    const email = `guide-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';

    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });

    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { userId: string; workspaces: { workspaceId: string }[] };

    return { cookie, userId: body.userId, workspaceId: body.workspaces[0]?.workspaceId as string };
}

async function createExercise({ cookie, workspaceId }: { cookie: string; workspaceId: string }): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises`,
        headers: { cookie },
        payload: { name: 'Bench Press', trackingType: 'weight_reps' },
    });

    return (JSON.parse(response.body) as { id: string }).id;
}

async function getDetail({
    cookie,
    workspaceId,
    exerciseId,
}: {
    cookie: string;
    workspaceId: string;
    exerciseId: string;
}): Promise<{ links: { id: string; label: string | null }[] }> {
    const response = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
        headers: { cookie },
    });

    return JSON.parse(response.body) as { links: { id: string; label: string | null }[] };
}

function postLink({
    cookie,
    workspaceId,
    exerciseId,
    payload,
}: {
    cookie: string;
    workspaceId: string;
    exerciseId: string;
    payload: Record<string, unknown>;
}): ReturnType<TestApp['inject']> {
    return app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}/links`,
        headers: { cookie },
        payload,
    });
}
