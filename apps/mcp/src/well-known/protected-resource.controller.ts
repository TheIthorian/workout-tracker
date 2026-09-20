import { McpScope, type ProtectedResourceMetadataResponse } from '@app/api-contract';
import { RESOURCE_URL_GENERATOR, ResourceUrlGenerator } from '@app/nest-common';
import { Controller, Get, Header, Inject } from '@nestjs/common';
import { MCP_RESOURCE_PATH } from '../mcp/mcp-resource.js';

/**
 * RFC 9728 protected resource metadata: the document that points an MCP client at the
 * authorization server it must get a token from.
 *
 * Served at two paths. `/.well-known/oauth-protected-resource` is what a client that treats this
 * origin as the resource looks for; the `/mcp` suffix is the path-insertion form §3.1 specifies for
 * a resource identifier that has a path, which is what the `WWW-Authenticate` header on a rejected
 * request actually names.
 *
 * Deliberately anonymous: this is what a caller reads precisely because it has no credential yet.
 */
@Controller('.well-known')
export class ProtectedResourceController {
    constructor(@Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator) {}

    /** The metadata document, at the bare well-known path. */
    @Get('oauth-protected-resource')
    @Header('cache-control', 'public, max-age=3600')
    metadata(): ProtectedResourceMetadataResponse {
        return this.buildMetadata();
    }

    /** The same document, at the path-insertion location for the `/mcp` resource. */
    @Get(`oauth-protected-resource${MCP_RESOURCE_PATH}`)
    @Header('cache-control', 'public, max-age=3600')
    metadataForMcp(): ProtectedResourceMetadataResponse {
        return this.buildMetadata();
    }

    private buildMetadata(): ProtectedResourceMetadataResponse {
        return {
            resource: this.urls.mcpUrl({ path: MCP_RESOURCE_PATH }),
            authorization_servers: [this.urls.issuer],
            scopes_supported: Object.values(McpScope),
            bearer_methods_supported: ['header'],
        };
    }
}
