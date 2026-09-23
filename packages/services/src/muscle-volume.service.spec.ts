import { randomUUID } from 'node:crypto';
import { type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { MuscleGroup, TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExercisesService } from './exercises.service.js';
import { MuscleVolumeService } from './muscle-volume.service.js';
import { seedUser, seedWorkspace } from './testing.js';
import { WorkoutSessionsService } from './workout-sessions.service.js';
import { RoutineRecommendationsService } from './routine-recommendations.service.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let muscleVolume: MuscleVolumeService;
let exercises: ExercisesService;
let sessions: WorkoutSessionsService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const membership = new WorkspaceMembershipService({ db });
    muscleVolume = new MuscleVolumeService({ db, membership });
    exercises = new ExercisesService({ db, membership, recommendations: new RoutineRecommendationsService({ db }) });
    sessions = new WorkoutSessionsService({
        db,
        membership,
        recommendations: new RoutineRecommendationsService({ db }),
    });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
});

afterAll(async () => {
    await database?.stop();
});

/** Logs one completed workout of `sets` working sets of a freshly created, muscle-tagged exercise. */
async function logWorkout({
    ownerId,
    ownerWorkspaceId,
    primaryMuscles,
    secondaryMuscles,
    sets,
    warmupSets = 0,
}: {
    ownerId: string;
    ownerWorkspaceId: string;
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
    sets: number;
    warmupSets?: number;
}): Promise<string> {
    const exercise = await exercises.create({
        userId: ownerId,
        workspaceId: ownerWorkspaceId,
        name: `Movement ${randomUUID()}`,
        trackingType: TrackingType.WeightReps,
        primaryMuscles,
        secondaryMuscles,
    });
    const session = await sessions.start({ userId: ownerId, workspaceId: ownerWorkspaceId });
    const withExercise = await sessions.addExercise({
        userId: ownerId,
        workspaceId: ownerWorkspaceId,
        sessionId: session.id,
        exerciseId: exercise.id,
        targetSets: Math.max(1, sets),
    });
    const sessionExerciseId = withExercise.exercises[0].id;

    for (let logged = 0; logged < sets + warmupSets; logged += 1) {
        await sessions.logSet({
            userId: ownerId,
            workspaceId: ownerWorkspaceId,
            sessionId: session.id,
            sessionExerciseId,
            isWarmup: logged < warmupSets,
            weightKg: 60,
            reps: 8,
        });
    }

    await sessions.complete({ userId: ownerId, workspaceId: ownerWorkspaceId, sessionId: session.id });

    return exercise.id;
}

describe('summarise', () => {
    it('weights a secondary muscle at half a set and scales intensity to the hardest-worked muscle', async () => {
        const ownerId = await seedUser(db);
        const ownWorkspaceId = await seedWorkspace(db, ownerId);
        await logWorkout({
            ownerId,
            ownerWorkspaceId: ownWorkspaceId,
            primaryMuscles: [MuscleGroup.Chest],
            secondaryMuscles: [MuscleGroup.Triceps],
            sets: 4,
        });

        const summary = await muscleVolume.summarise({ userId: ownerId, workspaceId: ownWorkspaceId, days: 30 });

        expect(summary.sessionCount).toBe(1);
        expect(summary.totalSets).toBe(4);
        expect(summary.untaggedSets).toBe(0);
        expect(summary.muscles).toEqual([
            { muscle: MuscleGroup.Chest, sets: 4, weightedSets: 4, intensity: 1 },
            { muscle: MuscleGroup.Triceps, sets: 4, weightedSets: 2, intensity: 0.5 },
        ]);
        expect(summary.exercises).toEqual([expect.objectContaining({ sets: 4 })]);
    });

    it('leaves warm-up sets out of the volume it reports', async () => {
        const ownerId = await seedUser(db);
        const ownWorkspaceId = await seedWorkspace(db, ownerId);
        await logWorkout({
            ownerId,
            ownerWorkspaceId: ownWorkspaceId,
            primaryMuscles: [MuscleGroup.Quads],
            secondaryMuscles: [],
            sets: 3,
            warmupSets: 2,
        });

        const summary = await muscleVolume.summarise({ userId: ownerId, workspaceId: ownWorkspaceId, days: 30 });

        expect(summary.totalSets).toBe(3);
        expect(summary.muscles).toEqual([{ muscle: MuscleGroup.Quads, sets: 3, weightedSets: 3, intensity: 1 }]);
    });

    it('counts sets of an untagged exercise towards the total but not towards any muscle', async () => {
        const ownerId = await seedUser(db);
        const ownWorkspaceId = await seedWorkspace(db, ownerId);
        await logWorkout({
            ownerId,
            ownerWorkspaceId: ownWorkspaceId,
            primaryMuscles: [],
            secondaryMuscles: [],
            sets: 2,
        });

        const summary = await muscleVolume.summarise({ userId: ownerId, workspaceId: ownWorkspaceId, days: 30 });

        expect(summary.totalSets).toBe(2);
        expect(summary.untaggedSets).toBe(2);
        expect(summary.muscles).toEqual([]);
    });

    it('ignores a workout that has not been completed', async () => {
        const ownerId = await seedUser(db);
        const ownWorkspaceId = await seedWorkspace(db, ownerId);
        const exercise = await exercises.create({
            userId: ownerId,
            workspaceId: ownWorkspaceId,
            name: 'In progress',
            trackingType: TrackingType.WeightReps,
            primaryMuscles: [MuscleGroup.Lats],
        });
        const session = await sessions.start({ userId: ownerId, workspaceId: ownWorkspaceId });
        const withExercise = await sessions.addExercise({
            userId: ownerId,
            workspaceId: ownWorkspaceId,
            sessionId: session.id,
            exerciseId: exercise.id,
            targetSets: 3,
        });
        await sessions.logSet({
            userId: ownerId,
            workspaceId: ownWorkspaceId,
            sessionId: session.id,
            sessionExerciseId: withExercise.exercises[0].id,
            weightKg: 40,
            reps: 10,
        });

        const summary = await muscleVolume.summarise({ userId: ownerId, workspaceId: ownWorkspaceId, days: 30 });

        expect(summary.muscles).toEqual([]);
        expect(summary.totalSets).toBe(0);
    });

    it("never counts another workspace's workouts", async () => {
        const ownerId = await seedUser(db);
        const ownWorkspaceId = await seedWorkspace(db, ownerId);
        await logWorkout({
            ownerId: userId,
            ownerWorkspaceId: workspaceId,
            primaryMuscles: [MuscleGroup.Calves],
            secondaryMuscles: [],
            sets: 5,
        });

        const summary = await muscleVolume.summarise({ userId: ownerId, workspaceId: ownWorkspaceId, days: 30 });

        expect(summary.muscles).toEqual([]);
        expect(summary.totalSets).toBe(0);
        expect(summary.sessionCount).toBe(0);
    });

    it('tells a caller who is not a member that the workspace does not exist', async () => {
        await expect(muscleVolume.summarise({ userId: outsiderId, workspaceId, days: 30 })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(
            muscleVolume.summarise({ userId, workspaceId: otherWorkspaceId, days: 30 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});
