import { randomUUID } from 'node:crypto';
import type { Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { EntityNotFoundError, ForbiddenActionError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedMembership, seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService, WorkspaceRole } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let membership: WorkspaceMembershipService;

let ownerId: string;
let memberId: string;
let outsiderId: string;
let workspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    membership = new WorkspaceMembershipService({ db });

    ownerId = await seedUser(db, 'Owner');
    workspaceId = await seedWorkspace(db, ownerId);
    memberId = await seedUser(db, 'Member');
    await seedMembership(db, { workspaceId, userId: memberId, role: WorkspaceRole.Member });
    outsiderId = await seedUser(db, 'Outsider');
});

afterAll(async () => {
    await database?.stop();
});

describe('find', () => {
    it('returns the membership with its role', async () => {
        expect(await membership.find({ userId: ownerId, workspaceId })).toEqual({
            workspaceId,
            userId: ownerId,
            role: WorkspaceRole.Owner,
        });
    });

    it('returns null for a non-member', async () => {
        expect(await membership.find({ userId: outsiderId, workspaceId })).toBeNull();
    });
});

describe('require', () => {
    it('returns the membership for a member', async () => {
        expect((await membership.require({ userId: memberId, workspaceId })).role).toBe(WorkspaceRole.Member);
    });

    // Not a 403: a 403 would confirm the id names a real workspace, which is itself a leak.
    it('reports a non-member as not-found rather than forbidden', async () => {
        await expect(membership.require({ userId: outsiderId, workspaceId })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });

    it('reports a workspace that does not exist as not-found', async () => {
        await expect(membership.require({ userId: ownerId, workspaceId: randomUUID() })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});

describe('requireRole', () => {
    it('accepts a role above the one required', async () => {
        const result = await membership.requireRole({ userId: ownerId, workspaceId, role: WorkspaceRole.Admin });

        expect(result.role).toBe(WorkspaceRole.Owner);
    });

    it('accepts the exact role required', async () => {
        await expect(
            membership.requireRole({ userId: memberId, workspaceId, role: WorkspaceRole.Member }),
        ).resolves.toBeDefined();
    });

    // Safe to distinguish here: they already know the workspace exists.
    it('reports a member who is too junior as forbidden', async () => {
        await expect(
            membership.requireRole({ userId: memberId, workspaceId, role: WorkspaceRole.Admin }),
        ).rejects.toBeInstanceOf(ForbiddenActionError);
    });

    it('still reports a non-member as not-found, not forbidden', async () => {
        await expect(
            membership.requireRole({ userId: outsiderId, workspaceId, role: WorkspaceRole.Member }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});
