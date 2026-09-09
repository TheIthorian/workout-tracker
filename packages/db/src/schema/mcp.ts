import { sql } from 'drizzle-orm';
import { customType, foreignKey, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { workspaces } from './workspaces.js';

const bytea = customType<{ data: Buffer }>({
    dataType() {
        return 'bytea';
    },
});

/**
 * Personal access tokens for `apps/mcp`. Only the hash is stored — the plaintext token is shown
 * once, at creation, and is unrecoverable afterwards.
 *
 * A token is pinned to ONE workspace. Without that pin a token would reach every workspace its
 * owner belongs to, which is a privilege escalation rather than a convenience.
 */
export const mcpPersonalAccessTokens = pgTable(
    'mcp_personal_access_tokens',
    {
        id: uuid('id').primaryKey().notNull(),
        userId: uuid('user_id').notNull(),
        tokenHash: bytea('token_hash').notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        name: varchar('name', { length: 128 }),
        revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
        lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        uniqueIndex('mcp_personal_access_tokens_token_hash_uidx').using(
            'btree',
            table.tokenHash.asc().nullsLast().op('bytea_ops'),
        ),
        index('mcp_personal_access_tokens_user_id_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
        index('mcp_personal_access_tokens_workspace_id_idx').using(
            'btree',
            table.workspaceId.asc().nullsLast().op('uuid_ops'),
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'mcp_personal_access_tokens_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.userId],
            foreignColumns: [user.id],
            name: 'mcp_personal_access_tokens_user_id_user_id_fk',
        }).onDelete('cascade'),
    ],
);
