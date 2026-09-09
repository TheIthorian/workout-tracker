import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { formatUserList, listUsers } from './list-users.js';

const { account, user, workspaceUsers, workspaces } = schema;

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

describe('listUsers', () => {
    it('reports the workspace count and whether each user can sign in', async () => {
        const canSignIn = await insertUser('has-password@example.com');
        await insertCredential(canSignIn);

        // No credential row: an account that exists but cannot sign in. Surfacing this is the whole
        // reason the command reports the column.
        const noCredential = await insertUser('no-password@example.com');

        const workspaceId = await insertWorkspace('Workspace');
        await db.insert(workspaceUsers).values({ userId: noCredential, workspaceId, role: 'owner' });

        const rows = await listUsers(db);

        expect(rows).toEqual([
            expect.objectContaining({
                id: canSignIn,
                email: 'has-password@example.com',
                workspaceCount: 0,
                canSignIn: true,
            }),
            expect.objectContaining({
                id: noCredential,
                email: 'no-password@example.com',
                workspaceCount: 1,
                canSignIn: false,
            }),
        ]);
    });

    it('counts every workspace a user belongs to, not only the ones they own', async () => {
        const userId = await insertUser('member@example.com');
        for (const name of ['One', 'Two']) {
            const workspaceId = await insertWorkspace(name);
            await db.insert(workspaceUsers).values({ userId, workspaceId, role: 'member' });
        }

        expect((await listUsers(db))[0].workspaceCount).toBe(2);
    });

    it('orders by email so repeated runs are diffable', async () => {
        await insertUser('zoe@example.com');
        await insertUser('adam@example.com');

        expect((await listUsers(db)).map((row) => row.email)).toEqual(['adam@example.com', 'zoe@example.com']);
    });

    it('returns nothing for an empty database', async () => {
        expect(await listUsers(db)).toEqual([]);
    });
});

describe('formatUserList', () => {
    it('renders a header, a rule, and one line per user', () => {
        const lines = formatUserList([
            { id: 'u1', email: 'a@example.com', displayName: 'A', workspaceCount: 1, canSignIn: true },
        ]);

        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('Email');
        expect(lines[2]).toContain('a@example.com');
        expect(lines[2]).toContain('yes');
    });

    // An operator scanning the table needs the broken case to stand out, not read as a quiet "no".
    it('flags a user with no credential loudly', () => {
        const lines = formatUserList([
            { id: 'u1', email: 'a@example.com', displayName: 'A', workspaceCount: 0, canSignIn: false },
        ]);

        expect(lines[2]).toContain('NO CREDENTIAL');
    });
});

async function insertUser(email: string): Promise<string> {
    const id = randomUUID();
    await db.insert(user).values({ id, name: email, email, updatedAt: new Date() });
    return id;
}

async function insertCredential(userId: string): Promise<void> {
    await db.insert(account).values({
        id: randomUUID(),
        issuer: 'local:credential',
        accountId: userId,
        providerId: 'credential',
        userId,
        password: 'not-a-real-hash',
        updatedAt: new Date(),
    });
}

async function insertWorkspace(name: string): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name });
    return id;
}
