import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { workspaces } from './workspaces.js';

/**
 * Example workspace-owned resource. It exists to demonstrate the full slice — contract schema,
 * controller, service, table, workspace scoping — and is meant to be renamed or deleted when you
 * build the real thing.
 *
 * `createdByUserId` is nullable and `on delete set null`: deleting a member must not take the
 * workspace's rows with them.
 */
export const items = pgTable(
    'items',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        createdByUserId: uuid('created_by_user_id'),
        name: text('name').notNull(),
        description: text('description'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('items_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'items_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.createdByUserId],
            foreignColumns: [user.id],
            name: 'items_created_by_user_id_user_id_fk',
        }).onDelete('set null'),
    ],
);
