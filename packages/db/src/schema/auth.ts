import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Better Auth's core schema (email/password + sessions), pinned to better-auth 1.7.1.
 *
 * Derived by reading the installed `@better-auth/core` runtime source (`get-tables.mjs`'s
 * `buildAuthTables`, and `db/schema/account.mjs`) rather than from `@better-auth/cli generate` —
 * the CLI's output omits the required `account` field `issuer` and its unique index with
 * `accountId`, even though the adapter's own field table requires both.
 *
 * Regenerate with the CLI when upgrading better-auth, then diff against this file before trusting
 * the result.
 *
 * `user.id` is `uuid` rather than Better Auth's default `text`, so application tables can carry a
 * native uuid foreign key into it. Better Auth is configured to mint uuids to match — see
 * `advanced.database.generateId` in `packages/auth/src/auth-options.ts`. Changing one without the
 * other breaks sign-up.
 */
export const user = pgTable(
    'user',
    {
        id: uuid('id').primaryKey().notNull(),
        name: text('name').notNull(),
        email: text('email').notNull(),
        emailVerified: boolean('email_verified').default(false).notNull(),
        image: text('image'),
        createdAt: timestamp('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [unique('user_email_unique').on(table.email)],
);

export const session = pgTable(
    'session',
    {
        id: text('id').primaryKey().notNull(),
        expiresAt: timestamp('expires_at').notNull(),
        token: text('token').notNull(),
        createdAt: timestamp('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at').notNull(),
        ipAddress: text('ip_address'),
        userAgent: text('user_agent'),
        userId: uuid('user_id').notNull(),
    },
    (table) => [
        index('session_userId_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
        unique('session_token_unique').on(table.token),
        foreignKey({
            columns: [table.userId],
            foreignColumns: [user.id],
            name: 'session_user_id_user_id_fk',
        }).onDelete('cascade'),
    ],
);

export const account = pgTable(
    'account',
    {
        id: text('id').primaryKey().notNull(),
        issuer: text('issuer').notNull(),
        accountId: text('account_id').notNull(),
        providerId: text('provider_id').notNull(),
        userId: uuid('user_id').notNull(),
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: timestamp('access_token_expires_at'),
        refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
        scope: text('scope'),
        password: text('password'),
        createdAt: timestamp('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at').notNull(),
    },
    (table) => [
        index('account_userId_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
        // Required by @better-auth/core's `buildAuthTables`: the account model declares
        // `indexes: [{ fields: ["issuer", "accountId"], unique: true }]`. Credential accounts all
        // share the synthetic issuer "local:credential", so this pair - not accountId alone - is
        // what disambiguates one identity provider's account from another's.
        uniqueIndex('account_issuer_accountId_uidx').using(
            'btree',
            table.issuer.asc().nullsLast().op('text_ops'),
            table.accountId.asc().nullsLast().op('text_ops'),
        ),
        foreignKey({
            columns: [table.userId],
            foreignColumns: [user.id],
            name: 'account_user_id_user_id_fk',
        }).onDelete('cascade'),
    ],
);

export const verification = pgTable(
    'verification',
    {
        id: text('id').primaryKey().notNull(),
        identifier: text('identifier').notNull(),
        value: text('value').notNull(),
        expiresAt: timestamp('expires_at').notNull(),
        createdAt: timestamp('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [index('verification_identifier_idx').using('btree', table.identifier.asc().nullsLast().op('text_ops'))],
);
