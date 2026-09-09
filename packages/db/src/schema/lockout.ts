import { foreignKey, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/**
 * Per-account sign-in lockout state, keyed by Better Auth's `user.id`.
 *
 * A separate table rather than extra columns on `user`, because Better Auth owns its own schema
 * outright and regenerating it would drop anything added there.
 *
 * `lockout_end` is `timestamptz`, unlike the naive `timestamp` Better Auth uses for its own
 * columns. A lockout window that reads as the wrong instant is a security control that silently
 * misfires, so this one carries its zone explicitly rather than relying on the process running in
 * UTC.
 *
 * The absence of a row means "no failed attempts on record".
 */
export const userLockout = pgTable(
    'user_lockout',
    {
        userId: uuid('user_id').primaryKey().notNull(),
        accessFailedCount: integer('access_failed_count').default(0).notNull(),
        lockoutEnd: timestamp('lockout_end', { withTimezone: true, mode: 'string' }),
    },
    (table) => [
        foreignKey({
            columns: [table.userId],
            foreignColumns: [user.id],
            name: 'user_lockout_user_id_user_id_fk',
        }).onDelete('cascade'),
    ],
);
