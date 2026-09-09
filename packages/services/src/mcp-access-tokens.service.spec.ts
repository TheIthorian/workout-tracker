import { randomUUID } from 'node:crypto';
import { hashMcpToken } from '@app/auth';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { EntityNotFoundError } from '@app/errors';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpAccessTokensService } from './mcp-access-tokens.service.js';
import { seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

const { mcpPersonalAccessTokens } = schema;

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let tokens: McpAccessTokensService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    tokens = new McpAccessTokensService({ db, membership: new WorkspaceMembershipService({ db }) });
});

afterAll(async () => {
    await database?.stop();
});

describe('createToken', () => {
    it('returns the plaintext once and stores only its hash', async () => {
        const { userId, workspaceId } = await seedOwner();

        const { id, token } = await tokens.createToken({ userId, workspaceId, name: 'laptop' });

        const [row] = await db.select().from(mcpPersonalAccessTokens).where(eq(mcpPersonalAccessTokens.id, id));

        expect(row.name).toBe('laptop');
        expect(row.tokenHash).toEqual(hashMcpToken(token));
        // The plaintext must be nowhere in the row.
        expect(JSON.stringify(row)).not.toContain(token);
    });

    it('accepts a null name', async () => {
        const { userId, workspaceId } = await seedOwner();

        const { id } = await tokens.createToken({ userId, workspaceId, name: null });

        const [row] = await db.select().from(mcpPersonalAccessTokens).where(eq(mcpPersonalAccessTokens.id, id));
        expect(row.name).toBeNull();
    });
});

describe('listTokens', () => {
    it("returns the caller's tokens newest first, without any token value", async () => {
        const { userId, workspaceId } = await seedOwner();
        await tokens.createToken({ userId, workspaceId, name: 'first' });
        await tokens.createToken({ userId, workspaceId, name: 'second' });

        const listed = await tokens.listTokens(userId);

        expect(listed.map((t) => t.name)).toEqual(['second', 'first']);
        expect(listed[0]).not.toHaveProperty('token');
        expect(listed[0]).not.toHaveProperty('tokenHash');
    });

    it("never returns another user's tokens", async () => {
        const { userId } = await seedOwner();
        const other = await seedOwner();
        await tokens.createToken({ userId: other.userId, workspaceId: other.workspaceId, name: 'theirs' });

        expect(await tokens.listTokens(userId)).toEqual([]);
    });

    it('includes revoked tokens', async () => {
        const { userId, workspaceId } = await seedOwner();
        const { id } = await tokens.createToken({ userId, workspaceId, name: 'revoked' });

        await tokens.revokeToken({ userId, tokenId: id });

        const [listed] = await tokens.listTokens(userId);
        expect(listed.revokedAt).not.toBeNull();
    });
});

describe('revokeToken', () => {
    it('throws EntityNotFoundError for an unknown token', async () => {
        const { userId } = await seedOwner();

        await expect(tokens.revokeToken({ userId, tokenId: randomUUID() })).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it("refuses to revoke another user's token, and leaves it active", async () => {
        const { userId } = await seedOwner();
        const other = await seedOwner();
        const { id } = await tokens.createToken({
            userId: other.userId,
            workspaceId: other.workspaceId,
            name: 'theirs',
        });

        await expect(tokens.revokeToken({ userId, tokenId: id })).rejects.toBeInstanceOf(EntityNotFoundError);

        const [row] = await db.select().from(mcpPersonalAccessTokens).where(eq(mcpPersonalAccessTokens.id, id));
        expect(row.revokedAt).toBeNull();
    });
});

/** A user with a workspace they own, which is what a token can be pinned to. */
async function seedOwner(): Promise<{ userId: string; workspaceId: string }> {
    const userId = await seedUser(db);
    return { userId, workspaceId: await seedWorkspace(db, userId) };
}
