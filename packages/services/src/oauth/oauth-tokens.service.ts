import { OAuthErrorCode, type OAuthTokenRequest, type OAuthTokenResponse } from '@app/api-contract';
import { generateOpaqueToken, hashOpaqueToken } from '@app/auth';
import { schema, withTransaction, type Db, type Tx } from '@app/db';
import { OAuthProtocolError } from '@app/errors';
import { and, eq, isNull } from 'drizzle-orm';
import { isSupportedCodeChallengeMethod, verifyCodeChallenge } from './pkce.js';

const { oauthAccessTokens, oauthAuthorizationCodes, oauthGrants, oauthRefreshTokens } = schema;

/** How long an access token lives. Short, because a refresh token replaces it without a browser. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** How long a refresh token lives, and therefore how long an idle connection survives. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 60;

/**
 * The token endpoint's logic: redeeming an authorization code, rotating a refresh token, and
 * revoking either.
 *
 * Both redemptions are single-use and detect replay the same way: the redeemed row is marked
 * consumed rather than deleted, and a second presentation of a consumed credential revokes the
 * whole grant (RFC 6749 §4.1.2, RFC 9700 §4.14.2). A leaked credential therefore costs the attacker
 * the connection rather than buying them one.
 */
export class OAuthTokensService {
    private readonly db: Db;

    constructor({ db }: { db: Db }) {
        this.db = db;
    }

    /** Dispatches on `grant_type`. */
    async exchange({ request }: { request: OAuthTokenRequest }): Promise<OAuthTokenResponse> {
        switch (request.grant_type) {
            case 'authorization_code':
                return this.exchangeAuthorizationCode({ request });
            case 'refresh_token':
                return this.refresh({ request });
            default:
                throw new OAuthProtocolError(
                    OAuthErrorCode.UnsupportedGrantType,
                    `grant_type ${request.grant_type} is not supported.`,
                );
        }
    }

    /**
     * Revokes a presented credential (RFC 7009). Revoking a refresh token takes the whole grant
     * with it, as §2.1 permits and as a user disconnecting a client expects.
     *
     * Always succeeds: an unknown token is already not usable, and saying so would turn this into
     * an oracle for guessing valid ones.
     */
    async revoke({ token }: { token: string }): Promise<void> {
        const hash = hashOpaqueToken(token);
        const now = new Date().toISOString();

        const [refresh] = await this.db
            .select({ grantId: oauthRefreshTokens.grantId })
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.tokenHash, hash));

        if (refresh) {
            await this.revokeGrant({ db: this.db, grantId: refresh.grantId });

            return;
        }

        await this.db.update(oauthAccessTokens).set({ revokedAt: now }).where(eq(oauthAccessTokens.tokenHash, hash));
    }

    private async exchangeAuthorizationCode({ request }: { request: OAuthTokenRequest }): Promise<OAuthTokenResponse> {
        if (!request.code || !request.code_verifier) {
            throw new OAuthProtocolError(OAuthErrorCode.InvalidRequest, 'code and code_verifier are both required.');
        }

        const [row] = await this.db
            .select()
            .from(oauthAuthorizationCodes)
            .where(eq(oauthAuthorizationCodes.codeHash, hashOpaqueToken(request.code)));

        if (!row) throw invalidGrant('The authorization code is unknown.');

        if (row.consumedAt !== null) {
            await this.revokeGrant({ db: this.db, grantId: row.grantId });

            throw invalidGrant('The authorization code has already been used.');
        }

        if (new Date(row.expiresAt).getTime() <= Date.now()) throw invalidGrant('The authorization code has expired.');

        if (request.client_id !== undefined && request.client_id !== row.clientId) {
            throw invalidGrant('The authorization code was issued to a different client.');
        }

        if (request.redirect_uri !== undefined && request.redirect_uri !== row.redirectUri) {
            throw invalidGrant('redirect_uri does not match the authorization request.');
        }

        if (!isSupportedCodeChallengeMethod(row.codeChallengeMethod)) {
            throw invalidGrant('The authorization code carries an unsupported code_challenge_method.');
        }

        const verified = verifyCodeChallenge({
            codeVerifier: request.code_verifier,
            codeChallenge: row.codeChallenge,
            codeChallengeMethod: row.codeChallengeMethod,
        });

        if (!verified) throw invalidGrant('code_verifier does not match the code_challenge.');

        return withTransaction(this.db, async (tx): Promise<OAuthTokenResponse> => {
            const consumed = await tx
                .update(oauthAuthorizationCodes)
                .set({ consumedAt: new Date().toISOString() })
                .where(and(eq(oauthAuthorizationCodes.id, row.id), isNull(oauthAuthorizationCodes.consumedAt)))
                .returning({ id: oauthAuthorizationCodes.id });

            // Lost the race against a concurrent redemption of the same code.
            if (consumed.length === 0) throw invalidGrant('The authorization code has already been used.');

            return this.issueTokens({
                tx,
                grantId: row.grantId,
                clientId: row.clientId,
                userId: row.userId,
                workspaceId: row.workspaceId,
                scopes: row.scopes,
            });
        });
    }

    private async refresh({ request }: { request: OAuthTokenRequest }): Promise<OAuthTokenResponse> {
        if (!request.refresh_token) {
            throw new OAuthProtocolError(OAuthErrorCode.InvalidRequest, 'refresh_token is required.');
        }

        const [row] = await this.db
            .select()
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.tokenHash, hashOpaqueToken(request.refresh_token)));

        if (!row) throw invalidGrant('The refresh token is unknown.');

        if (row.consumedAt !== null) {
            await this.revokeGrant({ db: this.db, grantId: row.grantId });

            throw invalidGrant('The refresh token has already been used.');
        }

        if (row.revokedAt !== null) throw invalidGrant('The refresh token has been revoked.');

        if (new Date(row.expiresAt).getTime() <= Date.now()) throw invalidGrant('The refresh token has expired.');

        if (request.client_id !== undefined && request.client_id !== row.clientId) {
            throw invalidGrant('The refresh token was issued to a different client.');
        }

        const [grant] = await this.db
            .select({ id: oauthGrants.id })
            .from(oauthGrants)
            .where(and(eq(oauthGrants.id, row.grantId), isNull(oauthGrants.revokedAt)));

        if (!grant) throw invalidGrant('The connection this token belongs to has been disconnected.');

        return withTransaction(this.db, async (tx): Promise<OAuthTokenResponse> => {
            const consumed = await tx
                .update(oauthRefreshTokens)
                .set({ consumedAt: new Date().toISOString() })
                .where(and(eq(oauthRefreshTokens.id, row.id), isNull(oauthRefreshTokens.consumedAt)))
                .returning({ id: oauthRefreshTokens.id });

            if (consumed.length === 0) throw invalidGrant('The refresh token has already been used.');

            return this.issueTokens({
                tx,
                grantId: row.grantId,
                clientId: row.clientId,
                userId: row.userId,
                workspaceId: row.workspaceId,
                scopes: row.scopes,
            });
        });
    }

    private async issueTokens({
        tx,
        grantId,
        clientId,
        userId,
        workspaceId,
        scopes,
    }: {
        tx: Tx;
        grantId: string;
        clientId: string;
        userId: string;
        workspaceId: string;
        scopes: string[];
    }): Promise<OAuthTokenResponse> {
        const accessToken = generateOpaqueToken();
        const refreshToken = generateOpaqueToken();
        const issued = { grantId, clientId, userId, workspaceId, scopes };

        await tx.insert(oauthAccessTokens).values({
            ...issued,
            tokenHash: hashOpaqueToken(accessToken),
            expiresAt: expiryFromNow(ACCESS_TOKEN_TTL_SECONDS),
        });

        await tx.insert(oauthRefreshTokens).values({
            ...issued,
            tokenHash: hashOpaqueToken(refreshToken),
            expiresAt: expiryFromNow(REFRESH_TOKEN_TTL_SECONDS),
        });

        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: ACCESS_TOKEN_TTL_SECONDS,
            refresh_token: refreshToken,
            scope: scopes.join(' '),
        };
    }

    private async revokeGrant({ db, grantId }: { db: Db; grantId: string }): Promise<void> {
        const now = new Date().toISOString();

        await withTransaction(db, async (tx): Promise<void> => {
            await tx.update(oauthGrants).set({ revokedAt: now, updatedAt: now }).where(eq(oauthGrants.id, grantId));
            await tx
                .update(oauthAccessTokens)
                .set({ revokedAt: now })
                .where(and(eq(oauthAccessTokens.grantId, grantId), isNull(oauthAccessTokens.revokedAt)));
            await tx
                .update(oauthRefreshTokens)
                .set({ revokedAt: now })
                .where(and(eq(oauthRefreshTokens.grantId, grantId), isNull(oauthRefreshTokens.revokedAt)));
        });
    }
}

function expiryFromNow(seconds: number): string {
    return new Date(Date.now() + seconds * 1000).toISOString();
}

function invalidGrant(description: string): OAuthProtocolError {
    return new OAuthProtocolError(OAuthErrorCode.InvalidGrant, description);
}
