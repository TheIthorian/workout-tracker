import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, TEST_WEB_APP_BASE_URL, type TestApp } from './harness.js';

let app: TestApp;

async function signUpUser(): Promise<{ cookie: string; workspaceId: string }> {
    const email = `routines-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';

    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });

    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { workspaces: { workspaceId: string }[] };

    return { cookie, workspaceId: body.workspaces[0]?.workspaceId as string };
}

async function createExercise({
    cookie,
    workspaceId,
    name,
    trackingType = 'weight_reps',
}: {
    cookie: string;
    workspaceId: string;
    name: string;
    trackingType?: string;
}): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises`,
        headers: { cookie },
        payload: { name, trackingType },
    });

    return (JSON.parse(response.body) as { id: string }).id;
}

async function createRoutine({ cookie, workspaceId }: { cookie: string; workspaceId: string }): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/routines`,
        headers: { cookie },
        payload: { name: 'Push Day' },
    });

    expect(response.statusCode).toBe(200);

    return (JSON.parse(response.body) as { id: string }).id;
}

type SlotBody = { id: string; position: number; exercise: { name: string } };

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('routine routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/v1/workspaces/${randomUUID()}/routines` });

        expect(response.statusCode).toBe(401);
    });

    it('creates a routine, reads it back with a webUrl, and lists it', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const routineId = await createRoutine({ cookie, workspaceId });

        const fetched = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/routines/${routineId}`,
            headers: { cookie },
        });
        expect(fetched.statusCode).toBe(200);
        expect(JSON.parse(fetched.body)).toMatchObject({
            name: 'Push Day',
            exerciseCount: 0,
            exercises: [],
            webUrl: `${TEST_WEB_APP_BASE_URL}/routines/${routineId}`,
        });

        const listed = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/routines`,
            headers: { cookie },
        });
        expect((JSON.parse(listed.body) as { data: { id: string }[] }).data.map((row) => row.id)).toEqual([routineId]);
    });

    it('returns 404, not 400, for a malformed routine id', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/routines/not-a-uuid`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(404);
    });

    it("returns 404 for another workspace's routine, on read and on every write", async () => {
        const owner = await signUpUser();
        const outsider = await signUpUser();
        const routineId = await createRoutine(owner);
        const exerciseId = await createExercise({ ...outsider, name: 'Theirs' });
        const base = `/api/v1/workspaces/${outsider.workspaceId}/routines/${routineId}`;

        const attempts = [
            app.inject({ method: 'GET', url: base, headers: { cookie: outsider.cookie } }),
            app.inject({ method: 'PATCH', url: base, headers: { cookie: outsider.cookie }, payload: { name: 'x' } }),
            app.inject({
                method: 'POST',
                url: `${base}/exercises`,
                headers: { cookie: outsider.cookie },
                payload: { exerciseId },
            }),
            app.inject({
                method: 'PUT',
                url: `${base}/exercises`,
                headers: { cookie: outsider.cookie },
                payload: { exercises: [] },
            }),
            app.inject({
                method: 'PATCH',
                url: `${base}/exercises/${randomUUID()}`,
                headers: { cookie: outsider.cookie },
                payload: { targetSets: 2 },
            }),
            app.inject({
                method: 'DELETE',
                url: `${base}/exercises/${randomUUID()}`,
                headers: { cookie: outsider.cookie },
            }),
        ];

        for (const response of await Promise.all(attempts)) {
            expect(response.statusCode).toBe(404);
        }
    });

    it('adds, updates, removes, and replaces slots', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const routineId = await createRoutine({ cookie, workspaceId });
        const benchId = await createExercise({ cookie, workspaceId, name: 'Bench' });
        const plankId = await createExercise({ cookie, workspaceId, name: 'Plank', trackingType: 'duration' });
        const base = `/api/v1/workspaces/${workspaceId}/routines/${routineId}/exercises`;

        const added = await app.inject({
            method: 'POST',
            url: base,
            headers: { cookie },
            payload: { exerciseId: benchId, targetReps: 8, targetWeightKg: 60 },
        });
        expect(added.statusCode).toBe(200);
        const slot = (JSON.parse(added.body) as { exercises: SlotBody[] }).exercises[0] as SlotBody;
        expect(slot).toMatchObject({ position: 0, targetSets: 3, targetReps: 8, targetWeightKg: 60 });

        const patched = await app.inject({
            method: 'PATCH',
            url: `${base}/${slot.id}`,
            headers: { cookie },
            payload: { targetSets: 5 },
        });
        expect(patched.statusCode).toBe(200);
        expect((JSON.parse(patched.body) as { exercises: SlotBody[] }).exercises[0]).toMatchObject({
            targetSets: 5,
            targetReps: 8,
        });

        const replaced = await app.inject({
            method: 'PUT',
            url: base,
            headers: { cookie },
            payload: {
                exercises: [
                    { exerciseId: plankId, targetSets: 2, targetDurationSeconds: 60 },
                    { exerciseId: benchId, targetSets: 3, targetReps: 10 },
                ],
            },
        });
        expect(replaced.statusCode).toBe(200);
        const replacedSlots = (JSON.parse(replaced.body) as { exercises: SlotBody[] }).exercises;
        expect(replacedSlots.map((row) => [row.position, row.exercise.name])).toEqual([
            [0, 'Plank'],
            [1, 'Bench'],
        ]);

        const removed = await app.inject({
            method: 'DELETE',
            url: `${base}/${replacedSlots[0]?.id}`,
            headers: { cookie },
        });
        expect(removed.statusCode).toBe(200);
        expect((JSON.parse(removed.body) as { exercises: SlotBody[] }).exercises.map((row) => row.position)).toEqual([
            0,
        ]);
    });

    it('rejects a target that does not fit the tracking type with a 400 problem', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const routineId = await createRoutine({ cookie, workspaceId });
        const plankId = await createExercise({ cookie, workspaceId, name: 'Plank', trackingType: 'duration' });

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/routines/${routineId}/exercises`,
            headers: { cookie },
            payload: { exerciseId: plankId, targetReps: 8 },
        });

        expect(response.statusCode).toBe(400);
        expect((JSON.parse(response.body) as { type: string }).type).toMatch(/SetShapeMismatchError$/);
    });

    it('rejects a body that fails the contract with a 400', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const routineId = await createRoutine({ cookie, workspaceId });

        const response = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/routines/${routineId}`,
            headers: { cookie },
            payload: {},
        });

        expect(response.statusCode).toBe(400);
    });

    it('hides an archived routine from the default list', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const routineId = await createRoutine({ cookie, workspaceId });

        await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/routines/${routineId}`,
            headers: { cookie },
            payload: { archived: true },
        });

        const listed = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/routines`,
            headers: { cookie },
        });
        expect((JSON.parse(listed.body) as { data: unknown[] }).data).toHaveLength(0);

        const all = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/routines?includeArchived=true`,
            headers: { cookie },
        });
        expect((JSON.parse(all.body) as { data: unknown[] }).data).toHaveLength(1);
    });
});
