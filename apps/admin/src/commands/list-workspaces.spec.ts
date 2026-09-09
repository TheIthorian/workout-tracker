import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { formatWorkspaceList, listWorkspaces } from './list-workspaces.js';

const { user, workspaceUsers, workspaces } = schema;

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
});

afterAll(async () => {
    await database?.stop();
});

afterEach(async () => {
    await db.delete(workspaceUsers);
    await db.delete(workspaces);
    await db.delete(user);
});

describe('listWorkspaces', () => {
    it('reports the member count and the owners', async () => {
        const ownerId = await insertUser('owner@example.com');
        const memberId = await insertUser('member@example.com');
        const workspaceId = await insertWorkspace('Acme');
        await db.insert(workspaceUsers).values([
            { workspaceId, userId: ownerId, role: 'owner' },
            { workspaceId, userId: memberId, role: 'member' },
        ]);

        expect(await listWorkspaces(db)).toEqual([
            { id: workspaceId, name: 'Acme', memberCount: 2, owners: ['owner@example.com'] },
        ]);
    });

    // The case the command exists to surface: nobody can rename, delete, or add members to this
    // workspace, and nothing else in the schema makes that visible.
    it('reports an ownerless workspace with an empty owners list', async () => {
        const memberId = await insertUser('member@example.com');
        const workspaceId = await insertWorkspace('Orphan');
        await db.insert(workspaceUsers).values({ workspaceId, userId: memberId, role: 'member' });

        expect(await listWorkspaces(db)).toEqual([{ id: workspaceId, name: 'Orphan', memberCount: 1, owners: [] }]);
    });

    it('reports a workspace with no members at all', async () => {
        const workspaceId = await insertWorkspace('Empty');

        expect(await listWorkspaces(db)).toEqual([{ id: workspaceId, name: 'Empty', memberCount: 0, owners: [] }]);
    });

    it('orders by name so repeated runs are diffable', async () => {
        await insertWorkspace('Zebra');
        await insertWorkspace('Alpha');

        expect((await listWorkspaces(db)).map((row) => row.name)).toEqual(['Alpha', 'Zebra']);
    });
});

describe('formatWorkspaceList', () => {
    it('joins multiple owners onto one line', () => {
        const lines = formatWorkspaceList([
            { id: 'w1', name: 'Acme', memberCount: 3, owners: ['a@example.com', 'b@example.com'] },
        ]);

        expect(lines[2]).toContain('a@example.com, b@example.com');
    });

    it('flags an ownerless workspace loudly', () => {
        const lines = formatWorkspaceList([{ id: 'w1', name: 'Orphan', memberCount: 1, owners: [] }]);

        expect(lines[2]).toContain('NO OWNER');
    });
});

async function insertUser(email: string): Promise<string> {
    const id = randomUUID();
    await db.insert(user).values({ id, name: email, email, updatedAt: new Date() });
    return id;
}

async function insertWorkspace(name: string): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name });
    return id;
}
