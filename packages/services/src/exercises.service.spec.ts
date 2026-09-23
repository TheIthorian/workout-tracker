import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { Equipment, MuscleGroup, TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExercisesService } from './exercises.service.js';
import { seedCatalogExercise, seedUser, seedWorkspace } from './testing.js';
import { RoutineRecommendationsService } from './routine-recommendations.service.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let exercises: ExercisesService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    exercises = new ExercisesService({
        db,
        membership: new WorkspaceMembershipService({ db }),
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

const page = { page: 1, pageSize: 20 };

describe('create', () => {
    it('returns the stored exercise with its guide fields', async () => {
        const created = await exercises.create({
            userId,
            workspaceId,
            name: 'Bench Press',
            trackingType: TrackingType.WeightReps,
            guideCues: 'Ribs down, feet planted.',
        });

        expect(created).toMatchObject({
            name: 'Bench Press',
            trackingType: TrackingType.WeightReps,
            guideCues: 'Ribs down, feet planted.',
        });
        expect(created.images).toEqual([]);
        expect(created.links).toEqual([]);
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(
            exercises.create({
                userId,
                workspaceId: otherWorkspaceId,
                name: 'Trespass',
                trackingType: TrackingType.Duration,
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('list', () => {
    it("returns this workspace's exercises by name", async () => {
        const ownerId = await seedUser(db);
        const scopedWorkspaceId = await seedWorkspace(db, ownerId);
        await exercises.create({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            name: 'first',
            trackingType: TrackingType.WeightReps,
        });
        await exercises.create({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            name: 'second',
            trackingType: TrackingType.Duration,
        });
        await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'theirs',
            trackingType: TrackingType.WeightReps,
        });

        const result = await exercises.list({ userId: ownerId, workspaceId: scopedWorkspaceId, ...page });

        expect(result.data.map((exercise) => exercise.name)).toEqual(['first', 'second']);
        expect(result.totalCount).toBe(2);
    });

    it('filters by a case-insensitive name search', async () => {
        const ownerId = await seedUser(db);
        const searchWorkspaceId = await seedWorkspace(db, ownerId);
        for (const name of ['Barbell Row', 'Bench Press', 'Plank']) {
            await exercises.create({
                userId: ownerId,
                workspaceId: searchWorkspaceId,
                name,
                trackingType: TrackingType.WeightReps,
            });
        }

        const result = await exercises.list({
            userId: ownerId,
            workspaceId: searchWorkspaceId,
            ...page,
            search: 'ben',
        });

        expect(result.data.map((exercise) => exercise.name)).toEqual(['Bench Press']);
    });

    it('hides archived exercises unless asked for them', async () => {
        const ownerId = await seedUser(db);
        const archiveWorkspaceId = await seedWorkspace(db, ownerId);
        const { id } = await exercises.create({
            userId: ownerId,
            workspaceId: archiveWorkspaceId,
            name: 'Retired',
            trackingType: TrackingType.WeightReps,
        });
        await exercises.update({ userId: ownerId, workspaceId: archiveWorkspaceId, exerciseId: id, archived: true });

        const visible = await exercises.list({ userId: ownerId, workspaceId: archiveWorkspaceId, ...page });
        const all = await exercises.list({
            userId: ownerId,
            workspaceId: archiveWorkspaceId,
            ...page,
            includeArchived: true,
        });

        expect(visible.data).toHaveLength(0);
        expect(all.data).toHaveLength(1);
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(exercises.list({ userId, workspaceId: otherWorkspaceId, ...page })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});

describe('get', () => {
    it('throws EntityNotFoundError for an unknown exercise', async () => {
        await expect(exercises.get({ userId, workspaceId, exerciseId: randomUUID() })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });

    // The tenant filter, not just the membership check: the caller IS a member of `workspaceId`,
    // so only `scopedToWorkspace` stops them reading another workspace's row by id.
    it('refuses an exercise id from another workspace even though the caller is a member of this one', async () => {
        const { id } = await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'theirs',
            trackingType: TrackingType.WeightReps,
        });

        await expect(exercises.get({ userId, workspaceId, exerciseId: id })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});

describe('update', () => {
    it('writes only the fields given', async () => {
        const { id } = await exercises.create({
            userId,
            workspaceId,
            name: 'Original',
            trackingType: TrackingType.WeightReps,
            guideSetup: 'Keep me',
        });

        const updated = await exercises.update({ userId, workspaceId, exerciseId: id, name: 'Renamed' });

        expect(updated).toMatchObject({ name: 'Renamed', guideSetup: 'Keep me' });
    });

    // The web editor's real path: an emptied textarea sends `guideSetup: null` (`setup.trim() ||
    // null`), which must clear the column rather than being treated as "field not given".
    it('clears a guide field when it is explicitly set to null', async () => {
        const { id } = await exercises.create({
            userId,
            workspaceId,
            name: 'Clearable',
            trackingType: TrackingType.WeightReps,
            guideSetup: 'Bar at chest height.',
        });

        const updated = await exercises.update({ userId, workspaceId, exerciseId: id, guideSetup: null });

        expect(updated.guideSetup).toBeNull();
    });

    it('archives and unarchives', async () => {
        const { id } = await exercises.create({
            userId,
            workspaceId,
            name: 'Archivable',
            trackingType: TrackingType.Duration,
        });

        expect(
            (await exercises.update({ userId, workspaceId, exerciseId: id, archived: true })).archivedAt,
        ).not.toBeNull();
        expect(
            (await exercises.update({ userId, workspaceId, exerciseId: id, archived: false })).archivedAt,
        ).toBeNull();
    });

    it('refuses an exercise in another workspace, and leaves it untouched', async () => {
        const { id } = await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'theirs',
            trackingType: TrackingType.WeightReps,
        });

        await expect(
            exercises.update({ userId, workspaceId, exerciseId: id, name: 'hijacked' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        expect((await exercises.get({ userId: outsiderId, workspaceId: otherWorkspaceId, exerciseId: id })).name).toBe(
            'theirs',
        );
    });
});

describe('catalog exercises', () => {
    it('lists and reads a catalog exercise from any workspace, marked as catalog', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}`, name: 'Catalog Squat' });

        const listed = await exercises.list({ userId, workspaceId, ...page });
        expect(listed.data.find((row) => row.id === catalogId)).toMatchObject({
            name: 'Catalog Squat',
            isCatalog: true,
        });

        const detail = await exercises.get({ userId, workspaceId, exerciseId: catalogId });
        expect(detail).toMatchObject({ id: catalogId, isCatalog: true, images: [], links: [] });
        expect(detail.slug).toMatch(/^catalog-/);
    });

    it('marks a custom exercise as not catalog', async () => {
        const custom = await exercises.create({
            userId,
            workspaceId,
            name: 'My Machine',
            trackingType: TrackingType.WeightReps,
        });

        expect(custom).toMatchObject({ isCatalog: false, slug: null });
    });

    it('refuses to update or archive a catalog exercise through a workspace, and leaves it unchanged', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}`, name: 'Untouchable' });

        await expect(
            exercises.update({ userId, workspaceId, exerciseId: catalogId, name: 'Vandalised' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            exercises.update({ userId, workspaceId, exerciseId: catalogId, archived: true }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        const [row] = await db
            .select({ name: schema.exercises.name, archivedAt: schema.exercises.archivedAt })
            .from(schema.exercises)
            .where(eq(schema.exercises.id, catalogId));
        expect(row).toEqual({ name: 'Untouchable', archivedAt: null });
    });

    it('still refuses a workspace the caller does not belong to, even for a catalog id', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });

        await expect(
            exercises.get({ userId, workspaceId: otherWorkspaceId, exerciseId: catalogId }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('equipment', () => {
    it('stores equipment on create and update', async () => {
        const created = await exercises.create({
            userId,
            workspaceId,
            name: 'Front squat',
            trackingType: TrackingType.WeightReps,
            equipment: [Equipment.Barbell, Equipment.SquatRack],
        });
        expect(created.equipment).toEqual([Equipment.Barbell, Equipment.SquatRack]);

        const updated = await exercises.update({ userId, workspaceId, exerciseId: created.id, equipment: [] });
        expect(updated.equipment).toEqual([]);
    });

    it('defaults to bodyweight', async () => {
        const created = await exercises.create({
            userId,
            workspaceId,
            name: 'Burpee',
            trackingType: TrackingType.WeightReps,
        });
        expect(created.equipment).toEqual([]);
    });

    describe('list filter', () => {
        const prefix = `filter-${randomUUID().slice(0, 8)}`;

        beforeAll(async () => {
            await seedCatalogExercise(db, { slug: `${prefix}-bw`, name: `${prefix} bodyweight`, equipment: [] });
            await seedCatalogExercise(db, {
                slug: `${prefix}-db`,
                name: `${prefix} dumbbell`,
                equipment: [Equipment.Dumbbell],
            });
            await seedCatalogExercise(db, {
                slug: `${prefix}-bb`,
                name: `${prefix} barbell bench`,
                equipment: [Equipment.Barbell, Equipment.Bench],
            });
        });

        const names = async (equipment?: Equipment[]): Promise<string[]> =>
            (await exercises.list({ userId, workspaceId, ...page, search: prefix, equipment })).data
                .map((e) => e.name)
                .sort();

        it('applies no filter when equipment is absent', async () => {
            expect(await names()).toEqual([`${prefix} barbell bench`, `${prefix} bodyweight`, `${prefix} dumbbell`]);
        });

        it('keeps only exercises whose equipment is a subset', async () => {
            expect(await names([Equipment.Dumbbell])).toEqual([`${prefix} bodyweight`, `${prefix} dumbbell`]);
            expect(await names([Equipment.Barbell])).toEqual([`${prefix} bodyweight`]);
            expect(await names([Equipment.Barbell, Equipment.Bench, Equipment.Dumbbell])).toEqual([
                `${prefix} barbell bench`,
                `${prefix} bodyweight`,
                `${prefix} dumbbell`,
            ]);
        });

        it('returns bodyweight only for an empty list', async () => {
            expect(await names([])).toEqual([`${prefix} bodyweight`]);
        });

        it('counts only the filtered rows', async () => {
            const result = await exercises.list({
                userId,
                workspaceId,
                ...page,
                search: prefix,
                equipment: [Equipment.Dumbbell],
            });
            expect(result.totalCount).toBe(2);
        });
    });
});

describe('setPreferences', () => {
    it('stores a rest time for a catalog exercise and reads it back on the list and the detail', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}`, name: 'Rested Row' });

        const updated = await exercises.setPreferences({
            userId,
            workspaceId,
            exerciseId: catalogId,
            restSeconds: 120,
        });

        expect(updated).toMatchObject({ id: catalogId, isCatalog: true, restSeconds: 120 });
        const listed = await exercises.list({ userId, workspaceId, ...page, search: 'Rested Row' });
        expect(listed.data.map((exercise) => exercise.restSeconds)).toEqual([120]);
    });

    it('replaces an earlier setting rather than adding a second row', async () => {
        const custom = await exercises.create({
            userId,
            workspaceId,
            name: 'Twice Set',
            trackingType: TrackingType.WeightReps,
        });
        await exercises.setPreferences({ userId, workspaceId, exerciseId: custom.id, restSeconds: 60 });

        const updated = await exercises.setPreferences({ userId, workspaceId, exerciseId: custom.id, restSeconds: 0 });

        expect(updated.restSeconds).toBe(0);
        const rows = await db
            .select({ id: schema.exercisePreferences.id })
            .from(schema.exercisePreferences)
            .where(eq(schema.exercisePreferences.exerciseId, custom.id));
        expect(rows).toHaveLength(1);
    });

    it("keeps one workspace's setting invisible to another sharing the same catalog exercise", async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        await exercises.setPreferences({ userId, workspaceId, exerciseId: catalogId, restSeconds: 45 });

        const theirs = await exercises.get({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            exerciseId: catalogId,
        });

        expect(theirs.restSeconds).toBeNull();
    });

    it("refuses another workspace's custom exercise, and a workspace the caller does not belong to", async () => {
        const theirs = await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'Private',
            trackingType: TrackingType.WeightReps,
        });

        await expect(
            exercises.setPreferences({ userId, workspaceId, exerciseId: theirs.id, restSeconds: 30 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            exercises.setPreferences({ userId, workspaceId: otherWorkspaceId, exerciseId: theirs.id, restSeconds: 30 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('muscle tags', () => {
    it('stores what an exercise targets and replaces each list on update', async () => {
        const created = await exercises.create({
            userId,
            workspaceId,
            name: `Tagged ${randomUUID()}`,
            trackingType: TrackingType.WeightReps,
            primaryMuscles: [MuscleGroup.Chest],
            secondaryMuscles: [MuscleGroup.Triceps, MuscleGroup.FrontDelts],
        });

        expect(created.primaryMuscles).toEqual([MuscleGroup.Chest]);
        expect(created.secondaryMuscles).toEqual([MuscleGroup.Triceps, MuscleGroup.FrontDelts]);

        const updated = await exercises.update({
            userId,
            workspaceId,
            exerciseId: created.id,
            secondaryMuscles: [],
        });

        expect(updated.primaryMuscles).toEqual([MuscleGroup.Chest]);
        expect(updated.secondaryMuscles).toEqual([]);
    });

    it('defaults to no muscles rather than null', async () => {
        const created = await exercises.create({
            userId,
            workspaceId,
            name: `Untagged ${randomUUID()}`,
            trackingType: TrackingType.Duration,
        });

        expect(created.primaryMuscles).toEqual([]);
        expect(created.secondaryMuscles).toEqual([]);
    });

    it('filters the library by a muscle named either primary or secondary', async () => {
        const ownerId = await seedUser(db);
        const scopedWorkspaceId = await seedWorkspace(db, ownerId);
        await exercises.create({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            name: 'Curl',
            trackingType: TrackingType.WeightReps,
            primaryMuscles: [MuscleGroup.Biceps],
        });
        await exercises.create({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            name: 'Row',
            trackingType: TrackingType.WeightReps,
            primaryMuscles: [MuscleGroup.Lats],
            secondaryMuscles: [MuscleGroup.Biceps],
        });
        await exercises.create({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            name: 'Squat',
            trackingType: TrackingType.WeightReps,
            primaryMuscles: [MuscleGroup.Quads],
        });

        const matching = await exercises.list({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            ...page,
            muscle: MuscleGroup.Biceps,
        });

        expect(matching.data.map((exercise) => exercise.name)).toEqual(['Curl', 'Row']);
        expect(matching.totalCount).toBe(2);
    });
});
