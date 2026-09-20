import type { ConnectedAppResponse } from '@app/api-contract';
import { schema, withTransaction, type Db } from '@app/db';
import { EntityNotFoundError } from '@app/errors';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { isVerifiedClientId } from './client-id.js';

const { oauthAccessTokens, oauthClients, oauthGrants, oauthRefreshTokens } = schema;

/**
 * The connections a user has approved, and the one control they have over them. This is what
 * replaced issuing personal access tokens: a user never sees a credential, so the thing they manage
 * is the app they said yes to.
 */
export class ConnectedAppsService {
    private readonly db: Db;
    private readonly verifiedClientIds: string[];

    constructor({ db, verifiedClientIds }: { db: Db; verifiedClientIds: string[] }) {
        this.db = db;
        this.verifiedClientIds = verifiedClientIds;
    }

    /** Every app the user has connected and not disconnected, most recently approved first. */
    async list({ userId }: { userId: string }): Promise<ConnectedAppResponse[]> {
        const rows = await this.db
            .select({
                clientId: oauthGrants.clientId,
                clientName: oauthClients.clientName,
                clientUri: oauthClients.clientUri,
                logoUri: oauthClients.logoUri,
                scopes: oauthGrants.scopes,
                connectedAt: oauthGrants.createdAt,
                lastUsedAt: oauthGrants.lastUsedAt,
            })
            .from(oauthGrants)
            .leftJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
            .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
            .orderBy(desc(oauthGrants.createdAt));

        return rows.map((row) => ({
            ...row,
            clientName: row.clientName ?? hostOf(row.clientId),
            clientUri: row.clientUri,
            logoUri: row.logoUri,
            verified: isVerifiedClientId({ clientId: row.clientId, verifiedClientIds: this.verifiedClientIds }),
        }));
    }

    /**
     * Disconnects an app: the grant and every credential issued under it stop working at once.
     *
     * @throws EntityNotFoundError when the user has no live grant for that client — a client id
     * someone else connected must not be distinguishable from one nobody has.
     */
    async disconnect({ userId, clientId }: { userId: string; clientId: string }): Promise<void> {
        const [grant] = await this.db
            .select({ id: oauthGrants.id })
            .from(oauthGrants)
            .where(
                and(eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, clientId), isNull(oauthGrants.revokedAt)),
            );

        if (!grant) throw new EntityNotFoundError('Connection not found');

        const now = new Date().toISOString();

        await withTransaction(this.db, async (tx): Promise<void> => {
            await tx.update(oauthGrants).set({ revokedAt: now, updatedAt: now }).where(eq(oauthGrants.id, grant.id));
            await tx
                .update(oauthAccessTokens)
                .set({ revokedAt: now })
                .where(and(eq(oauthAccessTokens.grantId, grant.id), isNull(oauthAccessTokens.revokedAt)));
            await tx
                .update(oauthRefreshTokens)
                .set({ revokedAt: now })
                .where(and(eq(oauthRefreshTokens.grantId, grant.id), isNull(oauthRefreshTokens.revokedAt)));
        });
    }
}

function hostOf(clientId: string): string {
    return URL.canParse(clientId) ? new URL(clientId).hostname : clientId;
}
