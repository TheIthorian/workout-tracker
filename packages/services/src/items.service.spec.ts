import { randomUUID } from 'node:crypto';
import type { Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ItemsService } from './items.service.js';
import { seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let items: ItemsService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    items = new ItemsService({ db, membership: new WorkspaceMembershipService({ db }) });

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
    it('returns the stored item', async () => {
        const created = await items.create({ userId, workspaceId, name: 'Widget', description: 'A widget' });

        expect(created).toMatchObject({ name: 'Widget', description: 'A widget' });
    });

    it('defaults description to null', async () => {
        expect((await items.create({ userId, workspaceId, name: 'Bare' })).description).toBeNull();
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(items.create({ userId, workspaceId: otherWorkspaceId, name: 'Trespass' })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});

describe('list', () => {
    it("returns only this workspace's items, newest first", async () => {
        const ownerId = await seedUser(db);
        const scopedWorkspaceId = await seedWorkspace(db, ownerId);
        await items.create({ userId: ownerId, workspaceId: scopedWorkspaceId, name: 'first' });
        await items.create({ userId: ownerId, workspaceId: scopedWorkspaceId, name: 'second' });
        await items.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });

        const result = await items.list({ userId: ownerId, workspaceId: scopedWorkspaceId, ...page });

        expect(result.data.map((item) => item.name)).toEqual(['second', 'first']);
        expect(result.totalCount).toBe(2);
    });

    it('paginates', async () => {
        const ownerId = await seedUser(db);
        const paginatedWorkspaceId = await seedWorkspace(db, ownerId);
        for (const name of ['a', 'b', 'c']) {
            await items.create({ userId: ownerId, workspaceId: paginatedWorkspaceId, name });
        }

        const result = await items.list({ userId: ownerId, workspaceId: paginatedWorkspaceId, page: 2, pageSize: 2 });

        expect(result.data).toHaveLength(1);
        expect(result).toMatchObject({ page: 2, pageSize: 2, totalCount: 3, totalPages: 2 });
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(items.list({ userId, workspaceId: otherWorkspaceId, ...page })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});

describe('get', () => {
    it('throws EntityNotFoundError for an unknown item', async () => {
        await expect(items.get({ userId, workspaceId, itemId: randomUUID() })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });

    // The tenant filter, not just the membership check: the caller IS a member of `workspaceId`,
    // so only `scopedToWorkspace` stops them reading another workspace's row by id.
    it('refuses an item id from another workspace even though the caller is a member of this one', async () => {
        const { id } = await items.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });

        await expect(items.get({ userId, workspaceId, itemId: id })).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('update', () => {
    it('writes only the fields given', async () => {
        const { id } = await items.create({ userId, workspaceId, name: 'Original', description: 'Keep me' });

        const updated = await items.update({ userId, workspaceId, itemId: id, name: 'Renamed' });

        expect(updated).toMatchObject({ name: 'Renamed', description: 'Keep me' });
    });

    it('can clear the description', async () => {
        const { id } = await items.create({ userId, workspaceId, name: 'Original', description: 'Drop me' });

        expect((await items.update({ userId, workspaceId, itemId: id, description: null })).description).toBeNull();
    });

    it('refuses an item in another workspace, and leaves it untouched', async () => {
        const { id } = await items.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });

        await expect(items.update({ userId, workspaceId, itemId: id, name: 'hijacked' })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );

        expect((await items.get({ userId: outsiderId, workspaceId: otherWorkspaceId, itemId: id })).name).toBe(
            'theirs',
        );
    });
});

describe('remove', () => {
    it('deletes the item', async () => {
        const { id } = await items.create({ userId, workspaceId, name: 'Doomed' });

        await items.remove({ userId, workspaceId, itemId: id });

        await expect(items.get({ userId, workspaceId, itemId: id })).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses an item in another workspace, and leaves it in place', async () => {
        const { id } = await items.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'theirs' });

        await expect(items.remove({ userId, workspaceId, itemId: id })).rejects.toBeInstanceOf(EntityNotFoundError);

        expect(await items.get({ userId: outsiderId, workspaceId: otherWorkspaceId, itemId: id })).toBeDefined();
    });
});
