import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { OnboardingStage } from '@app/domain';
import { EntityNotFoundError, ForbiddenActionError, InvalidOperationError, UserAlreadyMemberError } from '@app/errors';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedMembership, seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService, WorkspaceRole } from './workspace-membership.service.js';
import { WorkspacesService } from './workspaces.service.js';

const { workspaces } = schema;

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let service: WorkspacesService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    service = new WorkspacesService({ db, membership: new WorkspaceMembershipService({ db }) });
});

afterAll(async () => {
    await database?.stop();
});

describe('create', () => {
    it('creates the workspace with the caller as owner', async () => {
        const userId = await seedUser(db);

        const created = await service.create({ userId, name: 'Acme' });

        expect(created).toMatchObject({ name: 'Acme', role: WorkspaceRole.Owner });
        expect(created.members).toEqual([expect.objectContaining({ userId, role: WorkspaceRole.Owner })]);
    });
});

describe('listForUser', () => {
    it('returns every workspace the user belongs to, with their role in each', async () => {
        const userId = await seedUser(db);
        const ownedId = await seedWorkspace(db, userId, 'Owned');
        const otherOwnerId = await seedUser(db);
        const joinedId = await seedWorkspace(db, otherOwnerId, 'Joined');
        await seedMembership(db, { workspaceId: joinedId, userId, role: WorkspaceRole.Member });

        const listed = await service.listForUser(userId);

        expect(listed).toEqual(
            expect.arrayContaining([
                {
                    workspaceId: ownedId,
                    name: 'Owned',
                    role: WorkspaceRole.Owner,
                    onboardingStage: OnboardingStage.Equipment,
                },
                {
                    workspaceId: joinedId,
                    name: 'Joined',
                    role: WorkspaceRole.Member,
                    onboardingStage: OnboardingStage.Equipment,
                },
            ]),
        );
        expect(listed).toHaveLength(2);
    });

    it('returns nothing for a user with no memberships', async () => {
        expect(await service.listForUser(await seedUser(db))).toEqual([]);
    });
});

describe('setOnboardingStage', () => {
    it('starts at equipment and moves to complete', async () => {
        const ownerId = await seedUser(db, 'Onboarding');
        const workspaceId = await seedWorkspace(db, ownerId);

        const before = await service.listForUser(ownerId);
        expect(before[0]?.onboardingStage).toBe(OnboardingStage.Equipment);

        await expect(
            service.setOnboardingStage({ userId: ownerId, workspaceId, stage: OnboardingStage.Complete }),
        ).resolves.toEqual({ stage: OnboardingStage.Complete });

        const after = await service.listForUser(ownerId);
        expect(after[0]?.onboardingStage).toBe(OnboardingStage.Complete);
    });

    it('refuses a non-member', async () => {
        const ownerId = await seedUser(db);
        const strangerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);

        await expect(
            service.setOnboardingStage({ userId: strangerId, workspaceId, stage: OnboardingStage.Complete }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('get', () => {
    it('refuses a workspace the caller does not belong to', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const outsiderId = await seedUser(db);

        await expect(service.get({ userId: outsiderId, workspaceId })).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('rename', () => {
    it('renames for an owner', async () => {
        const userId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, userId, 'Before');

        expect((await service.rename({ userId, workspaceId, name: 'After' })).name).toBe('After');
    });

    it('refuses a plain member', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const memberId = await seedUser(db);
        await seedMembership(db, { workspaceId, userId: memberId });

        await expect(service.rename({ userId: memberId, workspaceId, name: 'Nope' })).rejects.toBeInstanceOf(
            ForbiddenActionError,
        );
    });
});

describe('remove', () => {
    it('deletes the workspace for its owner', async () => {
        const userId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, userId);

        await service.remove({ userId, workspaceId });

        expect(await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))).toHaveLength(0);
    });

    it('refuses an admin who is not the owner', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const adminId = await seedUser(db);
        await seedMembership(db, { workspaceId, userId: adminId, role: WorkspaceRole.Admin });

        await expect(service.remove({ userId: adminId, workspaceId })).rejects.toBeInstanceOf(ForbiddenActionError);
    });
});

describe('addMember', () => {
    it('adds an existing user by email', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const inviteeId = await seedUser(db);
        const email = `${inviteeId}@example.com`;

        const members = await service.addMember({
            userId: ownerId,
            workspaceId,
            email,
            role: WorkspaceRole.Member,
        });

        expect(members).toEqual(
            expect.arrayContaining([expect.objectContaining({ userId: inviteeId, role: WorkspaceRole.Member })]),
        );
    });

    it('throws EntityNotFoundError when no user has that email', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);

        await expect(
            service.addMember({
                userId: ownerId,
                workspaceId,
                email: `${randomUUID()}@example.com`,
                role: WorkspaceRole.Member,
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('throws UserAlreadyMemberError for an existing member', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);

        await expect(
            service.addMember({
                userId: ownerId,
                workspaceId,
                email: `${ownerId}@example.com`,
                role: WorkspaceRole.Member,
            }),
        ).rejects.toBeInstanceOf(UserAlreadyMemberError);
    });

    it('refuses a plain member', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const memberId = await seedUser(db);
        await seedMembership(db, { workspaceId, userId: memberId });
        const inviteeId = await seedUser(db);

        await expect(
            service.addMember({
                userId: memberId,
                workspaceId,
                email: `${inviteeId}@example.com`,
                role: WorkspaceRole.Member,
            }),
        ).rejects.toBeInstanceOf(ForbiddenActionError);
    });
});

describe('updateMemberRole', () => {
    it('promotes a member', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const memberId = await seedUser(db);
        await seedMembership(db, { workspaceId, userId: memberId });

        const members = await service.updateMemberRole({
            userId: ownerId,
            workspaceId,
            memberUserId: memberId,
            role: WorkspaceRole.Admin,
        });

        expect(members).toEqual(
            expect.arrayContaining([expect.objectContaining({ userId: memberId, role: WorkspaceRole.Admin })]),
        );
    });

    it('refuses to change your own role', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);

        await expect(
            service.updateMemberRole({
                userId: ownerId,
                workspaceId,
                memberUserId: ownerId,
                role: WorkspaceRole.Member,
            }),
        ).rejects.toBeInstanceOf(InvalidOperationError);
    });

    it('refuses to demote the last owner', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const adminId = await seedUser(db);
        await seedMembership(db, { workspaceId, userId: adminId, role: WorkspaceRole.Admin });

        await expect(
            service.updateMemberRole({
                userId: adminId,
                workspaceId,
                memberUserId: ownerId,
                role: WorkspaceRole.Member,
            }),
        ).rejects.toBeInstanceOf(InvalidOperationError);
    });
});

describe('removeMember', () => {
    it('removes a plain member', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const memberId = await seedUser(db);
        await seedMembership(db, { workspaceId, userId: memberId });

        await service.removeMember({ userId: ownerId, workspaceId, memberUserId: memberId });

        expect((await service.listMembers(workspaceId)).map((m) => m.userId)).toEqual([ownerId]);
    });

    it('refuses to remove the last owner', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const adminId = await seedUser(db);
        await seedMembership(db, { workspaceId, userId: adminId, role: WorkspaceRole.Admin });

        await expect(
            service.removeMember({ userId: adminId, workspaceId, memberUserId: ownerId }),
        ).rejects.toBeInstanceOf(InvalidOperationError);
    });

    it('throws EntityNotFoundError for someone who is not a member', async () => {
        const ownerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);
        const outsiderId = await seedUser(db);

        await expect(
            service.removeMember({ userId: ownerId, workspaceId, memberUserId: outsiderId }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});
