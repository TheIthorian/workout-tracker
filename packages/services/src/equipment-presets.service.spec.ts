import { type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { Equipment } from '@app/domain';
import { ConflictError, EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EquipmentPresetsService } from './equipment-presets.service.js';
import { seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let presets: EquipmentPresetsService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    presets = new EquipmentPresetsService({ db, membership: new WorkspaceMembershipService({ db }) });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
});

afterAll(async () => {
    await database?.stop();
});

describe('create and list', () => {
    it('stores a preset and lists by name', async () => {
        await presets.create({
            userId,
            workspaceId,
            name: 'Gym',
            equipment: [Equipment.Barbell, Equipment.Cable],
        });
        await presets.create({ userId, workspaceId, name: 'Home', equipment: [Equipment.Dumbbell] });

        const listed = await presets.list({ userId, workspaceId });

        expect(listed.map((preset) => preset.name)).toEqual(['Gym', 'Home']);
        expect(listed[0]?.equipment).toEqual([Equipment.Barbell, Equipment.Cable]);
    });

    it('rejects a duplicate name in the same workspace', async () => {
        await expect(presets.create({ userId, workspaceId, name: 'Gym', equipment: [] })).rejects.toBeInstanceOf(
            ConflictError,
        );
    });

    it('allows the same name in another workspace', async () => {
        await expect(
            presets.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'Gym', equipment: [] }),
        ).resolves.toMatchObject({ name: 'Gym' });
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(presets.list({ userId, workspaceId: otherWorkspaceId })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(
            presets.create({ userId, workspaceId: otherWorkspaceId, name: 'Sneaky', equipment: [] }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('update and remove', () => {
    it('updates only the fields given', async () => {
        const created = await presets.create({
            userId,
            workspaceId,
            name: 'Travel',
            equipment: [Equipment.ResistanceBand],
        });

        const renamed = await presets.update({ userId, workspaceId, presetId: created.id, name: 'Hotel' });
        expect(renamed).toMatchObject({ name: 'Hotel', equipment: [Equipment.ResistanceBand] });

        const retooled = await presets.update({ userId, workspaceId, presetId: created.id, equipment: [] });
        expect(retooled).toMatchObject({ name: 'Hotel', equipment: [] });
        expect(retooled.updatedAt >= created.updatedAt).toBe(true);
    });

    it('rejects renaming onto an existing name', async () => {
        const created = await presets.create({ userId, workspaceId, name: 'Park', equipment: [] });

        await expect(
            presets.update({ userId, workspaceId, presetId: created.id, name: 'Home' }),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    it("answers 404 for another workspace's preset on update and remove", async () => {
        const theirs = await presets.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'Theirs',
            equipment: [],
        });

        await expect(presets.update({ userId, workspaceId, presetId: theirs.id, name: 'Mine' })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(presets.remove({ userId, workspaceId, presetId: theirs.id })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );

        const stillThere = await presets.list({ userId: outsiderId, workspaceId: otherWorkspaceId });
        expect(stillThere.some((preset) => preset.id === theirs.id)).toBe(true);
    });

    it('removes a preset', async () => {
        const created = await presets.create({ userId, workspaceId, name: 'Temp', equipment: [] });

        await presets.remove({ userId, workspaceId, presetId: created.id });

        const listed = await presets.list({ userId, workspaceId });
        expect(listed.some((preset) => preset.id === created.id)).toBe(false);
    });
});
