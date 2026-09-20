import {
    CodeChallengeMethod,
    McpScope,
    OAuthGrantType,
    OAuthResponseType,
    type AuthorizationServerMetadataResponse,
} from '@app/api-contract';
import { RESOURCE_URL_GENERATOR, ResourceUrlGenerator } from '@app/nest-common';
import { Controller, Get, Header, Inject } from '@nestjs/common';

/**
 * RFC 8414 authorization server metadata — how an MCP client discovers this server without being
 * configured with a single endpoint URL.
 *
 * Mounted outside the `api` global prefix (`bootstrap.ts` excludes it). RFC 8414 §3 derives this
 * document's location from the issuer identifier, and the issuer is this deployment's origin, so
 * serving it anywhere else would make it undiscoverable however correct its contents.
 *
 * Deliberately anonymous: discovery is what a client does before it has any credential at all.
 */
@Controller('.well-known')
export class WellKnownController {
    constructor(@Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator) {}

    /**
     * There is no `registration_endpoint`: this server runs no dynamic client registration.
     * `client_id_metadata_document_supported` is how a client learns it should publish a metadata
     * document and use its URL as the `client_id` instead.
     */
    @Get('oauth-authorization-server')
    @Header('cache-control', 'public, max-age=3600')
    metadata(): AuthorizationServerMetadataResponse {
        return {
            issuer: this.urls.issuer,
            authorization_endpoint: this.urls.apiUrl({ path: '/oauth/authorize' }),
            token_endpoint: this.urls.apiUrl({ path: '/oauth/token' }),
            revocation_endpoint: this.urls.apiUrl({ path: '/oauth/revoke' }),
            scopes_supported: Object.values(McpScope),
            response_types_supported: Object.values(OAuthResponseType),
            grant_types_supported: Object.values(OAuthGrantType),
            code_challenge_methods_supported: Object.values(CodeChallengeMethod),
            // Public clients only: this server issues no client secrets, so there is nothing for a
            // client to authenticate to the token endpoint with.
            token_endpoint_auth_methods_supported: ['none'],
            client_id_metadata_document_supported: true,
        };
    }
}
