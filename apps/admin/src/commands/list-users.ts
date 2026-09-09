import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@app/db';

const { account, user, workspaceUsers } = schema;

export type UserSummary = {
    id: string;
    email: string;
    displayName: string;
    workspaceCount: number;
    /** Whether the user has a credential `account` - i.e. whether they can actually sign in. */
    canSignIn: boolean;
};

/**
 * Lists every user with its email, display name, workspace count, and whether it holds a credential
 * `account`. That last column is the operator's answer to "who can actually sign in": a user
 * provisioned without a password has a `user` row but no credential, and nothing else in the schema
 * makes that visible.
 *
 * Two queries merged in JS rather than one with a join: joining memberships onto the user row fans
 * out one row per membership and needs `COUNT(DISTINCT ...)` care either way, and the second round
 * trip costs nothing at the scale an operator CLI runs at.
 */
export async function listUsers(db: Db): Promise<UserSummary[]> {
    const userRows = await db
        .select({
            id: user.id,
            email: user.email,
            displayName: user.name,
            canSignIn: sql<boolean>`${account.id} is not null`,
        })
        .from(user)
        .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
        .orderBy(user.email);

    const workspaceCountRows = await db
        .select({ userId: workspaceUsers.userId, workspaceCount: sql<number>`count(*)::int` })
        .from(workspaceUsers)
        .groupBy(workspaceUsers.userId);
    const workspaceCountByUserId = new Map(workspaceCountRows.map((row) => [row.userId, row.workspaceCount]));

    return userRows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        workspaceCount: workspaceCountByUserId.get(row.id) ?? 0,
        canSignIn: row.canSignIn,
    }));
}

/** Renders {@link listUsers}'s result as a fixed-width text table for the CLI. */
export function formatUserList(rows: UserSummary[]): string[] {
    const header = ['Id', 'Email', 'Display name', 'Workspaces', 'Can sign in?'];
    const table = rows.map((row) => [
        row.id,
        row.email,
        row.displayName,
        String(row.workspaceCount),
        row.canSignIn ? 'yes' : 'NO CREDENTIAL',
    ]);

    return formatTable({ header, rows: table });
}

/** Pads every column to its widest cell so the output lines up in a terminal. */
export function formatTable({ header, rows }: { header: string[]; rows: string[][] }): string[] {
    const widths = header.map((title, columnIndex) =>
        Math.max(title.length, ...rows.map((row) => row[columnIndex].length)),
    );

    const formatRow = (cells: string[]): string =>
        cells
            .map((cell, index) => cell.padEnd(widths[index]))
            .join('  ')
            .trimEnd();

    return [formatRow(header), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(formatRow)];
}
