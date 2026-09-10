import { randomUUID } from 'node:crypto';
import type { Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExercisesService } from './exercises.service.js';
import { seedUser, seedWorkspace } from './testing.js';
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
    exercises = new ExercisesService({ db, membership: new WorkspaceMembershipService({ db }) });

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
    it("returns only this workspace's exercises, newest first", async () => {
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

        expect(result.data.map((exercise) => exercise.name)).toEqual(['second', 'first']);
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
