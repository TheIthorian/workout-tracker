import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { Equipment, TrackingType } from '@app/domain';
import { EntityNotFoundError, SetShapeMismatchError } from '@app/errors';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExercisesService } from './exercises.service.js';
import { RoutinesService } from './routines.service.js';
import { seedCatalogExercise, seedUser, seedWorkspace } from './testing.js';
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
    routines = new RoutinesService({ db, membership });
    exercises = new ExercisesService({ db, membership });

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
