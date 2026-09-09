import { schema, type Db, type Tx } from '@app/db';
import { EntityNotFoundError, ForbiddenActionError } from '@app/errors';
import { and, eq } from 'drizzle-orm';

const { workspaceUsers } = schema;

/** A user's membership of one workspace. */
export type Membership = {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
};

/** Ordered least to most privileged. Mirrors the `workspace_role` enum in `@app/db`. */
export enum WorkspaceRole {
    Member = 'member',
    Admin = 'admin',
    Owner = 'owner',
}

const ROLE_RANK: Record<WorkspaceRole, number> = {
    [WorkspaceRole.Member]: 0,
    [WorkspaceRole.Admin]: 1,
    [WorkspaceRole.Owner]: 2,
};

/**
 * The authorisation gate in front of every workspace-scoped query.
 *
 * `scopedToWorkspace` (`@app/db`) makes the tenant FILTER impossible to forget; this makes the
 * membership CHECK impossible to skip. Both are needed: a correctly scoped query against a
 * workspace the caller does not belong to still leaks that workspace's rows.
 *
 * A caller who is not a member is told the workspace does not exist rather than that they are
 * forbidden — otherwise a 403 confirms the id names a real workspace, which is itself a leak.
 */
export class WorkspaceMembershipService {
    private readonly db: Db;

    constructor({ db }: { db: Db }) {
        this.db = db;
    }

    /**
     * Asserts the user belongs to the workspace, and returns their membership so a caller can
     * branch on the role without a second query.
     *
     * @throws EntityNotFoundError when the user is not a member, or the workspace does not exist.
     */
    async require({ userId, workspaceId, tx }: { userId: string; workspaceId: string; tx?: Tx }): Promise<Membership> {
        const membership = await this.find({ userId, workspaceId, tx });

        if (!membership) throw new EntityNotFoundError('Workspace not found');

        return membership;
    }

    /**
     * Asserts the user belongs to the workspace with at least `role`.
     *
     * @throws EntityNotFoundError when the user is not a member at all — a non-member must not be
     * able to tell a real workspace from an imaginary one.
     * @throws ForbiddenActionError when they are a member but too junior. This one is safe to
     * distinguish: they already know the workspace exists.
     */
    async requireRole({
        userId,
        workspaceId,
        role,
        tx,
    }: {
        userId: string;
        workspaceId: string;
        role: WorkspaceRole;
        tx?: Tx;
    }): Promise<Membership> {
        const membership = await this.require({ userId, workspaceId, tx });

        if (ROLE_RANK[membership.role] < ROLE_RANK[role]) {
            throw new ForbiddenActionError('Insufficient workspace role', `This action requires the ${role} role.`);
        }

        return membership;
    }

    /** The membership, or `null` when the user does not belong to the workspace. */
    async find({
        userId,
        workspaceId,
        tx,
    }: {
        userId: string;
        workspaceId: string;
        tx?: Tx;
    }): Promise<Membership | null> {
        const [row] = await (tx ?? this.db)
            .select({
                workspaceId: workspaceUsers.workspaceId,
                userId: workspaceUsers.userId,
                role: workspaceUsers.role,
            })
            .from(workspaceUsers)
            .where(and(eq(workspaceUsers.userId, userId), eq(workspaceUsers.workspaceId, workspaceId)));

        return row ? { ...row, role: row.role as WorkspaceRole } : null;
    }
}
