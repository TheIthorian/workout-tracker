import { randomUUID } from 'node:crypto';
import { MuscleGroup, TrackingType } from '@app/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

let app: TestApp;

/** A signed-up user, their default workspace, and a session cookie for them. */
async function signUpUser(): Promise<{ cookie: string; workspaceId: string }> {
    const email = `muscle-volume-${randomUUID()}@example.com`;
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

describe('muscle volume route', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${randomUUID()}/analytics/muscle-volume`,
        });

        expect(response.statusCode).toBe(401);
    });

    it("answers 404 for a workspace the caller doesn't belong to", async () => {
        const { cookie } = await signUpUser();

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${randomUUID()}/analytics/muscle-volume`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(404);
    });

    it('summarises a completed workout by muscle', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const created = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
            payload: {
                name: 'Bench press',
                trackingType: TrackingType.WeightReps,
                primaryMuscles: [MuscleGroup.Chest],
                secondaryMuscles: [MuscleGroup.Triceps],
            },
        });
        const exerciseId = (JSON.parse(created.body) as { id: string }).id;

        const started = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/sessions`,
            headers: { cookie },
            payload: { name: 'Push day' },
        });
        const sessionId = (JSON.parse(started.body) as { id: string }).id;

        const withExercise = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/exercises`,
            headers: { cookie },
            payload: { exerciseId, targetSets: 2 },
        });
        const sessionExerciseId = (JSON.parse(withExercise.body) as { exercises: { id: string }[] }).exercises[0].id;

        for (let set = 0; set < 2; set += 1) {
            await app.inject({
                method: 'POST',
                url: `/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/exercises/${sessionExerciseId}/sets`,
                headers: { cookie },
                payload: { weightKg: 60, reps: 8 },
            });
        }

        await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/sessions/${sessionId}/complete`,
            headers: { cookie },
            payload: {},
        });

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/analytics/muscle-volume?days=7`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            days: 7,
            sessionCount: 1,
            totalSets: 2,
            untaggedSets: 0,
            muscles: [
                { muscle: MuscleGroup.Chest, sets: 2, weightedSets: 2, intensity: 1 },
                { muscle: MuscleGroup.Triceps, sets: 2, weightedSets: 1, intensity: 0.5 },
            ],
            exercises: [{ exerciseId, name: 'Bench press', sets: 2 }],
        });
    });
});
