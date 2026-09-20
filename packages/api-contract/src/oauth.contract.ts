import { OAuthErrorCode } from '@app/errors';
import { z } from 'zod';

export { OAuthErrorCode };

/**
 * Every scope this authorization server issues. One scope, deliberately: an MCP client that can
 * read a workout can also log a set, and a half-enforced split would claim a boundary the tool
 * surface does not actually have. The consent screen spells out what the single scope grants.
 */
export enum McpScope {
    Mcp = 'mcp',
}

/** The PKCE transformations this server accepts; OAuth 2.1 removed `plain`. */
export enum CodeChallengeMethod {
    S256 = 'S256',
}

/** The one `response_type` this server supports. */
export enum OAuthResponseType {
    Code = 'code',
}

/** The grant types this server supports at its token endpoint. */
export enum OAuthGrantType {
    AuthorizationCode = 'authorization_code',
    RefreshToken = 'refresh_token',
}

/** Longest a `client_id` may be. A Client ID Metadata Document identifies its client by URL. */
export const MAX_CLIENT_ID_LENGTH = 512;

const clientIdSchema = z.string().min(1).max(MAX_CLIENT_ID_LENGTH);

const boundedString = (max: number): z.ZodType<string> => z.string().min(1).max(max);

/**
 * The authorization request, read straight off the query string.
 *
 * Every member is optional and only loosely bounded on purpose: a missing or malformed parameter
 * has to become an OAuth error — rendered to the user, or redirected back to the client, depending
 * on which parameter it was — and a validation pipe that rejected the request first would turn all
 * of them into the same opaque 400.
 */
export const oauthAuthorizeQuerySchema = z.object({
    response_type: z.string().max(64).optional(),
    client_id: z.string().max(MAX_CLIENT_ID_LENGTH).optional(),
    redirect_uri: z.string().max(2048).optional(),
    scope: z.string().max(512).optional(),
    state: z.string().max(1024).optional(),
    code_challenge: z.string().max(256).optional(),
    code_challenge_method: z.string().max(64).optional(),
    /** RFC 8707. The MCP server the client intends to use the token at. */
    resource: z.string().max(2048).optional(),
});

/**
 * A Client ID Metadata Document, as published at the client's own `client_id` URL
 * (draft-ietf-oauth-client-id-metadata-document). Unknown members are stripped rather than
 * rejected: the document is published once for every authorization server the client talks to.
 */
export const clientIdMetadataSchema = z.object({
    client_id: clientIdSchema,
    client_name: z.string().max(256).optional(),
    client_uri: z.string().max(2048).optional(),
    logo_uri: z.string().max(2048).optional(),
    tos_uri: z.string().max(2048).optional(),
    policy_uri: z.string().max(2048).optional(),
    redirect_uris: z.array(boundedString(2048)).min(1).max(32),
    grant_types: z.array(boundedString(128)).max(16).optional(),
    response_types: z.array(boundedString(128)).max(16).optional(),
    scope: z.string().max(512).optional(),
    token_endpoint_auth_method: z.string().max(128).optional(),
});

/** `POST /oauth/token`. Public clients only: this server registers no client secrets. */
export const oauthTokenRequestSchema = z.object({
    grant_type: z.string().max(64),
    code: z.string().max(512).optional(),
    redirect_uri: z.string().max(2048).optional(),
    code_verifier: z.string().max(256).optional(),
    refresh_token: z.string().max(512).optional(),
    client_id: z.string().max(MAX_CLIENT_ID_LENGTH).optional(),
    resource: z.string().max(2048).optional(),
});

export const oauthTokenResponseSchema = z.object({
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int(),
    refresh_token: z.string(),
    scope: z.string(),
});

/** `POST /oauth/revoke` (RFC 7009). */
export const oauthRevokeRequestSchema = z.object({
    token: z.string().max(512),
    token_type_hint: z.string().max(64).optional(),
    client_id: z.string().max(MAX_CLIENT_ID_LENGTH).optional(),
});

/** The OAuth error body a failed token or revocation request returns. */
export const oauthErrorResponseSchema = z.object({
    error: z.enum(OAuthErrorCode),
    error_description: z.string().optional(),
});

/** `GET /.well-known/oauth-authorization-server` (RFC 8414). */
export const authorizationServerMetadataResponseSchema = z.object({
    issuer: z.string(),
    authorization_endpoint: z.string(),
    token_endpoint: z.string(),
    revocation_endpoint: z.string(),
    scopes_supported: z.array(z.string()),
    response_types_supported: z.array(z.string()),
    grant_types_supported: z.array(z.string()),
    code_challenge_methods_supported: z.array(z.string()),
    token_endpoint_auth_methods_supported: z.array(z.string()),
    /** draft-ietf-oauth-client-id-metadata-document: how a client learns it need not register. */
    client_id_metadata_document_supported: z.literal(true),
    service_documentation: z.string().optional(),
});

/** `GET /.well-known/oauth-protected-resource` on `apps/mcp` (RFC 9728). */
export const protectedResourceMetadataResponseSchema = z.object({
    resource: z.string(),
    authorization_servers: z.array(z.string()),
    scopes_supported: z.array(z.string()),
    bearer_methods_supported: z.array(z.literal('header')),
});

/**
 * What the consent screen renders. `redirectHosts` is listed separately from the client's own
 * details because it is the part a user can check: it names where approving actually sends them.
 */
export const oauthConsentRequestResponseSchema = z.object({
    requestId: z.string(),
    clientId: z.string(),
    clientName: z.string(),
    clientUri: z.string().nullable(),
    logoUri: z.string().nullable(),
    tosUri: z.string().nullable(),
    policyUri: z.string().nullable(),
    redirectHosts: z.array(z.string()),
    scopes: z.array(z.enum(McpScope)),
    /**
     * Whether this deployment vouches for the client. False is not a refusal — the client still
     * authorizes — it is what the consent screen warns about.
     */
    verified: z.boolean(),
    /** True when this user already approved this client, so the screen can say "reconnect". */
    previouslyApproved: z.boolean(),
});

export enum ConsentDecision {
    Approve = 'approve',
    Deny = 'deny',
}

export const oauthConsentDecisionRequestSchema = z.object({
    decision: z.enum(ConsentDecision),
});

/** Where the browser goes next. Always a URL on the client, carrying either a code or an error. */
export const oauthConsentDecisionResponseSchema = z.object({
    redirectTo: z.string(),
});

/** One entry in `GET /v1/me/connected-apps`. */
export const connectedAppResponseSchema = z.object({
    clientId: z.string(),
    clientName: z.string(),
    clientUri: z.string().nullable(),
    logoUri: z.string().nullable(),
    scopes: z.array(z.string()),
    verified: z.boolean(),
    connectedAt: z.string(),
    lastUsedAt: z.string().nullable(),
});

/** `DELETE /v1/me/connected-apps` — the client to disconnect, as a query parameter. */
export const disconnectAppQuerySchema = z.object({
    clientId: clientIdSchema,
});

/** `GET /v1/me/mcp-connection` — the URL a user pastes into an MCP client. */
export const mcpConnectionResponseSchema = z.object({
    mcpUrl: z.string(),
});

export type OAuthAuthorizeQuery = z.infer<typeof oauthAuthorizeQuerySchema>;
export type ClientIdMetadata = z.infer<typeof clientIdMetadataSchema>;
export type OAuthTokenRequest = z.infer<typeof oauthTokenRequestSchema>;
export type OAuthTokenResponse = z.infer<typeof oauthTokenResponseSchema>;
export type OAuthRevokeRequest = z.infer<typeof oauthRevokeRequestSchema>;
export type OAuthErrorResponse = z.infer<typeof oauthErrorResponseSchema>;
export type AuthorizationServerMetadataResponse = z.infer<typeof authorizationServerMetadataResponseSchema>;
export type ProtectedResourceMetadataResponse = z.infer<typeof protectedResourceMetadataResponseSchema>;
export type OAuthConsentRequestResponse = z.infer<typeof oauthConsentRequestResponseSchema>;
export type OAuthConsentDecisionRequest = z.infer<typeof oauthConsentDecisionRequestSchema>;
export type OAuthConsentDecisionResponse = z.infer<typeof oauthConsentDecisionResponseSchema>;
export type ConnectedAppResponse = z.infer<typeof connectedAppResponseSchema>;
export type DisconnectAppQuery = z.infer<typeof disconnectAppQuerySchema>;
export type McpConnectionResponse = z.infer<typeof mcpConnectionResponseSchema>;
