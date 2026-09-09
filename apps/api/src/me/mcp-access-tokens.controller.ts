import {
    guidSchema,
    postMcpAccessTokenRequestSchema,
    type McpAccessTokenCreatedResponse,
    type McpAccessTokenListItemResponse,
    type PostMcpAccessTokenRequest,
} from '@app/api-contract';
import type { McpAccessTokensService } from '@app/services';
import { Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import { MCP_ACCESS_TOKENS_SERVICE } from './me.providers.js';

/** Issues and revokes the personal access tokens `apps/mcp` authenticates with. */
@Controller('v1/me/mcp-access-tokens')
@UseGuards(SessionAuthGuard)
export class McpAccessTokensController {
    constructor(
        @Inject(MCP_ACCESS_TOKENS_SERVICE) private readonly tokensService: McpAccessTokensService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /**
     * Creates a token pinned to one workspace, returning the plaintext exactly once. `mcpUrl` is
     * built from the configured
     * MCP origin, not from this request: MCP is served by `apps/mcp`, a separate deployment, so a
     * url derived from the host this request arrived on names an API with no `/mcp/{token}` route.
     */
    @Post()
    @HttpCode(200)
    async createToken(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedBody(postMcpAccessTokenRequestSchema) body: PostMcpAccessTokenRequest,
    ): Promise<McpAccessTokenCreatedResponse> {
        const result = await this.tokensService.createToken({
            userId: currentUser.userId,
            workspaceId: body.workspaceId,
            name: body.name ?? null,
        });

        const mcpUrl = this.urls.mcpUrl({ path: `/mcp/${result.token}` });

        return { id: result.id, workspaceId: result.workspaceId, token: result.token, mcpUrl };
    }

    /** Every token for the caller, including revoked ones. Never returns a token value. */
    @Get()
    async listTokens(@CurrentUser() currentUser: CurrentUserContext): Promise<McpAccessTokenListItemResponse[]> {
        return this.tokensService.listTokens(currentUser.userId);
    }

    /** Revokes a token belonging to the caller. */
    @Delete(':tokenId')
    async revokeToken(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'tokenId', schema: guidSchema }) tokenId: string,
    ): Promise<void> {
        await this.tokensService.revokeToken({ userId: currentUser.userId, tokenId });
    }
}
