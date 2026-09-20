import { createHash, randomUUID } from 'node:crypto';
import { CodeChallengeMethod, OAuthErrorCode, OAuthGrantType } from '@app/api-contract';
import { generateOpaqueToken, hashOpaqueToken } from '@app/auth';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { OAuthProtocolError } from '@app/errors';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OAuthTokensService } from './oauth-tokens.service.js';

const { oauthAccessTokens, oauthAuthorizationCodes, oauthGrants, oauthRefreshTokens, user, workspaces } = schema;

const CLIENT_ID = 'https://client.test/oauth-client';
const REDIRECT_URI = 'https://client.test/callback';
const VERIFIER = 'a-code-verifier-with-enough-entropy-to-be-real';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let tokens: OAuthTokensService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    tokens = new OAuthTokensService({ db });
});

afterAll(async () => {
    await database?.stop();
});

type Grant = { grantId: string; userId: string; workspaceId: string };

async function seedGrant(): Promise<Grant> {
    const userId = randomUUID();
    const workspaceId = randomUUID();

    await db.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com`, updatedAt: new Date() });
    await db.insert(workspaces).values({ id: workspaceId, name: `Workspace ${workspaceId}` });

    const [grant] = await db
        .insert(oauthGrants)
        .values({ userId, clientId: CLIENT_ID, workspaceId, scopes: ['mcp'] })
        .returning({ id: oauthGrants.id });

    return { grantId: grant.id, userId, workspaceId };
}

async function issueCode(
    grant: Grant,
    { expiresAt = new Date(Date.now() + 60_000).toISOString() }: { expiresAt?: string } = {},
): Promise<string> {
    const code = generateOpaqueToken();

    await db.insert(oauthAuthorizationCodes).values({
        codeHash: hashOpaqueToken(code),
        grantId: grant.grantId,
        clientId: CLIENT_ID,
        userId: grant.userId,
        workspaceId: grant.workspaceId,
        redirectUri: REDIRECT_URI,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: CodeChallengeMethod.S256,
        scopes: ['mcp'],
        expiresAt,
    });

    return code;
}

function redeem(code: string, overrides: Record<string, string> = {}): Promise<unknown> {
    return tokens.exchange({
        request: {
            grant_type: OAuthGrantType.AuthorizationCode,
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: VERIFIER,
            client_id: CLIENT_ID,
            ...overrides,
        },
    });
}

async function expectInvalidGrant(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(OAuthProtocolError);
    await promise.catch((error: OAuthProtocolError) => {
        expect(error.oauthError).toBe(OAuthErrorCode.InvalidGrant);
    });
}

describe('OAuthTokensService authorization_code grant', () => {
    it('exchanges a valid code for an access and refresh token pair', async () => {
        const grant = await seedGrant();
        const code = await issueCode(grant);

        await expect(redeem(code)).resolves.toMatchObject({
            token_type: 'Bearer',
            scope: 'mcp',
            access_token: expect.any(String),
            refresh_token: expect.any(String),
        });
    });

    it('refuses a code_verifier that does not match the challenge', async () => {
        const grant = await seedGrant();
        const code = await issueCode(grant);

        await expectInvalidGrant(redeem(code, { code_verifier: `${VERIFIER}x` }));
    });

    it('refuses a redirect_uri or client_id that differs from the authorization request', async () => {
        const grant = await seedGrant();

        await expectInvalidGrant(redeem(await issueCode(grant), { redirect_uri: 'https://client.test/other' }));
        await expectInvalidGrant(redeem(await issueCode(grant), { client_id: 'https://other.test/oauth-client' }));
    });

    it('refuses an expired code', async () => {
        const grant = await seedGrant();
        const code = await issueCode(grant, { expiresAt: new Date(Date.now() - 1_000).toISOString() });

        await expectInvalidGrant(redeem(code));
    });

    it('refuses an unknown code', async () => {
        await expectInvalidGrant(redeem(generateOpaqueToken()));
    });

    // RFC 6749 §4.1.2: a second redemption means the code leaked, so everything the first
    // redemption issued has to stop working rather than the replay merely being refused.
    it('revokes the whole grant when a code is replayed', async () => {
        const grant = await seedGrant();
        const code = await issueCode(grant);
        await redeem(code);

        await expectInvalidGrant(redeem(code));

        const [grantRow] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.grantId));
        const [accessRow] = await db
            .select()
            .from(oauthAccessTokens)
            .where(eq(oauthAccessTokens.grantId, grant.grantId));

        expect(grantRow.revokedAt).not.toBeNull();
        expect(accessRow.revokedAt).not.toBeNull();
    });
});

describe('OAuthTokensService refresh_token grant', () => {
    async function connect(): Promise<{ grant: Grant; refreshToken: string }> {
        const grant = await seedGrant();
        const issued = (await redeem(await issueCode(grant))) as { refresh_token: string };

        return { grant, refreshToken: issued.refresh_token };
    }

    it('rotates the refresh token', async () => {
        const { refreshToken } = await connect();

        const refreshed = (await tokens.exchange({
            request: { grant_type: OAuthGrantType.RefreshToken, refresh_token: refreshToken, client_id: CLIENT_ID },
        })) as { refresh_token: string };

        expect(refreshed.refresh_token).not.toBe(refreshToken);
    });

    // RFC 9700 §4.14.2: reuse of a rotated refresh token is the signal that it leaked.
    it('revokes the whole grant when a rotated refresh token is presented again', async () => {
        const { grant, refreshToken } = await connect();
        await tokens.exchange({
            request: { grant_type: OAuthGrantType.RefreshToken, refresh_token: refreshToken, client_id: CLIENT_ID },
        });

        await expectInvalidGrant(
            tokens.exchange({
                request: { grant_type: OAuthGrantType.RefreshToken, refresh_token: refreshToken, client_id: CLIENT_ID },
            }),
        );

        const [grantRow] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.grantId));
        expect(grantRow.revokedAt).not.toBeNull();
    });

    it('refuses a refresh token issued to another client', async () => {
        const { refreshToken } = await connect();

        await expectInvalidGrant(
            tokens.exchange({
                request: {
                    grant_type: OAuthGrantType.RefreshToken,
                    refresh_token: refreshToken,
                    client_id: 'https://other.test/oauth-client',
                },
            }),
        );
    });

    it('refuses a refresh token whose grant the user disconnected', async () => {
        const { grant, refreshToken } = await connect();
        await db
            .update(oauthGrants)
            .set({ revokedAt: new Date().toISOString() })
            .where(eq(oauthGrants.id, grant.grantId));

        await expectInvalidGrant(
            tokens.exchange({
                request: { grant_type: OAuthGrantType.RefreshToken, refresh_token: refreshToken, client_id: CLIENT_ID },
            }),
        );
    });

    it('refuses an unsupported grant type', async () => {
        await expect(tokens.exchange({ request: { grant_type: 'client_credentials' } })).rejects.toMatchObject({
            oauthError: OAuthErrorCode.UnsupportedGrantType,
        });
    });
});

describe('OAuthTokensService.revoke', () => {
    it('revoking a refresh token takes the grant and its access tokens with it', async () => {
        const grant = await seedGrant();
        const issued = (await redeem(await issueCode(grant))) as { refresh_token: string };

        await tokens.revoke({ token: issued.refresh_token });

        const [grantRow] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.grantId));
        const [accessRow] = await db
            .select()
            .from(oauthAccessTokens)
            .where(eq(oauthAccessTokens.grantId, grant.grantId));
        const [refreshRow] = await db
            .select()
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.grantId, grant.grantId));

        expect(grantRow.revokedAt).not.toBeNull();
        expect(accessRow.revokedAt).not.toBeNull();
        expect(refreshRow.revokedAt).not.toBeNull();
    });

    it('revoking an access token leaves the grant alone', async () => {
        const grant = await seedGrant();
        const issued = (await redeem(await issueCode(grant))) as { access_token: string };

        await tokens.revoke({ token: issued.access_token });

        const [grantRow] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.grantId));
        const [accessRow] = await db
            .select()
            .from(oauthAccessTokens)
            .where(eq(oauthAccessTokens.grantId, grant.grantId));

        expect(grantRow.revokedAt).toBeNull();
        expect(accessRow.revokedAt).not.toBeNull();
    });

    // Answering differently for an unknown token would make this an oracle for guessing valid ones.
    it('succeeds for a token that never existed', async () => {
        await expect(tokens.revoke({ token: generateOpaqueToken() })).resolves.toBeUndefined();
    });
});
