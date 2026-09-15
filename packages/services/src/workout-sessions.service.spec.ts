import { randomUUID } from 'node:crypto';
import { type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { DEFAULT_REST_SECONDS } from '@app/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExercisesService } from './exercises.service.js';
import { seedCatalogExercise, seedUser, seedWorkspace } from './testing.js';
import { WorkoutSessionsService } from './workout-sessions.service.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let sessions: WorkoutSessionsService;
let exercises: ExercisesService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const membership = new WorkspaceMembershipService({ db });
    sessions = new WorkoutSessionsService({ db, membership });
    exercises = new ExercisesService({ db, membership });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
});

afterAll(async () => {
    await database?.stop();
});

describe('rest between sets', () => {
    it("resolves each session exercise's rest from the workspace's setting, then the slot, then the default", async () => {
        const preferredId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        const plannedId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        const defaultedId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        await exercises.setPreferences({ userId, workspaceId, exerciseId: preferredId, restSeconds: 150 });
        const session = await sessions.start({ userId, workspaceId });
        const sessionId = session.id;
        await sessions.addExercise({
            userId,
            workspaceId,
            sessionId,
            exerciseId: preferredId,
            targetSets: 3,
            restSeconds: 60,
        });
        await sessions.addExercise({
            userId,
            workspaceId,
            sessionId,
            exerciseId: plannedId,
            targetSets: 3,
            restSeconds: 60,
        });
        const detail = await sessions.addExercise({
            userId,
            workspaceId,
            sessionId,
            exerciseId: defaultedId,
            targetSets: 3,
        });

        expect(detail.exercises.map((exercise) => exercise.restSeconds)).toEqual([150, 60, DEFAULT_REST_SECONDS]);

        await sessions.abandon({ userId, workspaceId, sessionId });
    });

    it("ignores another workspace's setting for the same catalog exercise", async () => {
        const sharedId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        await exercises.setPreferences({ userId, workspaceId, exerciseId: sharedId, restSeconds: 200 });
        const theirs = await sessions.start({ userId: outsiderId, workspaceId: otherWorkspaceId });

        const detail = await sessions.addExercise({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            sessionId: theirs.id,
            exerciseId: sharedId,
            targetSets: 3,
        });

        expect(detail.exercises[0]?.restSeconds).toBe(DEFAULT_REST_SECONDS);

        await sessions.abandon({ userId: outsiderId, workspaceId: otherWorkspaceId, sessionId: theirs.id });
    });
});
