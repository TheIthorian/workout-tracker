import {
    CodeChallengeMethod,
    McpScope,
    OAuthErrorCode,
    OAuthResponseType,
    type OAuthAuthorizeQuery,
    type OAuthConsentRequestResponse,
} from '@app/api-contract';
import { generateOpaqueToken, hashOpaqueToken } from '@app/auth';
import { schema, withTransaction, type Db } from '@app/db';
import { EntityNotFoundError, OAuthProtocolError } from '@app/errors';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { WorkspaceMembershipService } from '../workspace-membership.service.js';
import { isSupportedCodeChallengeMethod } from './pkce.js';
import { isRedirectUriPermitted } from './redirect-uri.js';
import type { OAuthClientsService, ResolvedOAuthClient } from './oauth-clients.service.js';

const { oauthAuthorizationCodes, oauthAuthorizationRequests, oauthGrants } = schema;

/** How long a user has to finish the consent screen before the client must start over. */
export const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;

/** How long an issued authorization code stays redeemable. RFC 9700 §2.1.1 asks for a short life. */
export const AUTHORIZATION_CODE_TTL_MS = 60 * 1000;

export enum AuthorizationOutcomeKind {
    /** The request is well-formed; send the browser to the consent screen. */
    Consent = 'consent',
    /** Nothing about the client can be trusted, so the failure is shown to the user instead. */
    ClientError = 'client_error',
    /** The client is known and its redirect_uri registered, so the failure goes back to it. */
    RedirectError = 'redirect_error',
}

export type AuthorizationOutcome =
    | { kind: AuthorizationOutcomeKind.Consent; requestId: string }
    | { kind: AuthorizationOutcomeKind.ClientError; code: OAuthErrorCode; description: string }
    | { kind: AuthorizationOutcomeKind.RedirectError; code: OAuthErrorCode; redirectTo: string };

/**
 * The authorization endpoint's logic: validating a request, holding it while the user decides, and
 * turning an approval into a single-use code.
 *
 * Which failures reach the client and which are shown to the user is the load-bearing part.
 * `redirect_uri` is what an error response is sent to, so until the client is resolved and that URI
 * proven to be one it registered, an error redirect would be an open redirect with this server's
 * name on it (RFC 6749 §4.1.2.1). Everything after that point redirects.
 */
export class OAuthAuthorizationService {
    private readonly db: Db;
    private readonly clients: OAuthClientsService;
    private readonly membership: WorkspaceMembershipService;
    private readonly issuer: string;

    constructor({
        db,
        clients,
        membership,
        issuer,
    }: {
        db: Db;
        clients: OAuthClientsService;
        membership: WorkspaceMembershipService;
        issuer: string;
    }) {
        this.db = db;
        this.clients = clients;
        this.membership = membership;
        this.issuer = issuer;
    }

    /** Validates an authorization request and records it for the consent screen to read. */
    async begin({ query }: { query: OAuthAuthorizeQuery }): Promise<AuthorizationOutcome> {
        if (!query.client_id) {
            return clientError(OAuthErrorCode.InvalidRequest, 'The client did not send a client_id.');
        }

        const resolution = await this.clients.resolve({ clientId: query.client_id });

        if (!resolution.ok) return clientError(resolution.code, resolution.description);

        const redirectUri = resolveRedirectUri({ client: resolution.client, requested: query.redirect_uri });

        if (!redirectUri) {
            return clientError(
                OAuthErrorCode.InvalidRequest,
                'The redirect_uri is not one this client published in its metadata document.',
            );
        }

        const protocolError = validateProtocolParameters(query);

        if (protocolError) {
            return {
                kind: AuthorizationOutcomeKind.RedirectError,
                code: protocolError.code,
                redirectTo: buildErrorRedirect({
                    redirectUri,
                    state: query.state,
                    code: protocolError.code,
                    description: protocolError.description,
                    issuer: this.issuer,
                }),
            };
        }

        await this.purgeExpiredRequests();

        const [row] = await this.db
            .insert(oauthAuthorizationRequests)
            .values({
                clientId: resolution.client.clientId,
                redirectUri,
                state: query.state ?? null,
                // Non-null because `validateProtocolParameters` refused the request otherwise.
                codeChallenge: query.code_challenge ?? '',
                codeChallengeMethod: query.code_challenge_method ?? CodeChallengeMethod.S256,
                scopes: [McpScope.Mcp],
                resource: query.resource ?? null,
                expiresAt: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS).toISOString(),
            })
            .returning({ id: oauthAuthorizationRequests.id });

        return { kind: AuthorizationOutcomeKind.Consent, requestId: row.id };
    }

    /**
     * What the consent screen renders for a pending request.
     *
     * @throws EntityNotFoundError when the request is unknown or has expired — the two are
     * deliberately indistinguishable, and either way the client has to start again.
     */
    async getConsentRequest({
        requestId,
        userId,
    }: {
        requestId: string;
        userId: string;
    }): Promise<OAuthConsentRequestResponse> {
        const request = await this.requirePendingRequest({ requestId });
        const resolution = await this.clients.resolve({ clientId: request.clientId });

        if (!resolution.ok) throw new EntityNotFoundError('Authorization request not found');

        const [grant] = await this.db
            .select({ id: oauthGrants.id })
            .from(oauthGrants)
            .where(
                and(
                    eq(oauthGrants.userId, userId),
                    eq(oauthGrants.clientId, request.clientId),
                    isNull(oauthGrants.revokedAt),
                ),
            );

        return {
            requestId: request.id,
            clientId: resolution.client.clientId,
            clientName: resolution.client.clientName,
            clientUri: resolution.client.clientUri,
            logoUri: resolution.client.logoUri,
            tosUri: resolution.client.tosUri,
            policyUri: resolution.client.policyUri,
            redirectHosts: [new URL(request.redirectUri).host],
            scopes: [McpScope.Mcp],
            previouslyApproved: grant !== undefined,
        };
    }

    /**
     * Records the user's decision and returns the URL the browser goes to next — always one on the
     * client, carrying either a single-use code or `error=access_denied`.
     *
     * @throws EntityNotFoundError when the request is unknown or has expired.
     */
    async decide({
        requestId,
        userId,
        approved,
    }: {
        requestId: string;
        userId: string;
        approved: boolean;
    }): Promise<{ redirectTo: string }> {
        const request = await this.requirePendingRequest({ requestId });

        if (!approved) {
            await this.db.delete(oauthAuthorizationRequests).where(eq(oauthAuthorizationRequests.id, requestId));

            return {
                redirectTo: buildErrorRedirect({
                    redirectUri: request.redirectUri,
                    state: request.state ?? undefined,
                    code: OAuthErrorCode.AccessDenied,
                    description: 'The user declined the request.',
                    issuer: this.issuer,
                }),
            };
        }

        if (!isSupportedCodeChallengeMethod(request.codeChallengeMethod)) {
            throw new OAuthProtocolError(
                OAuthErrorCode.InvalidRequest,
                'Unsupported code_challenge_method on the stored request.',
            );
        }

        const workspaceId = await this.membership.requireDefaultWorkspaceId({ userId });
        const code = generateOpaqueToken();

        await withTransaction(this.db, async (tx): Promise<void> => {
            const now = new Date().toISOString();

            const [grant] = await tx
                .insert(oauthGrants)
                .values({
                    userId,
                    clientId: request.clientId,
                    workspaceId,
                    scopes: request.scopes,
                })
                .onConflictDoUpdate({
                    target: [oauthGrants.userId, oauthGrants.clientId],
                    set: { workspaceId, scopes: request.scopes, revokedAt: null, updatedAt: now },
                })
                .returning({ id: oauthGrants.id });

            await tx.insert(oauthAuthorizationCodes).values({
                codeHash: hashOpaqueToken(code),
                grantId: grant.id,
                clientId: request.clientId,
                userId,
                workspaceId,
                redirectUri: request.redirectUri,
                codeChallenge: request.codeChallenge,
                codeChallengeMethod: request.codeChallengeMethod,
                scopes: request.scopes,
                expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
            });

            await tx.delete(oauthAuthorizationRequests).where(eq(oauthAuthorizationRequests.id, requestId));
        });

        const redirectTo = new URL(request.redirectUri);
        redirectTo.searchParams.set('code', code);
        // RFC 9207: lets the client confirm which authorization server answered before it sends the
        // code to a token endpoint.
        redirectTo.searchParams.set('iss', this.issuer);

        if (request.state !== null) redirectTo.searchParams.set('state', request.state);

        return { redirectTo: redirectTo.toString() };
    }

    private async requirePendingRequest({
        requestId,
    }: {
        requestId: string;
    }): Promise<typeof oauthAuthorizationRequests.$inferSelect> {
        const [row] = await this.db
            .select()
            .from(oauthAuthorizationRequests)
            .where(
                and(
                    eq(oauthAuthorizationRequests.id, requestId),
                    gt(oauthAuthorizationRequests.expiresAt, new Date().toISOString()),
                ),
            );

        if (!row) throw new EntityNotFoundError('Authorization request not found');

        return row;
    }

    /** Abandoned consent screens are the common case, so the table is swept on the way past. */
    private async purgeExpiredRequests(): Promise<void> {
        await this.db.delete(oauthAuthorizationRequests).where(lt(oauthAuthorizationRequests.expiresAt, sql`now()`));
    }
}

function resolveRedirectUri({
    client,
    requested,
}: {
    client: ResolvedOAuthClient;
    requested: string | undefined;
}): string | null {
    // RFC 6749 §3.1.2.3: a client that registered exactly one URI may leave the parameter out.
    if (requested === undefined) return client.redirectUris.length === 1 ? client.redirectUris[0] : null;

    return isRedirectUriPermitted({ registered: client.redirectUris, requested }) ? requested : null;
}

/** The checks whose failures are safe to report to the client, because its redirect_uri is proven. */
function validateProtocolParameters(query: OAuthAuthorizeQuery): { code: OAuthErrorCode; description: string } | null {
    if (query.response_type !== OAuthResponseType.Code) {
        return {
            code: OAuthErrorCode.UnsupportedResponseType,
            description: 'Only response_type=code is supported.',
        };
    }

    if (!query.code_challenge) {
        return { code: OAuthErrorCode.InvalidRequest, description: 'PKCE is required: send a code_challenge.' };
    }

    if (query.code_challenge_method !== undefined && !isSupportedCodeChallengeMethod(query.code_challenge_method)) {
        return {
            code: OAuthErrorCode.InvalidRequest,
            description: 'Only code_challenge_method=S256 is supported.',
        };
    }

    if (query.resource !== undefined && !URL.canParse(query.resource)) {
        return { code: OAuthErrorCode.InvalidRequest, description: 'resource must be an absolute URI.' };
    }

    return null;
}

function buildErrorRedirect({
    redirectUri,
    state,
    code,
    description,
    issuer,
}: {
    redirectUri: string;
    state: string | undefined;
    code: OAuthErrorCode;
    description: string;
    issuer: string;
}): string {
    const url = new URL(redirectUri);
    url.searchParams.set('error', code);
    url.searchParams.set('error_description', description);
    url.searchParams.set('iss', issuer);

    if (state !== undefined) url.searchParams.set('state', state);

    return url.toString();
}

function clientError(code: OAuthErrorCode, description: string): AuthorizationOutcome {
    return { kind: AuthorizationOutcomeKind.ClientError, code, description };
}
