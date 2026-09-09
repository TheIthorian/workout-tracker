import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '@app/db';
import { schema } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';

const { mcpPersonalAccessTokens } = schema;

/**
 * Generates an opaque MCP personal access token: 32 random bytes, base64url-encoded with the `=`
 * padding stripped.
 */
export function generateMcpToken(): string {
    return randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * SHA-256 over the UTF-8 bytes of the plaintext token, unsalted and uniterated - correct here
 * because the token already carries 256 bits of entropy, so a slow KDF buys nothing and costs
 * latency on every request. `token_hash` is `bytea`, so this returns a `Buffer`, never a hex or
 * base64 string - a string comparison against the column would silently never match.
 */
export function hashMcpToken(plain: string): Buffer {
    return createHash('sha256').update(plain, 'utf8').digest();
}

export type McpTokenValidationResult = {
    userId: string;
    workspaceId: string;
};

/**
 * Validates plaintext MCP tokens against `mcp_personal_access_tokens`. Kept as a class - unlike
 * {@link generateMcpToken}, {@link hashMcpToken} and {@link extractMcpTokenFromPath}, which are
 * pure and stay plain functions - because `validateMcpToken` both depends on `db` and writes
 * `last_used_at` on every successful call.
 */
export class McpTokenService {
    private readonly db: Db;

    constructor({ db }: { db: Db }) {
        this.db = db;
    }

    /**
     * Validates a plaintext MCP token and, on success, touches `last_used_at`.
     *
     * @returns the owning user and the workspace the token is pinned to, or `null` for an unknown
     * or revoked token.
     */
    async validateMcpToken(plain: string): Promise<McpTokenValidationResult | null> {
        const hash = hashMcpToken(plain);

        const rows = await this.db
            .select({
                id: mcpPersonalAccessTokens.id,
                userId: mcpPersonalAccessTokens.userId,
                workspaceId: mcpPersonalAccessTokens.workspaceId,
            })
            .from(mcpPersonalAccessTokens)
            .where(and(eq(mcpPersonalAccessTokens.tokenHash, hash), isNull(mcpPersonalAccessTokens.revokedAt)));

        const row = rows[0];
        if (!row) return null;

        await this.db
            .update(mcpPersonalAccessTokens)
            .set({ lastUsedAt: new Date().toISOString() })
            .where(eq(mcpPersonalAccessTokens.id, row.id));

        return { userId: row.userId, workspaceId: row.workspaceId };
    }
}

/**
 * Extracts the MCP personal access token from a request path: the first segment after `/mcp/`,
 * e.g. `/mcp/{token}` or `/mcp/{token}/messages`. Leading and doubled slashes collapse, and the
 * `mcp` segment matches case-insensitively.
 */
export function extractMcpTokenFromPath(path: string): string | null {
    const segments = path.split('/').filter((segment) => segment.length > 0);
    if (segments.length < 2 || segments[0].toLowerCase() !== 'mcp') return null;

    const token = segments[1];
    return token.length > 0 ? token : null;
}
