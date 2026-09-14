import { schema, type Db } from '@app/db';
import { ForbiddenActionError, UnauthorizedError } from '@app/errors';
import { and, count, eq, inArray } from 'drizzle-orm';
import { WorkspaceRole } from './workspace-membership.service.js';

const { user, workspaceUsers, workspaces } = schema;

export type UserWorkspaceListItem = { workspaceId: string; name: string; role: WorkspaceRole };

export type UserProfile = {
    userId: string;
    displayName: string;
    email: string;
    workspaces: UserWorkspaceListItem[];
};

/**
 * Reads and writes the signed-in user's own profile. Every method assumes the caller already
 * resolved `userId` from a valid session — none of them re-checks authentication.
 */
export class UsersService {
    private readonly db: Db;

    constructor({ db }: { db: Db }) {
        this.db = db;
    }

    /**
     * Loads the user's profile and every workspace they belong to.
     *
     * @throws UnauthorizedError when `userId` does not exist — a session pointing at a deleted user
     * is an invalid session, not a server fault. Unreachable in practice, since Better Auth
     * resolves the session through a join onto the user row, so `SessionAuthGuard` rejects a
     * deleted user before any handler runs.
     */
    async getUser(userId: string): Promise<UserProfile> {
        const [row] = await this.db
            .select({ id: user.id, displayName: user.name, email: user.email })
            .from(user)
            .where(eq(user.id, userId));

        if (!row) throw new UnauthorizedError();

        return {
            userId: row.id,
            displayName: row.displayName,
            email: row.email,
            workspaces: await this.loadWorkspaces(userId),
        };
    }

    /** Sets the user's display name and returns the updated profile. */
    async updateDisplayName({ userId, displayName }: { userId: string; displayName: string }): Promise<UserProfile> {
        await this.db.update(user).set({ name: displayName }).where(eq(user.id, userId));

        return this.getUser(userId);
    }

    /**
     * Deletes the account and any personal workspace it owns.
     *
     * @throws ForbiddenActionError when an owned workspace contains another member. This protects
     * legacy shared data while workspace management is unavailable.
     *
     * Better Auth's own `/delete-user` route is not used: it requires session freshness or a
     * password this contract does not carry, and is gated behind a config flag this app does not
     * otherwise need.
     */
    async deleteUser(userId: string): Promise<void> {
        await this.db.transaction(async (tx): Promise<void> => {
            const owned = await tx
                .select({ workspaceId: workspaceUsers.workspaceId })
                .from(workspaceUsers)
                .where(and(eq(workspaceUsers.userId, userId), eq(workspaceUsers.role, WorkspaceRole.Owner)));
            const ownedWorkspaceIds = owned.map((row) => row.workspaceId);

            if (ownedWorkspaceIds.length > 0) {
                const memberCounts = await tx
                    .select({ workspaceId: workspaceUsers.workspaceId, members: count() })
                    .from(workspaceUsers)
                    .where(inArray(workspaceUsers.workspaceId, ownedWorkspaceIds))
                    .groupBy(workspaceUsers.workspaceId);

                if (memberCounts.some((row) => row.members > 1)) {
                    throw new ForbiddenActionError(
                        'Cannot delete account',
                        'Your account still owns shared data. Contact support before deleting your account.',
                    );
                }

                await tx.delete(workspaces).where(inArray(workspaces.id, ownedWorkspaceIds));
            }

            await tx.delete(user).where(eq(user.id, userId));
        });
    }

    private async loadWorkspaces(userId: string): Promise<UserWorkspaceListItem[]> {
        const rows = await this.db
            .select({ workspaceId: workspaceUsers.workspaceId, name: workspaces.name, role: workspaceUsers.role })
            .from(workspaceUsers)
            .innerJoin(workspaces, eq(workspaceUsers.workspaceId, workspaces.id))
            .where(eq(workspaceUsers.userId, userId));

        return rows.map((row) => ({ ...row, role: row.role as WorkspaceRole }));
    }
}
