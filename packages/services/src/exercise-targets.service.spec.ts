import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { FIRST_ATTEMPT_MESSAGE, NextEffortSource, TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExerciseTargetsService } from './exercise-targets.service.js';
import { seedCatalogExercise, seedUser, seedWorkspace } from './testing.js';
import { WorkoutSessionsService } from './workout-sessions.service.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let targets: ExerciseTargetsService;
let sessions: WorkoutSessionsService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const membership = new WorkspaceMembershipService({ db });
    targets = new ExerciseTargetsService({ db, membership });
    sessions = new WorkoutSessionsService({ db, membership });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
});

afterAll(async () => {
    await database?.stop();
});

/** Trains an exercise once and completes the session, so the exercise has history to suggest from. */
async function performOnce({
    exerciseId,
    weightKg,
    reps,
    rpe,
}: {
    exerciseId: string;
    weightKg: number;
    reps: number;
    rpe: number | null;
}): Promise<void> {
    const started = await sessions.start({ userId, workspaceId });
    const withExercise = await sessions.addExercise({
        userId,
        workspaceId,
        sessionId: started.id,
        exerciseId,
        targetSets: 1,
    });
    const slot = withExercise.exercises.find((entry) => entry.exercise.id === exerciseId);

    await sessions.logSet({
        userId,
        workspaceId,
        sessionId: started.id,
        sessionExerciseId: slot!.id,
        weightKg,
        reps,
        rpe,
    });
    await sessions.complete({ userId, workspaceId, sessionId: started.id });
}

describe('suggest', () => {
    it('advises a baseline the first time an exercise is trained', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });

        const suggestion = await targets.suggest({ userId, workspaceId, exerciseId });

        expect(suggestion).toMatchObject({
            source: NextEffortSource.Baseline,
            isFirstAttempt: true,
            message: FIRST_ATTEMPT_MESSAGE,
            weightKg: null,
            reps: null,
            lastPerformedAt: null,
            target: null,
        });
    });

    it('progresses from the last working set when it came in easy', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        await performOnce({ exerciseId, weightKg: 60, reps: 8, rpe: 6 });

        const suggestion = await targets.suggest({ userId, workspaceId, exerciseId });

        expect(suggestion).toMatchObject({
            source: NextEffortSource.LastPerformance,
            isFirstAttempt: false,
            weightKg: 65,
            reps: 8,
        });
        expect(suggestion.lastPerformedAt).not.toBeNull();
    });

    it('prefers a target set after the last session', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        await performOnce({ exerciseId, weightKg: 60, reps: 8, rpe: 6 });
        await targets.set({ userId, workspaceId, exerciseId, weightKg: 80, reps: 3, note: 'Heavy triple.' });

        const suggestion = await targets.suggest({ userId, workspaceId, exerciseId });

        expect(suggestion).toMatchObject({
            source: NextEffortSource.Target,
            weightKg: 80,
            reps: 3,
            message: 'Heavy triple.',
        });
    });

    it('falls back to history once the target has been trained through, keeping the spent target visible', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        await targets.set({ userId, workspaceId, exerciseId, weightKg: 80, reps: 3 });
        await performOnce({ exerciseId, weightKg: 80, reps: 3, rpe: 9 });

        const suggestion = await targets.suggest({ userId, workspaceId, exerciseId });

        expect(suggestion.source).toBe(NextEffortSource.LastPerformance);
        expect(suggestion.weightKg).toBe(80);
        expect(suggestion.target).toMatchObject({ weightKg: 80, reps: 3 });
    });

    it('ignores warm-up sets when reading the last performance', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        const started = await sessions.start({ userId, workspaceId });
        const withExercise = await sessions.addExercise({
            userId,
            workspaceId,
            sessionId: started.id,
            exerciseId,
            targetSets: 2,
        });
        const sessionExerciseId = withExercise.exercises[0]!.id;

        await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId,
            weightKg: 40,
            reps: 10,
        });
        await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId,
            weightKg: 20,
            reps: 10,
            isWarmup: true,
        });
        await sessions.complete({ userId, workspaceId, sessionId: started.id });

        const suggestion = await targets.suggest({ userId, workspaceId, exerciseId });

        expect(suggestion.weightKg).toBe(40);
    });

    it('ignores an unfinished session, which is not yet a performance to build on', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        const started = await sessions.start({ userId, workspaceId });
        const withExercise = await sessions.addExercise({
            userId,
            workspaceId,
            sessionId: started.id,
            exerciseId,
            targetSets: 1,
        });

        await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: withExercise.exercises[0]!.id,
            weightKg: 50,
            reps: 5,
        });

        const suggestion = await targets.suggest({ userId, workspaceId, exerciseId });

        expect(suggestion.isFirstAttempt).toBe(true);
        await sessions.complete({ userId, workspaceId, sessionId: started.id });
    });

    it('suggests only the fields the tracking type allows', async () => {
        const exerciseId = await seedCatalogExercise(db, {
            slug: `catalog-${randomUUID()}`,
            trackingType: TrackingType.Duration,
        });
        await targets.set({ userId, workspaceId, exerciseId, durationSeconds: 90, weightKg: 20 });

        const suggestion = await targets.suggest({ userId, workspaceId, exerciseId });

        expect(suggestion).toMatchObject({ durationSeconds: 90, weightKg: null, reps: null, distanceM: null });
    });
});

describe('set and clear', () => {
    it('replaces the stored target rather than merging into it', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });

        await targets.set({ userId, workspaceId, exerciseId, weightKg: 60, reps: 10, note: 'First pass.' });
        const replaced = await targets.set({ userId, workspaceId, exerciseId, reps: 5 });

        expect(replaced).toMatchObject({ weightKg: null, reps: 5, note: null });
    });

    it('clears a target, and clearing again is not an error', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        await targets.set({ userId, workspaceId, exerciseId, weightKg: 60 });

        await targets.clear({ userId, workspaceId, exerciseId });
        await targets.clear({ userId, workspaceId, exerciseId });

        expect((await targets.suggest({ userId, workspaceId, exerciseId })).target).toBeNull();
    });
});

describe('tenancy', () => {
    it('refuses a workspace the caller does not belong to', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });

        await expect(targets.suggest({ userId, workspaceId: otherWorkspaceId, exerciseId })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(
            targets.set({ userId, workspaceId: otherWorkspaceId, exerciseId, weightKg: 100 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(targets.clear({ userId, workspaceId: otherWorkspaceId, exerciseId })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });

    it('keeps each workspace to its own target for a shared catalog exercise', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });

        await targets.set({ userId, workspaceId, exerciseId, weightKg: 60 });
        await targets.set({ userId: outsiderId, workspaceId: otherWorkspaceId, exerciseId, weightKg: 100 });

        expect((await targets.suggest({ userId, workspaceId, exerciseId })).weightKg).toBe(60);
        expect(
            (await targets.suggest({ userId: outsiderId, workspaceId: otherWorkspaceId, exerciseId })).weightKg,
        ).toBe(100);
    });

    it('does not suggest from another workspace’s sessions', async () => {
        const exerciseId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        await performOnce({ exerciseId, weightKg: 60, reps: 8, rpe: 6 });

        const suggestion = await targets.suggest({ userId: outsiderId, workspaceId: otherWorkspaceId, exerciseId });

        expect(suggestion).toMatchObject({ isFirstAttempt: true, source: NextEffortSource.Baseline });
    });

    it('answers not found for an exercise belonging to another workspace', async () => {
        const [foreign] = await db
            .insert(schema.exercises)
            .values({
                workspaceId: otherWorkspaceId,
                name: 'Their Own Lift',
                trackingType: TrackingType.WeightReps,
            })
            .returning({ id: schema.exercises.id });

        await expect(
            targets.set({ userId, workspaceId, exerciseId: foreign!.id, weightKg: 50 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(targets.suggest({ userId, workspaceId, exerciseId: foreign!.id })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});
