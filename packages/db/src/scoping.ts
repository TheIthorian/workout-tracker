import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Any table that belongs to a workspace. Structural rather than nominal, so a new table opts in
 * simply by having a `workspaceId` column — there is no registry to keep in step.
 */
export type WorkspaceOwnedTable = { workspaceId: PgColumn };

/**
 * Builds the `where` clause for a query against a workspace-owned table, with the tenant filter
 * always present and always first.
 *
 * **Use this instead of writing `eq(table.workspaceId, id)` by hand alongside other filters.** A
 * query that forgets the tenant filter is a data leak between tenants, not a bug that returns extra
 * rows, and the only reliable defence is making the filter impossible to omit rather than something
 * a reviewer has to spot. Passing the table itself is what forces it: there is no argument order
 * that produces a query without it.
 *
 * @param table the workspace-owned table being queried.
 * @param workspaceId the workspace the caller has already been authorised for — this function
 * checks membership no more than a `where` clause can; that is `WorkspaceMembershipService`'s job.
 * @param filters any further conditions, ANDed onto the tenant filter. `undefined` entries are
 * dropped, so a caller can inline a conditional filter without building an array first.
 */
export function scopedToWorkspace<T extends WorkspaceOwnedTable>(
    table: T,
    workspaceId: string,
    ...filters: Array<SQL | undefined>
): SQL {
    // The non-null assertion is safe: `and` only returns undefined when given no defined
    // conditions, and the tenant filter is always one.
    return and(eq(table.workspaceId, workspaceId), ...filters)!;
}

/**
 * A table whose rows are either owned by one workspace or shared with every workspace. The shape is
 * the same as `WorkspaceOwnedTable`; the name records that `workspaceId` may be null.
 */
export type SharedOrWorkspaceOwnedTable = { workspaceId: PgColumn };

/**
 * READ-ONLY counterpart of `scopedToWorkspace`: admits rows shared with every workspace
 * (`workspace_id IS NULL`) alongside the caller's own.
 *
 * Never pass this to an `update` or `delete`. A shared row is content every tenant reads and no
 * tenant may change; a write scoped with this helper would let any workspace member alter it.
 * Writes keep `scopedToWorkspace`, so a shared row's id through a workspace route finds nothing and
 * yields the same not-found as a row in another workspace.
 */
export function scopedToWorkspaceOrGlobal<T extends SharedOrWorkspaceOwnedTable>(
    table: T,
    workspaceId: string,
    ...filters: Array<SQL | undefined>
): SQL {
    return and(or(eq(table.workspaceId, workspaceId), isNull(table.workspaceId)), ...filters)!;
}
