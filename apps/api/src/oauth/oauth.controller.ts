import {
    ConsentDecision,
    guidSchema,
    oauthAuthorizeQuerySchema,
    oauthConsentDecisionRequestSchema,
    oauthRevokeRequestSchema,
    oauthTokenRequestSchema,
    type OAuthAuthorizeQuery,
    type OAuthConsentDecisionRequest,
    type OAuthConsentDecisionResponse,
    type OAuthConsentRequestResponse,
    type OAuthRevokeRequest,
    type OAuthTokenRequest,
    type OAuthTokenResponse,
} from '@app/api-contract';
import type { Logger } from '@app/logger';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import { AuthorizationOutcomeKind, type OAuthAuthorizationService, type OAuthTokensService } from '@app/services';
import { Controller, Get, Header, HttpCode, Inject, Post, Res, UseFilters, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { APP_LOGGER } from '../providers.js';
import { OAuthErrorFilter } from './oauth-error.filter.js';
import { OAUTH_AUTHORIZATION_SERVICE, OAUTH_TOKENS_SERVICE } from './oauth.providers.js';

/** Where the browser is sent when the client itself cannot be trusted with an error redirect. */
const UNSUPPORTED_CLIENT_PATH = '/oauth/error';

/** The consent screen, in the web app rather than here: it is a page, and pages live in the SPA. */
const CONSENT_PATH = '/oauth/consent';

/**
 * The OAuth 2.1 authorization server MCP clients connect through.
 *
 * `authorize`, `token` and `revoke` are anonymous by design — they are what a caller with no
 * credential uses to get one, and the consent step is where a human identity is actually proven.
 * The two `consent` routes are session-guarded: they are the SPA asking, on behalf of a signed-in
 * user, what a pending request wants and then answering it.
 */
@Controller('v1/oauth')
@UseFilters(OAuthErrorFilter)
export class OAuthController {
    constructor(
        @Inject(OAUTH_AUTHORIZATION_SERVICE) private readonly authorization: OAuthAuthorizationService,
        @Inject(OAUTH_TOKENS_SERVICE) private readonly tokens: OAuthTokensService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
        @Inject(APP_LOGGER) private readonly logger: Logger,
    ) {}

    /**
     * The authorization endpoint. Always answers with a redirect, never a body: a browser followed
     * a link here, and whatever happens next is another page.
     *
     * Three destinations, and which one is used is a security decision rather than a presentational
     * one — see `OAuthAuthorizationService.begin` for why a failure involving the client's identity
     * can never be redirected back to the client.
     */
    @Get('authorize')
    async authorize(
        @ValidatedQuery(oauthAuthorizeQuerySchema) query: OAuthAuthorizeQuery,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        const outcome = await this.authorization.begin({ query });

        if (outcome.kind === AuthorizationOutcomeKind.Consent) {
            const consent = new URL(this.urls.webAppUrl({ path: CONSENT_PATH }));
            consent.searchParams.set('request_id', outcome.requestId);

            return reply.redirect(consent.toString(), 302);
        }

        if (outcome.kind === AuthorizationOutcomeKind.RedirectError) {
            this.logger.warn(
                { clientId: query.client_id ?? null, error: outcome.code },
                'OAuth authorization request rejected back to the client',
            );

            return reply.redirect(outcome.redirectTo, 302);
        }

        this.logger.warn(
            { clientId: query.client_id ?? null, error: outcome.code },
            'OAuth authorization request from a client this deployment does not accept',
        );

        const page = new URL(this.urls.webAppUrl({ path: UNSUPPORTED_CLIENT_PATH }));
        page.searchParams.set('error', outcome.code);
        page.searchParams.set('error_description', outcome.description);

        if (query.client_id) page.searchParams.set('client_id', query.client_id);

        return reply.redirect(page.toString(), 302);
    }

    /** What the consent screen renders: who is asking, and where approving would send the user. */
    @Get('consent/:requestId')
    @UseGuards(SessionAuthGuard)
    async getConsentRequest(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'requestId', schema: guidSchema }) requestId: string,
    ): Promise<OAuthConsentRequestResponse> {
        return this.authorization.getConsentRequest({ requestId, userId: currentUser.userId });
    }

    /**
     * Records the decision and hands back the URL to navigate to. The SPA performs that navigation
     * itself rather than following a redirect, because a `fetch` would follow it to the client's
     * own callback and swallow the code.
     */
    @Post('consent/:requestId')
    @HttpCode(200)
    @UseGuards(SessionAuthGuard)
    async decideConsent(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'requestId', schema: guidSchema }) requestId: string,
        @ValidatedBody(oauthConsentDecisionRequestSchema) body: OAuthConsentDecisionRequest,
    ): Promise<OAuthConsentDecisionResponse> {
        return this.authorization.decide({
            requestId,
            userId: currentUser.userId,
            approved: body.decision === ConsentDecision.Approve,
        });
    }

    /**
     * The token endpoint. It accepts the form encoding RFC 6749 §4.1.3 requires as well as JSON,
     * since MCP clients send both; Nest's Fastify adapter registers both body parsers itself.
     */
    @Post('token')
    @HttpCode(200)
    @Header('cache-control', 'no-store')
    @Header('pragma', 'no-cache')
    async token(@ValidatedBody(oauthTokenRequestSchema) body: OAuthTokenRequest): Promise<OAuthTokenResponse> {
        return this.tokens.exchange({ request: body });
    }

    /** RFC 7009. Answers 200 whether or not the token existed, so it cannot be used to guess one. */
    @Post('revoke')
    @HttpCode(200)
    @Header('cache-control', 'no-store')
    async revoke(@ValidatedBody(oauthRevokeRequestSchema) body: OAuthRevokeRequest): Promise<void> {
        await this.tokens.revoke({ token: body.token });
    }
}
