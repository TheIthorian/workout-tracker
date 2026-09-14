import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { ForbiddenActionError, UnauthorizedError } from '@app/errors';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedMembership, seedUser, seedWorkspace } from './testing.js';
import { UsersService } from './users.service.js';
import { WorkspaceRole } from './workspace-membership.service.js';

const { user } = schema;

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let users: UsersService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    users = new UsersService({ db });
});

afterAll(async () => {
    await database?.stop();
});

describe('getUser', () => {
    it('returns the profile with every workspace the user belongs to', async () => {
        const userId = await seedUser(db, 'Alice');
        const ownedId = await seedWorkspace(db, userId, 'Owned');
        const otherOwnerId = await seedUser(db);
        const joinedId = await seedWorkspace(db, otherOwnerId, 'Joined');
        await seedMembership(db, { workspaceId: joinedId, userId, role: WorkspaceRole.Member });

        const profile = await users.getUser(userId);

        expect(profile).toMatchObject({ userId, displayName: 'Alice', email: `${userId}@example.com` });
        expect(profile.workspaces).toEqual(
            expect.arrayContaining([
                { workspaceId: ownedId, name: 'Owned', role: WorkspaceRole.Owner },
                { workspaceId: joinedId, name: 'Joined', role: WorkspaceRole.Member },
            ]),
        );
    });

    it('returns an empty workspace list rather than failing for a user with none', async () => {
        expect((await users.getUser(await seedUser(db))).workspaces).toEqual([]);
    });

    it('throws UnauthorizedError for a user that does not exist', async () => {
        await expect(users.getUser(randomUUID())).rejects.toBeInstanceOf(UnauthorizedError);
    });
});

describe('updateDisplayName', () => {
    it('writes the new name and returns the updated profile', async () => {
        const userId = await seedUser(db, 'Before');

        expect((await users.updateDisplayName({ userId, displayName: 'After' })).displayName).toBe('After');
        expect((await users.getUser(userId)).displayName).toBe('After');
    });
});

describe('deleteUser', () => {
    it('removes a user who owns no workspace', async () => {
        const userId = await seedUser(db, 'Doomed');

        await users.deleteUser(userId);

        expect(await db.select().from(user).where(eq(user.id, userId))).toHaveLength(0);
    });

    it("removes a user who is only a member of someone else's workspace", async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const memberId = await seedUser(db);
        await seedMembership(db, { workspaceId, userId: memberId });

        await users.deleteUser(memberId);

        expect(await db.select().from(user).where(eq(user.id, memberId))).toHaveLength(0);
    });

    it('deletes the user and their personal workspace', async () => {
        const userId = await seedUser(db);
        await seedWorkspace(db, userId);

        await users.deleteUser(userId);

        expect(await db.select().from(user).where(eq(user.id, userId))).toHaveLength(0);
    });

    it('refuses to delete legacy shared data and leaves the account intact', async () => {
        const userId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, userId);
        await seedMembership(db, { workspaceId, userId: await seedUser(db) });

        await expect(users.deleteUser(userId)).rejects.toBeInstanceOf(ForbiddenActionError);

        expect(await db.select().from(user).where(eq(user.id, userId))).toHaveLength(1);
    });
});
