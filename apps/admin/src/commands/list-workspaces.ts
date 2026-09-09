import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@app/db';
import { formatTable } from './list-users.js';

const { user, workspaceUsers, workspaces } = schema;

export type WorkspaceSummary = {
    id: string;
    name: string;
    memberCount: number;
    /** Emails of the workspace's owners. Empty is a fault worth seeing: nobody can administer it. */
    owners: string[];
};

/**
 * Lists every workspace with its member count and its owners' emails.
 *
 * An empty `owners` list is the reason this command reports owners at all rather than just a count:
 * a workspace whose last owner was removed cannot be renamed, deleted, or have members added, and
 * nothing surfaces that except looking.
 */
export async function listWorkspaces(db: Db): Promise<WorkspaceSummary[]> {
    const rows = await db
        .select({
            id: workspaces.id,
            name: workspaces.name,
            memberCount: sql<number>`count(${workspaceUsers.userId})::int`,
            owners: sql<
                string[]
            >`coalesce(array_agg(${user.email}) filter (where ${workspaceUsers.role} = 'owner'), '{}')`,
        })
        .from(workspaces)
        .leftJoin(workspaceUsers, eq(workspaceUsers.workspaceId, workspaces.id))
        .leftJoin(user, eq(user.id, workspaceUsers.userId))
        .groupBy(workspaces.id, workspaces.name)
        .orderBy(workspaces.name);

    return rows;
}

/** Renders {@link listWorkspaces}'s result as a fixed-width text table for the CLI. */
export function formatWorkspaceList(rows: WorkspaceSummary[]): string[] {
    const header = ['Id', 'Name', 'Members', 'Owners'];
    const table = rows.map((row) => [
        row.id,
        row.name,
        String(row.memberCount),
        row.owners.length > 0 ? row.owners.join(', ') : 'NO OWNER',
    ]);

    return formatTable({ header, rows: table });
}
