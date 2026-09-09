import { schema, type Db } from '@app/db';
import { ForbiddenActionError, UnauthorizedError } from '@app/errors';
import { and, count, eq } from 'drizzle-orm';
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
     * Deletes the account. Memberships go with it via `on delete cascade`.
     *
     * @throws ForbiddenActionError when the user still owns a workspace — deleting them would
     * leave it unadministrable, and cascading the workspace away would silently destroy other
     * members' data.
     *
     * Better Auth's own `/delete-user` route is not used: it requires session freshness or a
     * password this contract does not carry, and is gated behind a config flag this app does not
     * otherwise need.
     */
    async deleteUser(userId: string): Promise<void> {
        if ((await this.countOwnedWorkspaces(userId)) > 0) {
            throw new ForbiddenActionError(
                'Cannot delete account',
                'You cannot delete your account while you own one or more workspaces. Transfer ownership or delete them first.',
            );
        }

        await this.db.delete(user).where(eq(user.id, userId));
    }

    private async loadWorkspaces(userId: string): Promise<UserWorkspaceListItem[]> {
        const rows = await this.db
            .select({ workspaceId: workspaceUsers.workspaceId, name: workspaces.name, role: workspaceUsers.role })
            .from(workspaceUsers)
            .innerJoin(workspaces, eq(workspaceUsers.workspaceId, workspaces.id))
            .where(eq(workspaceUsers.userId, userId));

        return rows.map((row) => ({ ...row, role: row.role as WorkspaceRole }));
    }

    private async countOwnedWorkspaces(userId: string): Promise<number> {
        const [row] = await this.db
            .select({ owned: count() })
            .from(workspaceUsers)
            .where(and(eq(workspaceUsers.userId, userId), eq(workspaceUsers.role, WorkspaceRole.Owner)));

        return row?.owned ?? 0;
    }
}
