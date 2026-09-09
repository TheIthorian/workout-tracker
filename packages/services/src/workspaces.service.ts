import { randomUUID } from 'node:crypto';
import { schema, withTransaction, type Db } from '@app/db';
import { EntityNotFoundError, InvalidOperationError, UserAlreadyMemberError } from '@app/errors';
import { and, count, eq } from 'drizzle-orm';
import { WorkspaceMembershipService, WorkspaceRole } from './workspace-membership.service.js';

const { user, workspaceUsers, workspaces } = schema;

export type WorkspaceResponse = {
    workspaceId: string;
    name: string;
    role: WorkspaceRole;
    members: MemberListItem[];
};

export type MemberListItem = {
    userId: string;
    displayName: string;
    email: string;
    role: WorkspaceRole;
};

export type WorkspaceListItem = {
    workspaceId: string;
    name: string;
    role: WorkspaceRole;
};

/** Creates workspaces and manages their membership. */
export class WorkspacesService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /** Every workspace the user belongs to, with the role they hold in each. */
    async listForUser(userId: string): Promise<WorkspaceListItem[]> {
        const rows = await this.db
            .select({ workspaceId: workspaceUsers.workspaceId, name: workspaces.name, role: workspaceUsers.role })
            .from(workspaceUsers)
            .innerJoin(workspaces, eq(workspaceUsers.workspaceId, workspaces.id))
            .where(eq(workspaceUsers.userId, userId));

        return rows.map((row) => ({ ...row, role: row.role as WorkspaceRole }));
    }

    /**
     * One workspace with its full member list.
     *
     * @throws EntityNotFoundError when the caller is not a member.
     */
    async get({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<WorkspaceResponse> {
        const membership = await this.membership.require({ userId, workspaceId });

        const [row] = await this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));

        if (!row) throw new EntityNotFoundError('Workspace not found');

        return {
            workspaceId: row.id,
            name: row.name,
            role: membership.role,
            members: await this.listMembers(workspaceId),
        };
    }

    /** Creates a workspace with the caller as its owner. Both writes are one transaction. */
    async create({ userId, name }: { userId: string; name: string }): Promise<WorkspaceResponse> {
        const workspaceId = randomUUID();

        await withTransaction(this.db, async (tx) => {
            await tx.insert(workspaces).values({ id: workspaceId, name });
            await tx.insert(workspaceUsers).values({ workspaceId, userId, role: WorkspaceRole.Owner });
        });

        return this.get({ userId, workspaceId });
    }

    /**
     * Renames a workspace.
     *
     * @throws EntityNotFoundError when the caller is not a member.
     * @throws ForbiddenActionError when the caller is not at least an admin.
     */
    async rename({
        userId,
        workspaceId,
        name,
    }: {
        userId: string;
        workspaceId: string;
        name: string;
    }): Promise<WorkspaceResponse> {
        await this.membership.requireRole({ userId, workspaceId, role: WorkspaceRole.Admin });

        await this.db
            .update(workspaces)
            .set({ name, updatedAt: new Date().toISOString() })
            .where(eq(workspaces.id, workspaceId));

        return this.get({ userId, workspaceId });
    }

    /**
     * Deletes a workspace and everything in it, via `on delete cascade`.
     *
     * @throws ForbiddenActionError when the caller is not the owner.
     */
    async remove({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<void> {
        await this.membership.requireRole({ userId, workspaceId, role: WorkspaceRole.Owner });

        await this.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }

    /** Every member of the workspace. The caller's membership must already have been checked. */
    async listMembers(workspaceId: string): Promise<MemberListItem[]> {
        const rows = await this.db
            .select({
                userId: workspaceUsers.userId,
                displayName: user.name,
                email: user.email,
                role: workspaceUsers.role,
            })
            .from(workspaceUsers)
            .innerJoin(user, eq(workspaceUsers.userId, user.id))
            .where(eq(workspaceUsers.workspaceId, workspaceId));

        return rows.map((row) => ({ ...row, role: row.role as WorkspaceRole }));
    }

    /**
     * Adds an existing user to the workspace by email.
     *
     * @throws ForbiddenActionError when the caller is not at least an admin.
     * @throws EntityNotFoundError when no user has that email.
     * @throws UserAlreadyMemberError when they already belong to the workspace.
     */
    async addMember({
        userId,
        workspaceId,
        email,
        role,
    }: {
        userId: string;
        workspaceId: string;
        email: string;
        role: WorkspaceRole;
    }): Promise<MemberListItem[]> {
        await this.membership.requireRole({ userId, workspaceId, role: WorkspaceRole.Admin });

        const [invitee] = await this.db.select({ id: user.id }).from(user).where(eq(user.email, email));

        if (!invitee) throw new EntityNotFoundError('User not found');

        if (await this.membership.find({ userId: invitee.id, workspaceId })) {
            throw new UserAlreadyMemberError();
        }

        await this.db.insert(workspaceUsers).values({ workspaceId, userId: invitee.id, role });

        return this.listMembers(workspaceId);
    }

    /**
     * Changes a member's role.
     *
     * @throws ForbiddenActionError when the caller is not at least an admin.
     * @throws InvalidOperationError when the caller targets themselves, or when the change would
     * leave the workspace with no owner.
     */
    async updateMemberRole({
        userId,
        workspaceId,
        memberUserId,
        role,
    }: {
        userId: string;
        workspaceId: string;
        memberUserId: string;
        role: WorkspaceRole;
    }): Promise<MemberListItem[]> {
        await this.membership.requireRole({ userId, workspaceId, role: WorkspaceRole.Admin });

        if (memberUserId === userId) {
            throw new InvalidOperationError('Cannot change your own role', 'Ask another admin to change it.');
        }

        const target = await this.membership.find({ userId: memberUserId, workspaceId });

        if (!target) throw new EntityNotFoundError('Member not found');

        if (target.role === WorkspaceRole.Owner && role !== WorkspaceRole.Owner) {
            await this.assertNotLastOwner(workspaceId);
        }

        await this.db
            .update(workspaceUsers)
            .set({ role })
            .where(and(eq(workspaceUsers.workspaceId, workspaceId), eq(workspaceUsers.userId, memberUserId)));

        return this.listMembers(workspaceId);
    }

    /**
     * Removes a member from the workspace.
     *
     * @throws ForbiddenActionError when the caller is not at least an admin.
     * @throws InvalidOperationError when removing the last owner, which would leave the workspace
     * unadministrable.
     */
    async removeMember({
        userId,
        workspaceId,
        memberUserId,
    }: {
        userId: string;
        workspaceId: string;
        memberUserId: string;
    }): Promise<void> {
        await this.membership.requireRole({ userId, workspaceId, role: WorkspaceRole.Admin });

        const target = await this.membership.find({ userId: memberUserId, workspaceId });

        if (!target) throw new EntityNotFoundError('Member not found');

        if (target.role === WorkspaceRole.Owner) {
            await this.assertNotLastOwner(workspaceId);
        }

        await this.db
            .delete(workspaceUsers)
            .where(and(eq(workspaceUsers.workspaceId, workspaceId), eq(workspaceUsers.userId, memberUserId)));
    }

    private async assertNotLastOwner(workspaceId: string): Promise<void> {
        const [row] = await this.db
            .select({ owners: count() })
            .from(workspaceUsers)
            .where(and(eq(workspaceUsers.workspaceId, workspaceId), eq(workspaceUsers.role, WorkspaceRole.Owner)));

        if ((row?.owners ?? 0) <= 1) {
            throw new InvalidOperationError('Cannot remove the last owner', 'Promote another member to owner first.');
        }
    }
}
