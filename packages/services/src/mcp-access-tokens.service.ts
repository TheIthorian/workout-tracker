import { randomUUID } from 'node:crypto';
import { generateMcpToken, hashMcpToken } from '@app/auth';
import { schema, type Db } from '@app/db';
import { EntityNotFoundError } from '@app/errors';
import { and, desc, eq } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { mcpPersonalAccessTokens } = schema;

export type McpAccessTokenListItem = {
    id: string;
    workspaceId: string;
    name: string | null;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
};

export type McpAccessTokenCreationResult = {
    id: string;
    workspaceId: string;
    /** The plaintext token. Returned exactly once - never persisted, logged, or printed. */
    token: string;
};

/**
 * Issues and revokes the personal access tokens `apps/mcp` authenticates with. Every method takes
 * the already-resolved `userId` from a valid session — none of them re-checks authentication.
 */
export class McpAccessTokensService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * Generates an opaque token pinned to one workspace, stores its sha256 hash, and returns the
     * plaintext once.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace — otherwise a
     * token could be minted for a workspace the caller cannot see.
     */
    async createToken({
        userId,
        workspaceId,
        name,
    }: {
        userId: string;
        workspaceId: string;
        name: string | null;
    }): Promise<McpAccessTokenCreationResult> {
        await this.membership.require({ userId, workspaceId });

        const token = generateMcpToken();
        const tokenHash = hashMcpToken(token);
        const id = randomUUID();

        await this.db.insert(mcpPersonalAccessTokens).values({ id, userId, workspaceId, tokenHash, name });

        return { id, workspaceId, token };
    }

    /** Every token for the caller, newest first, including revoked ones. Never returns a token value. */
    async listTokens(userId: string): Promise<McpAccessTokenListItem[]> {
        return this.db
            .select({
                id: mcpPersonalAccessTokens.id,
                workspaceId: mcpPersonalAccessTokens.workspaceId,
                name: mcpPersonalAccessTokens.name,
                createdAt: mcpPersonalAccessTokens.createdAt,
                lastUsedAt: mcpPersonalAccessTokens.lastUsedAt,
                revokedAt: mcpPersonalAccessTokens.revokedAt,
            })
            .from(mcpPersonalAccessTokens)
            .where(eq(mcpPersonalAccessTokens.userId, userId))
            .orderBy(desc(mcpPersonalAccessTokens.createdAt));
    }

    /**
     * Marks a token belonging to the caller as revoked.
     *
     * @throws EntityNotFoundError when the token does not exist or belongs to a different user —
     * the two cases are deliberately indistinguishable on the wire.
     */
    async revokeToken({ userId, tokenId }: { userId: string; tokenId: string }): Promise<void> {
        const [row] = await this.db
            .select({ id: mcpPersonalAccessTokens.id })
            .from(mcpPersonalAccessTokens)
            .where(and(eq(mcpPersonalAccessTokens.userId, userId), eq(mcpPersonalAccessTokens.id, tokenId)));

        if (!row) throw new EntityNotFoundError('Token not found');

        await this.db
            .update(mcpPersonalAccessTokens)
            .set({ revokedAt: new Date().toISOString() })
            .where(eq(mcpPersonalAccessTokens.id, tokenId));
    }
}
