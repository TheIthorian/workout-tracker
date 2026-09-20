import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '@app/db';
import { schema } from '@app/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

const { oauthAccessTokens, oauthGrants } = schema;

/**
 * Generates an opaque credential: 32 random bytes, base64url-encoded. Used for access tokens,
 * refresh tokens and authorization codes alike — none of them carries a claim a client should read.
 */
export function generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 over the UTF-8 bytes of a credential, unsalted and uniterated — correct here because the
 * credential already carries 256 bits of entropy, so a slow KDF buys nothing and costs latency on
 * every request. Every `*_hash` column is `bytea`, so this returns a `Buffer`, never a hex or
 * base64 string: a string comparison against the column would silently never match.
 */
export function hashOpaqueToken(plain: string): Buffer {
    return createHash('sha256').update(plain, 'utf8').digest();
}

export type McpTokenValidationResult = {
    userId: string;
    workspaceId: string;
    clientId: string;
    scopes: string[];
};

/**
 * Validates the OAuth access tokens `apps/mcp` presents to `apps/api`. Kept as a class because it
 * both depends on `db` and writes `last_used_at` on every successful call.
 */
export class McpTokenService {
    private readonly db: Db;

    constructor({ db }: { db: Db }) {
        this.db = db;
    }

    /**
     * Validates a bearer access token and, on success, touches `last_used_at` on both the token and
     * the grant behind it.
     *
     * A token is only usable while its own row is unrevoked and unexpired AND the grant it was
     * issued under is unrevoked — revoking a connection from the Connected Apps screen writes one
     * row, and every credential issued under it has to stop working on that write alone.
     *
     * @returns the owning user, the workspace the grant is pinned to, and the client it was issued
     * to; `null` for an unknown, expired or revoked token.
     */
    async validateMcpToken(plain: string): Promise<McpTokenValidationResult | null> {
        const hash = hashOpaqueToken(plain);
        const now = new Date().toISOString();

        const rows = await this.db
            .select({
                id: oauthAccessTokens.id,
                grantId: oauthAccessTokens.grantId,
                userId: oauthAccessTokens.userId,
                workspaceId: oauthAccessTokens.workspaceId,
                clientId: oauthAccessTokens.clientId,
                scopes: oauthAccessTokens.scopes,
            })
            .from(oauthAccessTokens)
            .innerJoin(oauthGrants, eq(oauthGrants.id, oauthAccessTokens.grantId))
            .where(
                and(
                    eq(oauthAccessTokens.tokenHash, hash),
                    isNull(oauthAccessTokens.revokedAt),
                    isNull(oauthGrants.revokedAt),
                    gt(oauthAccessTokens.expiresAt, now),
                ),
            );

        const row = rows[0];
        if (!row) return null;

        await this.db.update(oauthAccessTokens).set({ lastUsedAt: now }).where(eq(oauthAccessTokens.id, row.id));
        await this.db
            .update(oauthGrants)
            .set({ lastUsedAt: now, updatedAt: sql`now()` })
            .where(eq(oauthGrants.id, row.grantId));

        return { userId: row.userId, workspaceId: row.workspaceId, clientId: row.clientId, scopes: row.scopes };
    }
}
