import { sql } from 'drizzle-orm';
import { customType, foreignKey, index, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { timestamptz } from './timestamptz.js';
import { workspaces } from './workspaces.js';

const bytea = customType<{ data: Buffer }>({
    dataType() {
        return 'bytea';
    },
});

/**
 * The PKCE transformations this server accepts. `plain` is deliberately absent: OAuth 2.1 removed
 * it, and accepting it would let a network observer replay an intercepted authorization code.
 */
export const CODE_CHALLENGE_METHODS = ['S256'] as const;

/** Longest a `client_id` may be. A Client ID Metadata Document identifies its client by URL. */
export const MAX_CLIENT_ID_LENGTH = 512;

/**
 * An OAuth client, as last resolved from its Client ID Metadata Document. `client_id` is the https
 * URL the document was fetched from, which is also the client's identity — this server issues no
 * client ids of its own and runs no dynamic registration endpoint.
 *
 * The row is a cache, refreshed when `metadata_expires_at` passes. It is kept rather than re-fetched
 * per request so a document that temporarily stops resolving cannot retract consent a user already
 * gave, and so the Connected Apps list can name a client without a network call.
 */
export const oauthClients = pgTable(
    'oauth_clients',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        clientId: varchar('client_id', { length: MAX_CLIENT_ID_LENGTH }).notNull(),
        clientName: varchar('client_name', { length: 256 }),
        clientUri: text('client_uri'),
        logoUri: text('logo_uri'),
        tosUri: text('tos_uri'),
        policyUri: text('policy_uri'),
        redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
        scopes: jsonb('scopes').$type<string[]>().notNull(),
        metadataExpiresAt: timestamptz('metadata_expires_at').notNull(),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamptz('updated_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [uniqueIndex('oauth_clients_client_id_uidx').using('btree', table.clientId.asc().nullsLast())],
);

/**
 * One in-flight authorization request, created by `GET /oauth/authorize` and read by the consent
 * screen.
 *
 * Every protocol parameter is held here rather than carried through the browser to the consent page
 * and back: a request the user approves is then exactly the request the client made, with no round
 * trip through a query string anyone could edit.
 */
export const oauthAuthorizationRequests = pgTable(
    'oauth_authorization_requests',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        clientId: varchar('client_id', { length: MAX_CLIENT_ID_LENGTH }).notNull(),
        redirectUri: text('redirect_uri').notNull(),
        state: text('state'),
        codeChallenge: text('code_challenge').notNull(),
        codeChallengeMethod: varchar('code_challenge_method', { length: 16 }).notNull(),
        scopes: jsonb('scopes').$type<string[]>().notNull(),
        resource: text('resource'),
        expiresAt: timestamptz('expires_at').notNull(),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [index('oauth_authorization_requests_expires_at_idx').using('btree', table.expiresAt.asc().nullsLast())],
);

/**
 * A user's standing consent for one client. Tokens point back at the grant, so revoking it from the
 * Connected Apps screen invalidates every credential issued under it in one write.
 */
export const oauthGrants = pgTable(
    'oauth_grants',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        userId: uuid('user_id').notNull(),
        clientId: varchar('client_id', { length: MAX_CLIENT_ID_LENGTH }).notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        scopes: jsonb('scopes').$type<string[]>().notNull(),
        lastUsedAt: timestamptz('last_used_at'),
        revokedAt: timestamptz('revoked_at'),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamptz('updated_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        uniqueIndex('oauth_grants_user_id_client_id_uidx').using(
            'btree',
            table.userId.asc().nullsLast(),
            table.clientId.asc().nullsLast(),
        ),
        foreignKey({
            columns: [table.userId],
            foreignColumns: [user.id],
            name: 'oauth_grants_user_id_user_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'oauth_grants_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
    ],
);

/**
 * A single-use authorization code. Only the hash is stored, for the same reason a token's is:
 * a database dump must not yield a credential.
 *
 * `consumed_at` rather than a delete, so a second redemption is recognisable as a replay — which
 * RFC 6749 §4.1.2 requires be answered by revoking everything the first redemption issued.
 */
export const oauthAuthorizationCodes = pgTable(
    'oauth_authorization_codes',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        codeHash: bytea('code_hash').notNull(),
        grantId: uuid('grant_id').notNull(),
        clientId: varchar('client_id', { length: MAX_CLIENT_ID_LENGTH }).notNull(),
        userId: uuid('user_id').notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        redirectUri: text('redirect_uri').notNull(),
        codeChallenge: text('code_challenge').notNull(),
        codeChallengeMethod: varchar('code_challenge_method', { length: 16 }).notNull(),
        scopes: jsonb('scopes').$type<string[]>().notNull(),
        expiresAt: timestamptz('expires_at').notNull(),
        consumedAt: timestamptz('consumed_at'),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        uniqueIndex('oauth_authorization_codes_code_hash_uidx').using(
            'btree',
            table.codeHash.asc().nullsLast().op('bytea_ops'),
        ),
        index('oauth_authorization_codes_grant_id_idx').using('btree', table.grantId.asc().nullsLast()),
        foreignKey({
            columns: [table.grantId],
            foreignColumns: [oauthGrants.id],
            name: 'oauth_authorization_codes_grant_id_oauth_grants_id_fk',
        }).onDelete('cascade'),
    ],
);

/**
 * A bearer access token. Opaque and hashed: `apps/mcp` holds no database connection and no signing
 * key, so it forwards whatever it was given to `apps/api`, which is the only process that can
 * decide what the credential means. An opaque token is also revoked the instant the grant is,
 * which a self-contained JWT could not be.
 */
export const oauthAccessTokens = pgTable(
    'oauth_access_tokens',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        tokenHash: bytea('token_hash').notNull(),
        grantId: uuid('grant_id').notNull(),
        clientId: varchar('client_id', { length: MAX_CLIENT_ID_LENGTH }).notNull(),
        userId: uuid('user_id').notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        scopes: jsonb('scopes').$type<string[]>().notNull(),
        expiresAt: timestamptz('expires_at').notNull(),
        lastUsedAt: timestamptz('last_used_at'),
        revokedAt: timestamptz('revoked_at'),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        uniqueIndex('oauth_access_tokens_token_hash_uidx').using(
            'btree',
            table.tokenHash.asc().nullsLast().op('bytea_ops'),
        ),
        index('oauth_access_tokens_grant_id_idx').using('btree', table.grantId.asc().nullsLast()),
        foreignKey({
            columns: [table.grantId],
            foreignColumns: [oauthGrants.id],
            name: 'oauth_access_tokens_grant_id_oauth_grants_id_fk',
        }).onDelete('cascade'),
    ],
);

/**
 * A refresh token. Rotated on every use: `consumed_at` marks the redeemed one, and redeeming it
 * twice means the token leaked, so the whole grant is revoked rather than a new pair issued
 * (RFC 9700 §4.14.2).
 */
export const oauthRefreshTokens = pgTable(
    'oauth_refresh_tokens',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        tokenHash: bytea('token_hash').notNull(),
        grantId: uuid('grant_id').notNull(),
        clientId: varchar('client_id', { length: MAX_CLIENT_ID_LENGTH }).notNull(),
        userId: uuid('user_id').notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        scopes: jsonb('scopes').$type<string[]>().notNull(),
        expiresAt: timestamptz('expires_at').notNull(),
        consumedAt: timestamptz('consumed_at'),
        revokedAt: timestamptz('revoked_at'),
        createdAt: timestamptz('created_at')
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        uniqueIndex('oauth_refresh_tokens_token_hash_uidx').using(
            'btree',
            table.tokenHash.asc().nullsLast().op('bytea_ops'),
        ),
        index('oauth_refresh_tokens_grant_id_idx').using('btree', table.grantId.asc().nullsLast()),
        foreignKey({
            columns: [table.grantId],
            foreignColumns: [oauthGrants.id],
            name: 'oauth_refresh_tokens_grant_id_oauth_grants_id_fk',
        }).onDelete('cascade'),
    ],
);
