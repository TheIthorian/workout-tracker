import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import {
    Equipment,
    estimateRoutineSeconds,
    MuscleGroup,
    RoutineOrder,
    SessionExerciseSource,
    TrackingType,
} from '@app/domain';
import { EntityNotFoundError, SetShapeMismatchError } from '@app/errors';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExercisesService } from './exercises.service.js';
import { RoutinesService, type RoutineListItem } from './routines.service.js';
import { WorkoutSessionsService } from './workout-sessions.service.js';
import { seedCatalogExercise, seedUser, seedWorkspace } from './testing.js';
import { RoutineRecommendationsService } from './routine-recommendations.service.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let routines: RoutinesService;
let exercises: ExercisesService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

let benchId: string;
let plankId: string;
let runId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const membership = new WorkspaceMembershipService({ db });
    routines = new RoutinesService({ db, membership, recommendations: new RoutineRecommendationsService({ db }) });
    exercises = new ExercisesService({ db, membership, recommendations: new RoutineRecommendationsService({ db }) });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);

    benchId = (
        await exercises.create({
            userId,
            workspaceId,
            name: 'Bench',
            trackingType: TrackingType.WeightReps,
            equipment: [Equipment.Barbell, Equipment.Bench],
        })
    ).id;
    plankId = (await exercises.create({ userId, workspaceId, name: 'Plank', trackingType: TrackingType.Duration })).id;
    runId = (await exercises.create({ userId, workspaceId, name: 'Run', trackingType: TrackingType.DistanceTime })).id;
});

afterAll(async () => {
    await database?.stop();
});

const page = { page: 1, pageSize: 20 };

async function createRoutine(name = 'Push Day'): Promise<string> {
    return (await routines.create({ userId, workspaceId, name })).id;
}

describe('create / get / update', () => {
    it('creates an empty routine and reads it back', async () => {
        const created = await routines.create({ userId, workspaceId, name: 'Push Day', description: 'Chest first' });

        expect(created).toMatchObject({
            name: 'Push Day',
            description: 'Chest first',
            exerciseCount: 0,
            exercises: [],
        });
        expect(await routines.get({ userId, workspaceId, routineId: created.id })).toEqual(created);
    });

    it('writes only the fields given, and archives/unarchives', async () => {
        const routineId = await createRoutine('Original');

        const renamed = await routines.update({ userId, workspaceId, routineId, name: 'Renamed' });
        expect(renamed).toMatchObject({ name: 'Renamed', description: null, archivedAt: null });

        const archived = await routines.update({ userId, workspaceId, routineId, archived: true });
        expect(archived.archivedAt).not.toBeNull();

        const restored = await routines.update({ userId, workspaceId, routineId, archived: false });
        expect(restored.archivedAt).toBeNull();
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(
            routines.create({ userId, workspaceId: otherWorkspaceId, name: 'Trespass' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(routines.list({ userId, workspaceId: otherWorkspaceId, ...page })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });

    // The tenant filter, not just the membership check: the caller IS a member of `workspaceId`,
    // so only `scopedToWorkspace` stops them reading another workspace's routine by id.
    it("refuses another workspace's routine id even though the caller is a member of this one", async () => {
        const theirs = await routines.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });

        await expect(routines.get({ userId, workspaceId, routineId: theirs.id })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(
            routines.update({ userId, workspaceId, routineId: theirs.id, name: 'hijacked' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        const [row] = await db
            .select({ name: schema.routines.name })
            .from(schema.routines)
            .where(eq(schema.routines.id, theirs.id));
        expect(row?.name).toBe('theirs');
    });
});

describe('list', () => {
    it('lists this workspace only, by name, with exercise counts, hiding archived unless asked', async () => {
        const ownerId = await seedUser(db);
        const scopedWorkspaceId = await seedWorkspace(db, ownerId);
        const exerciseId = (
            await exercises.create({
                userId: ownerId,
                workspaceId: scopedWorkspaceId,
                name: 'Row',
                trackingType: TrackingType.WeightReps,
            })
        ).id;
        const b = await routines.create({ userId: ownerId, workspaceId: scopedWorkspaceId, name: 'B' });
        const a = await routines.create({ userId: ownerId, workspaceId: scopedWorkspaceId, name: 'A' });
        await routines.addExercise({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            routineId: a.id,
            exerciseId,
            targetSets: 3,
        });
        const retired = await routines.create({ userId: ownerId, workspaceId: scopedWorkspaceId, name: 'Retired' });
        await routines.update({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            routineId: retired.id,
            archived: true,
        });
        await routines.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });

        const visible = await routines.list({ userId: ownerId, workspaceId: scopedWorkspaceId, ...page });
        expect(visible.data.map((routine) => [routine.name, routine.exerciseCount])).toEqual([
            ['A', 1],
            ['B', 0],
        ]);
        expect(visible.totalCount).toBe(2);

        const all = await routines.list({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            ...page,
            includeArchived: true,
        });
        expect(all.data.map((routine) => routine.name)).toEqual(['A', 'B', 'Retired']);

        const searched = await routines.list({ userId: ownerId, workspaceId: scopedWorkspaceId, ...page, search: 'b' });
        expect(searched.data.map((routine) => routine.name)).toEqual(['B']);
        expect(b.id).toBe(searched.data[0]?.id);
    });
});

describe('addExercise', () => {
    it('appends slots in order and joins the exercise summary', async () => {
        const routineId = await createRoutine();

        await routines.addExercise({
            userId,
            workspaceId,
            routineId,
            exerciseId: benchId,
            targetSets: 3,
            targetReps: 8,
        });
        const detail = await routines.addExercise({
            userId,
            workspaceId,
            routineId,
            exerciseId: plankId,
            targetSets: 2,
            targetDurationSeconds: 60,
            restSeconds: 30,
        });

        expect(detail.exerciseCount).toBe(2);
        expect(detail.exercises.map((slot) => [slot.position, slot.exercise.name])).toEqual([
            [0, 'Bench'],
            [1, 'Plank'],
        ]);
        expect(detail.exercises[0]).toMatchObject({
            targetSets: 3,
            targetReps: 8,
            targetWeightKg: null,
            exercise: {
                id: benchId,
                trackingType: TrackingType.WeightReps,
                isCatalog: false,
                equipment: [Equipment.Barbell, Equipment.Bench],
                archivedAt: null,
            },
        });
        expect(detail.exercises[1]).toMatchObject({ targetDurationSeconds: 60, restSeconds: 30 });
        expect(detail.exercises[1]?.exercise.equipment).toEqual([]);
    });

    it('stores decimal weights and distances as numbers', async () => {
        const routineId = await createRoutine();

        const detail = await routines.addExercise({
            userId,
            workspaceId,
            routineId,
            exerciseId: benchId,
            targetSets: 3,
            targetWeightKg: 62.5,
        });

        expect(detail.exercises[0]?.targetWeightKg).toBe(62.5);
    });

    it('allows the same exercise twice', async () => {
        const routineId = await createRoutine();

        await routines.addExercise({ userId, workspaceId, routineId, exerciseId: benchId, targetSets: 3 });
        const detail = await routines.addExercise({
            userId,
            workspaceId,
            routineId,
            exerciseId: benchId,
            targetSets: 1,
        });

        expect(detail.exercises.map((slot) => slot.exercise.id)).toEqual([benchId, benchId]);
    });

    it('accepts a catalog exercise', async () => {
        const routineId = await createRoutine();
        const catalogId = await seedCatalogExercise(db, {
            slug: `catalog-${randomUUID()}`,
            name: 'Catalog Squat',
            equipment: [Equipment.SquatRack, Equipment.Barbell],
        });

        const detail = await routines.addExercise({
            userId,
            workspaceId,
            routineId,
            exerciseId: catalogId,
            targetSets: 5,
        });

        expect(detail.exercises[0]?.exercise).toMatchObject({
            id: catalogId,
            name: 'Catalog Squat',
            isCatalog: true,
            equipment: [Equipment.SquatRack, Equipment.Barbell],
        });
    });

    it('rejects targets that do not fit the tracking type', async () => {
        const routineId = await createRoutine();

        await expect(
            routines.addExercise({ userId, workspaceId, routineId, exerciseId: runId, targetSets: 1, targetReps: 10 }),
        ).rejects.toBeInstanceOf(SetShapeMismatchError);
        await expect(
            routines.addExercise({
                userId,
                workspaceId,
                routineId,
                exerciseId: benchId,
                targetSets: 1,
                targetDistanceM: 5,
            }),
        ).rejects.toBeInstanceOf(SetShapeMismatchError);
    });

    it('answers 404 for an archived exercise, an unknown one, and one in another workspace', async () => {
        const routineId = await createRoutine();
        const retired = await exercises.create({
            userId,
            workspaceId,
            name: 'Retired',
            trackingType: TrackingType.WeightReps,
        });
        await exercises.update({ userId, workspaceId, exerciseId: retired.id, archived: true });
        const theirs = await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'theirs',
            trackingType: TrackingType.WeightReps,
        });

        for (const exerciseId of [retired.id, randomUUID(), theirs.id]) {
            await expect(
                routines.addExercise({ userId, workspaceId, routineId, exerciseId, targetSets: 3 }),
            ).rejects.toBeInstanceOf(EntityNotFoundError);
        }
    });

    it("refuses another workspace's routine, and leaves it empty", async () => {
        const theirs = await routines.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });

        await expect(
            routines.addExercise({ userId, workspaceId, routineId: theirs.id, exerciseId: benchId, targetSets: 3 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        const detail = await routines.get({ userId: outsiderId, workspaceId: otherWorkspaceId, routineId: theirs.id });
        expect(detail.exercises).toEqual([]);
    });

    it('keeps a slot whose exercise is archived later, flagged', async () => {
        const routineId = await createRoutine();
        const later = await exercises.create({
            userId,
            workspaceId,
            name: 'Later',
            trackingType: TrackingType.Duration,
        });
        await routines.addExercise({ userId, workspaceId, routineId, exerciseId: later.id, targetSets: 1 });

        await exercises.update({ userId, workspaceId, exerciseId: later.id, archived: true });

        const detail = await routines.get({ userId, workspaceId, routineId });
        expect(detail.exercises[0]?.exercise.archivedAt).not.toBeNull();
    });
});

describe('updateExercise', () => {
    it('writes only the fields given and re-checks the shape against the stored exercise', async () => {
        const routineId = await createRoutine();
        const { exercises: slots } = await routines.addExercise({
            userId,
            workspaceId,
            routineId,
            exerciseId: benchId,
            targetSets: 3,
            targetReps: 8,
        });
        const routineExerciseId = slots[0]?.id as string;

        const updated = await routines.updateExercise({
            userId,
            workspaceId,
            routineId,
            routineExerciseId,
            targetWeightKg: 60,
        });
        expect(updated.exercises[0]).toMatchObject({ targetSets: 3, targetReps: 8, targetWeightKg: 60 });

        await expect(
            routines.updateExercise({ userId, workspaceId, routineId, routineExerciseId, targetDurationSeconds: 30 }),
        ).rejects.toBeInstanceOf(SetShapeMismatchError);
    });

    it('clears a target with an explicit null', async () => {
        const routineId = await createRoutine();
        const { exercises: slots } = await routines.addExercise({
            userId,
            workspaceId,
            routineId,
            exerciseId: benchId,
            targetSets: 3,
            targetReps: 8,
        });

        const updated = await routines.updateExercise({
            userId,
            workspaceId,
            routineId,
            routineExerciseId: slots[0]?.id as string,
            targetReps: null,
        });

        expect(updated.exercises[0]?.targetReps).toBeNull();
    });

    it("refuses a slot id from another workspace's routine", async () => {
        const theirs = await routines.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });
        const theirExercise = await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'theirs',
            trackingType: TrackingType.WeightReps,
        });
        const { exercises: slots } = await routines.addExercise({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            routineId: theirs.id,
            exerciseId: theirExercise.id,
            targetSets: 3,
        });
        const mine = await createRoutine();

        await expect(
            routines.updateExercise({
                userId,
                workspaceId,
                routineId: mine,
                routineExerciseId: slots[0]?.id as string,
                targetSets: 99,
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            routines.removeExercise({
                userId,
                workspaceId,
                routineId: mine,
                routineExerciseId: slots[0]?.id as string,
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        const theirsAfter = await routines.get({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            routineId: theirs.id,
        });
        expect(theirsAfter.exercises[0]?.targetSets).toBe(3);
    });
});

describe('removeExercise', () => {
    it('removes the slot and renumbers the rest densely', async () => {
        const routineId = await createRoutine();
        for (const exerciseId of [benchId, plankId, runId]) {
            await routines.addExercise({ userId, workspaceId, routineId, exerciseId, targetSets: 1 });
        }
        const before = await routines.get({ userId, workspaceId, routineId });

        const after = await routines.removeExercise({
            userId,
            workspaceId,
            routineId,
            routineExerciseId: before.exercises[1]?.id as string,
        });

        expect(after.exercises.map((slot) => [slot.position, slot.exercise.name])).toEqual([
            [0, 'Bench'],
            [1, 'Run'],
        ]);
        expect(after.exerciseCount).toBe(2);
    });

    it('throws EntityNotFoundError for an unknown slot', async () => {
        const routineId = await createRoutine();

        await expect(
            routines.removeExercise({ userId, workspaceId, routineId, routineExerciseId: randomUUID() }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('replaceExercises', () => {
    it('replaces the whole list in the given order', async () => {
        const routineId = await createRoutine();
        await routines.addExercise({ userId, workspaceId, routineId, exerciseId: benchId, targetSets: 3 });

        const detail = await routines.replaceExercises({
            userId,
            workspaceId,
            routineId,
            exercises: [
                { exerciseId: runId, targetSets: 1, targetDistanceM: 5000 },
                { exerciseId: plankId, targetSets: 2, targetDurationSeconds: 45 },
                { exerciseId: benchId, targetSets: 4, targetReps: 6, targetWeightKg: 80 },
            ],
        });

        expect(detail.exercises.map((slot) => [slot.position, slot.exercise.name])).toEqual([
            [0, 'Run'],
            [1, 'Plank'],
            [2, 'Bench'],
        ]);
        expect(detail.exercises[2]).toMatchObject({ targetSets: 4, targetReps: 6, targetWeightKg: 80 });
    });

    it('clears the list when given none', async () => {
        const routineId = await createRoutine();
        await routines.addExercise({ userId, workspaceId, routineId, exerciseId: benchId, targetSets: 3 });

        const detail = await routines.replaceExercises({ userId, workspaceId, routineId, exercises: [] });

        expect(detail.exercises).toEqual([]);
    });

    // The whole replacement is one transaction: a bad slot anywhere in the list leaves the old
    // list untouched rather than a half-written one.
    it('leaves the old list in place when any slot is invalid', async () => {
        const routineId = await createRoutine();
        await routines.addExercise({ userId, workspaceId, routineId, exerciseId: benchId, targetSets: 3 });

        await expect(
            routines.replaceExercises({
                userId,
                workspaceId,
                routineId,
                exercises: [
                    { exerciseId: plankId, targetSets: 1 },
                    { exerciseId: runId, targetSets: 1, targetReps: 5 },
                ],
            }),
        ).rejects.toBeInstanceOf(SetShapeMismatchError);
        await expect(
            routines.replaceExercises({
                userId,
                workspaceId,
                routineId,
                exercises: [{ exerciseId: randomUUID(), targetSets: 1 }],
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        const detail = await routines.get({ userId, workspaceId, routineId });
        expect(detail.exercises.map((slot) => slot.exercise.id)).toEqual([benchId]);
    });

    it("refuses another workspace's routine", async () => {
        const theirs = await routines.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });

        await expect(
            routines.replaceExercises({ userId, workspaceId, routineId: theirs.id, exercises: [] }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    // A slot's exercise can be archived after it was added (e.g. `seed-exercises`' `archiveMissing`
    // dropping a catalog exercise); the routine must still be reorderable, but a NEW archived id
    // is still refused.
    it('keeps a slot whose exercise was archived after it was added, but still rejects a new archived id', async () => {
        const routineId = await createRoutine();
        const kept = await exercises.create({
            userId,
            workspaceId,
            name: 'Kept',
            trackingType: TrackingType.Duration,
        });
        await routines.addExercise({ userId, workspaceId, routineId, exerciseId: kept.id, targetSets: 1 });
        await exercises.update({ userId, workspaceId, exerciseId: kept.id, archived: true });

        const detail = await routines.replaceExercises({
            userId,
            workspaceId,
            routineId,
            exercises: [{ exerciseId: kept.id, targetSets: 2 }],
        });
        expect(detail.exercises[0]?.exercise.archivedAt).not.toBeNull();

        const other = await exercises.create({
            userId,
            workspaceId,
            name: 'Other',
            trackingType: TrackingType.Duration,
        });
        await exercises.update({ userId, workspaceId, exerciseId: other.id, archived: true });

        await expect(
            routines.replaceExercises({
                userId,
                workspaceId,
                routineId,
                exercises: [
                    { exerciseId: kept.id, targetSets: 2 },
                    { exerciseId: other.id, targetSets: 1 },
                ],
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('estimated duration', () => {
    it('matches the shared estimator on both the detail and the list', async () => {
        const routineId = await createRoutine(`Estimated ${randomUUID()}`);
        const detail = await routines.addExercise({
            userId,
            workspaceId,
            routineId,
            exerciseId: benchId,
            targetSets: 3,
            targetReps: 8,
            restSeconds: 120,
        });
        const expected = estimateRoutineSeconds([
            {
                trackingType: TrackingType.WeightReps,
                targetSets: 3,
                targetReps: 8,
                targetDurationSeconds: null,
                restSeconds: 120,
            },
        ]);

        expect(expected).toBeGreaterThan(0);
        expect(detail.estimatedDurationSeconds).toBe(expected);

        const listed = await routines.list({ userId, workspaceId, ...page });
        expect(listed.data.find((row) => row.id === routineId)?.estimatedDurationSeconds).toBe(expected);
    });

    it('is zero for a routine with no exercises', async () => {
        const routineId = await createRoutine(`Empty ${randomUUID()}`);

        expect((await routines.get({ userId, workspaceId, routineId })).estimatedDurationSeconds).toBe(0);
    });

    it("never counts another workspace's routine", async () => {
        const mine = await createRoutine(`Mine ${randomUUID()}`);
        await routines.addExercise({
            userId,
            workspaceId,
            routineId: mine,
            exerciseId: benchId,
            targetSets: 3,
            targetReps: 8,
        });

        await expect(
            routines.get({ userId: outsiderId, workspaceId: otherWorkspaceId, routineId: mine }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('last completed', () => {
    async function seedSession({
        sessionWorkspaceId,
        routineId,
        completedAt,
    }: {
        sessionWorkspaceId: string;
        routineId: string;
        completedAt: string | null;
    }): Promise<void> {
        await db.insert(schema.workoutSessions).values({
            workspaceId: sessionWorkspaceId,
            routineId,
            name: 'Session',
            startedAt: completedAt ?? '2026-01-01T00:00:00.000Z',
            completedAt,
        });
    }

    it('is null for a routine never done', async () => {
        const routineId = await createRoutine(`Never done ${randomUUID()}`);

        expect((await routines.get({ userId, workspaceId, routineId })).lastCompletedAt).toBeNull();

        const listed = await routines.list({ userId, workspaceId, ...page });
        expect(listed.data.find((row) => row.id === routineId)?.lastCompletedAt).toBeNull();
    });

    it('reports the most recent completion on both the detail and the list', async () => {
        const routineId = await createRoutine(`Done twice ${randomUUID()}`);
        await seedSession({ sessionWorkspaceId: workspaceId, routineId, completedAt: '2026-02-01T10:00:00.000Z' });
        await seedSession({ sessionWorkspaceId: workspaceId, routineId, completedAt: '2026-03-05T18:30:00.000Z' });

        const detail = await routines.get({ userId, workspaceId, routineId });
        expect(new Date(detail.lastCompletedAt ?? '').toISOString()).toBe('2026-03-05T18:30:00.000Z');

        const listed = await routines.list({ userId, workspaceId, ...page });
        const row = listed.data.find((entry) => entry.id === routineId);
        expect(new Date(row?.lastCompletedAt ?? '').toISOString()).toBe('2026-03-05T18:30:00.000Z');
    });

    it('ignores a session still in progress', async () => {
        const routineId = await createRoutine(`In progress ${randomUUID()}`);
        await seedSession({ sessionWorkspaceId: workspaceId, routineId, completedAt: null });

        expect((await routines.get({ userId, workspaceId, routineId })).lastCompletedAt).toBeNull();
    });

    it('never counts a session recorded in another workspace', async () => {
        const routineId = await createRoutine(`Cross tenant ${randomUUID()}`);
        await seedSession({
            sessionWorkspaceId: otherWorkspaceId,
            routineId,
            completedAt: '2026-04-01T12:00:00.000Z',
        });

        expect((await routines.get({ userId, workspaceId, routineId })).lastCompletedAt).toBeNull();
    });
});

describe('recommendations', () => {
    const DAY = 24 * 60 * 60 * 1000;

    type Fixture = { ownerId: string; ownWorkspaceId: string; exercise: (muscles: MuscleSpec) => Promise<string> };
    type MuscleSpec = { primary: MuscleGroup[]; secondary?: MuscleGroup[] };

    async function fixture(): Promise<Fixture> {
        const ownerId = await seedUser(db);
        const ownWorkspaceId = await seedWorkspace(db, ownerId);

        return {
            ownerId,
            ownWorkspaceId,
            exercise: async ({ primary, secondary = [] }) =>
                (
                    await exercises.create({
                        userId: ownerId,
                        workspaceId: ownWorkspaceId,
                        name: `Exercise ${randomUUID()}`,
                        trackingType: TrackingType.WeightReps,
                        primaryMuscles: primary,
                        secondaryMuscles: secondary,
                    })
                ).id,
        };
    }

    async function routineWith({
        f,
        name,
        exerciseIds,
    }: {
        f: Fixture;
        name: string;
        exerciseIds: string[];
    }): Promise<string> {
        const routine = await routines.create({ userId: f.ownerId, workspaceId: f.ownWorkspaceId, name });
        await routines.replaceExercises({
            userId: f.ownerId,
            workspaceId: f.ownWorkspaceId,
            routineId: routine.id,
            exercises: exerciseIds.map((exerciseId) => ({ exerciseId, targetSets: 3 })),
        });

        return routine.id;
    }

    /**
     * Records a completed workout in which `exerciseId` had one set logged, then recalculates as
     * completing it through `WorkoutSessionsService` would.
     */
    async function logWorkout({
        sessionWorkspaceId,
        routineId = null,
        exerciseId,
        daysAgo,
        isWarmup = false,
    }: {
        sessionWorkspaceId: string;
        routineId?: string | null;
        exerciseId: string;
        daysAgo: number;
        isWarmup?: boolean;
    }): Promise<void> {
        const completedAt = new Date(Date.now() - daysAgo * DAY).toISOString();
        const [session] = await db
            .insert(schema.workoutSessions)
            .values({
                workspaceId: sessionWorkspaceId,
                routineId,
                name: 'Session',
                startedAt: completedAt,
                completedAt,
            })
            .returning({ id: schema.workoutSessions.id });
        const [slot] = await db
            .insert(schema.sessionExercises)
            .values({
                workspaceId: sessionWorkspaceId,
                sessionId: session.id,
                exerciseId,
                trackingType: TrackingType.WeightReps,
                source: SessionExerciseSource.AddedAdHoc,
                position: 0,
                targetSets: 1,
            })
            .returning({ id: schema.sessionExercises.id });
        await db.insert(schema.setEntries).values({
            workspaceId: sessionWorkspaceId,
            sessionExerciseId: slot.id,
            setIndex: 1,
            isWarmup,
            weightKg: 50,
            reps: 5,
        });
        await new RoutineRecommendationsService({ db }).recalculate({ workspaceId: sessionWorkspaceId });
    }

    async function listRecommended(f: Fixture, paging = page): Promise<RoutineListItem[]> {
        return (
            await routines.list({
                userId: f.ownerId,
                workspaceId: f.ownWorkspaceId,
                ...paging,
                order: RoutineOrder.Recommended,
            })
        ).data;
    }

    it('ranks rested muscles first, then how often a routine is done', async () => {
        const f = await fixture();
        const bench = await f.exercise({ primary: [MuscleGroup.Chest], secondary: [MuscleGroup.Triceps] });
        const row = await f.exercise({ primary: [MuscleGroup.Lats] });
        const squat = await f.exercise({ primary: [MuscleGroup.Quads] });
        const push = await routineWith({ f, name: 'Push', exerciseIds: [bench] });
        const pull = await routineWith({ f, name: 'Pull', exerciseIds: [row] });
        const legs = await routineWith({ f, name: 'Legs', exerciseIds: [squat] });
        await logWorkout({ sessionWorkspaceId: f.ownWorkspaceId, routineId: push, exerciseId: bench, daysAgo: 0 });
        await logWorkout({ sessionWorkspaceId: f.ownWorkspaceId, routineId: pull, exerciseId: row, daysAgo: 3.5 });

        const listed = await listRecommended(f);

        // Legs: never trained, never done. Pull: half rested, done. Push: just trained, done.
        expect(listed.map((routine) => [routine.id, routine.recommendationScore])).toEqual([
            [legs, 70],
            [pull, 65],
            [push, 42],
        ]);
    });

    it('scores the same routines on the name-ordered list', async () => {
        const f = await fixture();
        const squat = await f.exercise({ primary: [MuscleGroup.Quads] });
        await routineWith({ f, name: 'B legs', exerciseIds: [squat] });
        await routineWith({ f, name: 'A empty', exerciseIds: [] });

        const listed = await routines.list({ userId: f.ownerId, workspaceId: f.ownWorkspaceId, ...page });

        expect(listed.data.map((routine) => [routine.name, routine.recommendationScore])).toEqual([
            ['A empty', null],
            ['B legs', 70],
        ]);
    });

    it('does not score an excluded or empty routine, and lists them last by name', async () => {
        const f = await fixture();
        const squat = await f.exercise({ primary: [MuscleGroup.Quads] });
        const curl = await f.exercise({ primary: [MuscleGroup.Biceps] });
        await logWorkout({ sessionWorkspaceId: f.ownWorkspaceId, exerciseId: squat, daysAgo: 0 });
        const excluded = await routineWith({ f, name: 'Arms', exerciseIds: [curl] });
        const empty = await routineWith({ f, name: 'Blank', exerciseIds: [] });
        const legs = await routineWith({ f, name: 'Legs', exerciseIds: [squat] });

        const updated = await routines.update({
            userId: f.ownerId,
            workspaceId: f.ownWorkspaceId,
            routineId: excluded,
            excludedFromRecommendations: true,
        });
        expect(updated.excludedFromRecommendations).toBe(true);

        const listed = await listRecommended(f);

        expect(listed.map((routine) => [routine.id, routine.recommendationScore])).toEqual([
            [legs, 0],
            [excluded, null],
            [empty, null],
        ]);
    });

    it('pages through the recommended order', async () => {
        const f = await fixture();
        const bench = await f.exercise({ primary: [MuscleGroup.Chest] });
        const squat = await f.exercise({ primary: [MuscleGroup.Quads] });
        await logWorkout({ sessionWorkspaceId: f.ownWorkspaceId, exerciseId: bench, daysAgo: 0 });
        const push = await routineWith({ f, name: 'A push', exerciseIds: [bench] });
        const legs = await routineWith({ f, name: 'B legs', exerciseIds: [squat] });

        expect((await listRecommended(f, { page: 1, pageSize: 1 })).map((routine) => routine.id)).toEqual([legs]);
        expect((await listRecommended(f, { page: 2, pageSize: 1 })).map((routine) => routine.id)).toEqual([push]);
    });

    it('does not count warm-up sets as training a muscle', async () => {
        const f = await fixture();
        const squat = await f.exercise({ primary: [MuscleGroup.Quads] });
        await logWorkout({ sessionWorkspaceId: f.ownWorkspaceId, exerciseId: squat, daysAgo: 0, isWarmup: true });
        const legs = await routineWith({ f, name: 'Legs', exerciseIds: [squat] });

        expect((await listRecommended(f)).find((routine) => routine.id === legs)?.recommendationScore).toBe(70);
    });

    it("never reads another workspace's history", async () => {
        const f = await fixture();
        const other = await fixture();
        const squat = await f.exercise({ primary: [MuscleGroup.Quads] });
        const theirSquat = await other.exercise({ primary: [MuscleGroup.Quads] });
        const legs = await routineWith({ f, name: 'Legs', exerciseIds: [squat] });
        const theirLegs = await routineWith({ f: other, name: 'Legs', exerciseIds: [theirSquat] });
        await logWorkout({
            sessionWorkspaceId: other.ownWorkspaceId,
            routineId: theirLegs,
            exerciseId: theirSquat,
            daysAgo: 0,
        });

        const listed = await listRecommended(f);

        expect(listed.map((routine) => [routine.id, routine.recommendationScore])).toEqual([[legs, 70]]);
    });

    it('recalculates when a workout is completed through the sessions service', async () => {
        const f = await fixture();
        const sessions = new WorkoutSessionsService({
            db,
            membership: new WorkspaceMembershipService({ db }),
            recommendations: new RoutineRecommendationsService({ db }),
        });
        const squat = await f.exercise({ primary: [MuscleGroup.Quads] });
        const legs = await routineWith({ f, name: 'Legs', exerciseIds: [squat] });
        expect((await listRecommended(f))[0]?.recommendationScore).toBe(70);

        const started = await sessions.start({ userId: f.ownerId, workspaceId: f.ownWorkspaceId, routineId: legs });
        await sessions.logSet({
            userId: f.ownerId,
            workspaceId: f.ownWorkspaceId,
            sessionId: started.id,
            sessionExerciseId: started.exercises[0]?.id as string,
            weightKg: 100,
            reps: 5,
        });
        await sessions.complete({ userId: f.ownerId, workspaceId: f.ownWorkspaceId, sessionId: started.id });

        // Quads just trained, and the only routine done is the most done: 0 rest + 30 frequency.
        expect((await listRecommended(f))[0]?.recommendationScore).toBe(30);
    });

    it('reads the stored score, and recalculates on read once it is a day old', async () => {
        const f = await fixture();
        const squat = await f.exercise({ primary: [MuscleGroup.Quads] });
        const legs = await routineWith({ f, name: 'Legs', exerciseIds: [squat] });
        const setStored = async (scoredAt: Date): Promise<void> => {
            await db
                .update(schema.routines)
                .set({ recommendationScore: 12, recommendationScoredAt: scoredAt.toISOString() })
                .where(eq(schema.routines.id, legs));
        };

        await setStored(new Date());
        expect((await listRecommended(f))[0]?.recommendationScore).toBe(12);

        await setStored(new Date(Date.now() - 25 * 60 * 60 * 1000));
        expect((await listRecommended(f))[0]?.recommendationScore).toBe(70);
    });

    it("refuses to change another workspace's routine", async () => {
        const f = await fixture();
        const other = await fixture();
        const theirs = await routineWith({ f: other, name: 'Theirs', exerciseIds: [] });

        await expect(
            routines.update({
                userId: f.ownerId,
                workspaceId: f.ownWorkspaceId,
                routineId: theirs,
                excludedFromRecommendations: true,
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});
