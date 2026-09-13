import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractMcpTokenFromPath, generateMcpToken, hashMcpToken, McpTokenService } from './mcp-token.js';

const { mcpPersonalAccessTokens, user, workspaces } = schema;

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

async function insertUser(id: string) {
    await db.insert(user).values({ id, name: `User ${id}`, email: `${id}@example.com`, updatedAt: new Date() });
}

async function insertWorkspace(id: string) {
    await db.insert(workspaces).values({ id, name: `Workspace ${id}` });
}

async function insertToken(params: {
    id: string;
    userId: string;
    workspaceId: string;
    plain: string;
    revokedAt?: string | null;
}) {
    await db.insert(mcpPersonalAccessTokens).values({
        id: params.id,
        userId: params.userId,
        workspaceId: params.workspaceId,
        tokenHash: hashMcpToken(params.plain),
        revokedAt: params.revokedAt ?? null,
    });
}

describe('hashMcpToken', () => {
    it('matches an independently derived SHA-256 digest of a known string', () => {
        // Expected value derived via `python3 -c "import hashlib;
        // print(hashlib.sha256('known-test-token-value'.encode('utf-8')).hexdigest())"` and
        // cross-checked with `printf '%s' 'known-test-token-value' | openssl dgst -sha256 -hex`.
        // Neither path calls the function under test - the whole point of a known-answer test.
        const expectedHex = '2cd11ec8dfc65a1f86a84898705af36192e8ddaa73ecb463411bb9dc29c3be56';

        const actual = hashMcpToken('known-test-token-value');

        expect(actual).toBeInstanceOf(Buffer);
        expect(actual.toString('hex')).toBe(expectedHex);
        expect(actual).toHaveLength(32);
    });
});

describe('generateMcpToken', () => {
    it('produces unpadded base64url with no + or / and 32 bytes of entropy', () => {
        const token = generateMcpToken();

        expect(token).not.toMatch(/[+/=]/);
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

        // 32 bytes base64-encoded is 44 chars with padding ("====" -> one "=" here since 32 % 3 == 2
        // leaves one pad char); unpadded that's 43 chars.
        expect(token).toHaveLength(43);
    });

    it('produces distinct tokens on successive calls', () => {
        expect(generateMcpToken()).not.toBe(generateMcpToken());
    });
});

describe('validateMcpToken', () => {
    it('resolves a valid token to its user and pinned workspace', async () => {
        const userId = randomUUID();
        const workspaceId = randomUUID();
        const tokenId = randomUUID();
        const plain = generateMcpToken();

        await insertUser(userId);
        await insertWorkspace(workspaceId);
        await insertToken({ id: tokenId, userId, workspaceId, plain });

        const result = await mcpTokens.validateMcpToken(plain);

        expect(result).toEqual({ userId, workspaceId });
    });

    it('returns null for a revoked token', async () => {
        const userId = randomUUID();
        const workspaceId = randomUUID();
        const tokenId = randomUUID();
        const plain = generateMcpToken();

        await insertUser(userId);
        await insertWorkspace(workspaceId);
        await insertToken({ id: tokenId, userId, workspaceId, plain, revokedAt: new Date().toISOString() });

        const result = await mcpTokens.validateMcpToken(plain);

        expect(result).toBeNull();
    });

    it('returns null for an unknown token', async () => {
        const result = await mcpTokens.validateMcpToken(generateMcpToken());

        expect(result).toBeNull();
    });

    it('touches last_used_at on successful validation', async () => {
        const userId = randomUUID();
        const workspaceId = randomUUID();
        const tokenId = randomUUID();
        const plain = generateMcpToken();

        await insertUser(userId);
        await insertWorkspace(workspaceId);
        await insertToken({ id: tokenId, userId, workspaceId, plain });

        const before = await db
            .select({ lastUsedAt: mcpPersonalAccessTokens.lastUsedAt })
            .from(mcpPersonalAccessTokens)
            .where(eq(mcpPersonalAccessTokens.id, tokenId));
        expect(before[0].lastUsedAt).toBeNull();

        await mcpTokens.validateMcpToken(plain);

        const after = await db
            .select({ lastUsedAt: mcpPersonalAccessTokens.lastUsedAt })
            .from(mcpPersonalAccessTokens)
            .where(eq(mcpPersonalAccessTokens.id, tokenId));
        expect(after[0].lastUsedAt).not.toBeNull();
    });
});

describe('extractMcpTokenFromPath', () => {
    it('extracts the token from /mcp/{token}', () => {
        expect(extractMcpTokenFromPath('/mcp/abc123')).toBe('abc123');
    });

    it('extracts the token from /mcp/{token}/messages', () => {
        expect(extractMcpTokenFromPath('/mcp/abc123/messages')).toBe('abc123');
    });

    it('returns null for /mcp/ with no token segment', () => {
        expect(extractMcpTokenFromPath('/mcp/')).toBeNull();
    });

    it('returns null for an unrelated path', () => {
        expect(extractMcpTokenFromPath('/api/exercises')).toBeNull();
    });

    it('matches the mcp segment case-insensitively', () => {
        expect(extractMcpTokenFromPath('/MCP/abc123')).toBe('abc123');
        expect(extractMcpTokenFromPath('/Mcp/abc123/messages')).toBe('abc123');
    });

    it('collapses leading and doubled slashes', () => {
        expect(extractMcpTokenFromPath('//mcp//abc123//messages')).toBe('abc123');
    });

    it('returns null for a bare root path', () => {
        expect(extractMcpTokenFromPath('/')).toBeNull();
    });
});
