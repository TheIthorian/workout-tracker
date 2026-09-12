import { randomUUID } from 'node:crypto';
import { schema } from '@app/db';
import { TrackingType } from '@app/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, TEST_CATALOG_IMAGE_BASE_URL, type TestApp } from './harness.js';

let app: TestApp;

/** A signed-up user, their default workspace, and a session cookie for them. */
async function signUpUser(): Promise<{ cookie: string; workspaceId: string; userId: string }> {
    const email = `exercises-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';

    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });

    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { userId: string; workspaces: { workspaceId: string }[] };

    return { cookie, userId: body.userId, workspaceId: body.workspaces[0]?.workspaceId as string };
}

async function createExercise({
    cookie,
    workspaceId,
    payload,
}: {
    cookie: string;
    workspaceId: string;
    payload: Record<string, unknown>;
}): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises`,
        headers: { cookie },
        payload,
    });

    return (JSON.parse(response.body) as { id: string }).id;
}

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('exercise routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/v1/workspaces/${randomUUID()}/exercises` });

        expect(response.statusCode).toBe(401);
    });

    it('creates an exercise and reads back its guide', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const created = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
            payload: { name: 'Bench Press', trackingType: 'weight_reps', guideCues: 'Ribs down.' },
        });

        expect(created.statusCode).toBe(200);
        const exerciseId = (JSON.parse(created.body) as { id: string }).id;

        const fetched = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
            headers: { cookie },
        });

        expect(fetched.statusCode).toBe(200);
        expect(JSON.parse(fetched.body)).toMatchObject({
            name: 'Bench Press',
            trackingType: 'weight_reps',
            guideCues: 'Ribs down.',
            images: [],
            links: [],
        });
    });

    it('rejects an unknown tracking type', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
            payload: { name: 'Vibes', trackingType: 'vibes' },
        });

        expect(response.statusCode).toBe(400);
    });

    // A segment that cannot be a valid id names no resource, and a 400 would let a caller tell
    // "wrong shape" apart from "no such row".
    it('returns 404, not 400, for a malformed exercise id', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises/not-a-uuid`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(404);
    });

    it("returns 404 for another workspace's exercise", async () => {
        const owner = await signUpUser();
        const outsider = await signUpUser();
        const exerciseId = await createExercise({
            cookie: owner.cookie,
            workspaceId: owner.workspaceId,
            payload: { name: 'Theirs', trackingType: 'weight_reps' },
        });

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${outsider.workspaceId}/exercises/${exerciseId}`,
            headers: { cookie: outsider.cookie },
        });

        expect(response.statusCode).toBe(404);
    });

    it('updates one guide field and leaves the others alone', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({
            cookie,
            workspaceId,
            payload: {
                name: 'Squat',
                trackingType: 'weight_reps',
                guideSetup: 'Bar on traps.',
                guideCues: 'Knees out.',
            },
        });

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
            headers: { cookie },
            payload: { guideCues: 'Chest up, knees out.' },
        });

        expect(patched.statusCode).toBe(200);
        expect(JSON.parse(patched.body)).toMatchObject({
            guideSetup: 'Bar on traps.',
            guideCues: 'Chest up, knees out.',
        });
    });

    it('hides an archived exercise from the default list', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise({
            cookie,
            workspaceId,
            payload: { name: 'Retired', trackingType: 'duration' },
        });

        await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
            headers: { cookie },
            payload: { archived: true },
        });

        const listed = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
        });

        expect((JSON.parse(listed.body) as { data: unknown[] }).data).toHaveLength(0);
    });

    it('filters the list by search', async () => {
        const { cookie, workspaceId } = await signUpUser();
        await createExercise({ cookie, workspaceId, payload: { name: 'Bench Press', trackingType: 'weight_reps' } });
        await createExercise({ cookie, workspaceId, payload: { name: 'Plank', trackingType: 'duration' } });

        const listed = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises?search=ben`,
            headers: { cookie },
        });

        const body = JSON.parse(listed.body) as { data: { name: string }[] };
        expect(body.data.map((exercise) => exercise.name)).toEqual(['Bench Press']);
    });
});

describe('catalog exercises', () => {
    async function seedCatalog(): Promise<{ id: string; imageKey: string }> {
        const imageKey = `catalog/e2e-squat/${randomUUID()}.png`;
        const [row] = await app.db
            .insert(schema.exercises)
            .values({
                workspaceId: null,
                slug: `e2e-squat-${randomUUID()}`,
                name: 'E2E Squat',
                trackingType: TrackingType.WeightReps,
            })
            .returning({ id: schema.exercises.id });
        await app.db.insert(schema.exerciseGuideImages).values({
            workspaceId: null,
            exerciseId: row.id,
            storageKey: imageKey,
            contentType: 'image/png',
            position: 0,
        });

        return { id: row.id, imageKey };
    }

    it('lists and reads a catalog exercise for any signed-in member, with an absolute CDN image url', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const { id, imageKey } = await seedCatalog();

        const list = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises?search=${encodeURIComponent('E2E Squat')}`,
            headers: { cookie },
        });
        const listed = (JSON.parse(list.body) as { data: { id: string; isCatalog: boolean }[] }).data;
        expect(listed.find((row) => row.id === id)).toMatchObject({ isCatalog: true });

        const detail = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${id}`,
            headers: { cookie },
        });
        expect(detail.statusCode).toBe(200);
        expect(JSON.parse(detail.body)).toMatchObject({
            isCatalog: true,
            images: [{ url: `${TEST_CATALOG_IMAGE_BASE_URL}/${imageKey}` }],
        });
    });

    it('answers 404 to a PATCH on a catalog exercise through a workspace', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const { id } = await seedCatalog();

        const response = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${id}`,
            headers: { cookie },
            payload: { name: 'Vandalised' },
        });

        expect(response.statusCode).toBe(404);
    });

    it('marks a created exercise as not catalog', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const created = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
            payload: { name: 'Mine', trackingType: 'weight_reps' },
        });

        expect(JSON.parse(created.body)).toMatchObject({ isCatalog: false, slug: null });
    });
});
