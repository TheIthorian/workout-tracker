import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateOpaqueToken, hashOpaqueToken, McpTokenService } from './oauth-token.js';

const { oauthAccessTokens, oauthGrants, user, workspaces } = schema;

const CLIENT_ID = 'https://client.example/oauth-client';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let mcpTokens: McpTokenService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    mcpTokens = new McpTokenService({ db });
});

afterAll(async () => {
    await database?.stop();
});

async function seedGrant(): Promise<{ userId: string; workspaceId: string; grantId: string }> {
    const userId = randomUUID();
    const workspaceId = randomUUID();

    await db.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com`, updatedAt: new Date() });
    await db.insert(workspaces).values({ id: workspaceId, name: `Workspace ${workspaceId}` });

    const [grant] = await db
        .insert(oauthGrants)
        .values({ userId, clientId: CLIENT_ID, workspaceId, scopes: ['mcp'] })
        .returning({ id: oauthGrants.id });

    return { userId, workspaceId, grantId: grant.id };
}

async function issueToken({
    grantId,
    userId,
    workspaceId,
    expiresAt = new Date(Date.now() + 60_000).toISOString(),
    revokedAt = null,
}: {
    grantId: string;
    userId: string;
    workspaceId: string;
    expiresAt?: string;
    revokedAt?: string | null;
}): Promise<string> {
    const token = generateOpaqueToken();

    await db.insert(oauthAccessTokens).values({
        tokenHash: hashOpaqueToken(token),
        grantId,
        clientId: CLIENT_ID,
        userId,
        workspaceId,
        scopes: ['mcp'],
        expiresAt,
        revokedAt,
    });

    return token;
}

describe('generateOpaqueToken', () => {
    it('produces url-safe credentials that never repeat', () => {
        const first = generateOpaqueToken();
        const second = generateOpaqueToken();

        expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(first).not.toBe(second);
    });
});

describe('hashOpaqueToken', () => {
    it('returns the 32 raw bytes the bytea columns store, not a string', () => {
        const hash = hashOpaqueToken('a-token');

        expect(Buffer.isBuffer(hash)).toBe(true);
        expect(hash).toHaveLength(32);
        expect(hash.equals(hashOpaqueToken('a-token'))).toBe(true);
        expect(hash.equals(hashOpaqueToken('another-token'))).toBe(false);
    });
});

describe('McpTokenService.validateMcpToken', () => {
    it('resolves a live token to its user, workspace and client', async () => {
        const grant = await seedGrant();
        const token = await issueToken(grant);

        await expect(mcpTokens.validateMcpToken(token)).resolves.toEqual({
            userId: grant.userId,
            workspaceId: grant.workspaceId,
            clientId: CLIENT_ID,
            scopes: ['mcp'],
        });
    });

    it('touches last_used_at on the token and the grant', async () => {
        const grant = await seedGrant();
        const token = await issueToken(grant);

        await mcpTokens.validateMcpToken(token);

        const [row] = await db
            .select({ lastUsedAt: oauthAccessTokens.lastUsedAt })
            .from(oauthAccessTokens)
            .where(eq(oauthAccessTokens.tokenHash, hashOpaqueToken(token)));
        const [grantRow] = await db
            .select({ lastUsedAt: oauthGrants.lastUsedAt })
            .from(oauthGrants)
            .where(eq(oauthGrants.id, grant.grantId));

        expect(row.lastUsedAt).not.toBeNull();
        expect(grantRow.lastUsedAt).not.toBeNull();
    });

    it('refuses an unknown token', async () => {
        await expect(mcpTokens.validateMcpToken(generateOpaqueToken())).resolves.toBeNull();
    });

    it('refuses an expired token', async () => {
        const grant = await seedGrant();
        const token = await issueToken({ ...grant, expiresAt: new Date(Date.now() - 1_000).toISOString() });

        await expect(mcpTokens.validateMcpToken(token)).resolves.toBeNull();
    });

    it('refuses a revoked token', async () => {
        const grant = await seedGrant();
        const token = await issueToken({ ...grant, revokedAt: new Date().toISOString() });

        await expect(mcpTokens.validateMcpToken(token)).resolves.toBeNull();
    });

    it('refuses a live token whose grant was revoked, without touching the token row', async () => {
        const grant = await seedGrant();
        const token = await issueToken(grant);

        await db
            .update(oauthGrants)
            .set({ revokedAt: new Date().toISOString() })
            .where(eq(oauthGrants.id, grant.grantId));

        await expect(mcpTokens.validateMcpToken(token)).resolves.toBeNull();
    });
});
