import {
    guidSchema,
    itemWebPath,
    paginationQuerySchema,
    patchItemRequestSchema,
    postItemRequestSchema,
    type ItemListResponse,
    type ItemResponse,
    type PaginationQuery,
    type PatchItemRequest,
    type PostItemRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionOrMcpPatGuard,
    ValidatedBody,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ItemsService } from '@app/services';
import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { ITEMS_SERVICE } from './items.providers.js';

/**
 * The example resource slice: contract schema, controller, service, table. Copy this shape for a
 * real resource and delete it.
 *
 * `workspaceId` is a path segment on every route, and `SessionOrMcpPatGuard` pins an MCP token to
 * the workspace it was issued for before any handler runs. The membership check itself lives in
 * `ItemsService`, so a caller reaching this controller by any route is authorised the same way.
 */
@Controller('v1/workspaces/:workspaceId/items')
@UseGuards(SessionOrMcpPatGuard)
export class ItemsController {
    constructor(
        @Inject(ITEMS_SERVICE) private readonly items: ItemsService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** A page of the workspace's items, newest first. */
    @Get()
    async listItems(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedQuery(paginationQuerySchema) query: PaginationQuery,
    ): Promise<ItemListResponse> {
        return this.items.list({
            userId: currentUser.userId,
            workspaceId,
            page: query.page,
            pageSize: query.pageSize,
        });
    }

    /** One item, with the link to its page in the web app. */
    @Get(':itemId')
    async getItem(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'itemId', schema: guidSchema }) itemId: string,
    ): Promise<ItemResponse & { webUrl: string }> {
        const item = await this.items.get({ userId: currentUser.userId, workspaceId, itemId });

        return { ...item, webUrl: this.urls.webAppUrl({ path: itemWebPath({ workspaceId, itemId }) }) };
    }

    /** Creates an item in the workspace. */
    @Post()
    @HttpCode(200)
    async createItem(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postItemRequestSchema) body: PostItemRequest,
    ): Promise<ItemResponse> {
        return this.items.create({
            userId: currentUser.userId,
            workspaceId,
            name: body.name,
            description: body.description ?? null,
        });
    }

    /** Updates an item. An omitted key leaves the stored value alone. */
    @Patch(':itemId')
    async patchItem(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'itemId', schema: guidSchema }) itemId: string,
        @ValidatedBody(patchItemRequestSchema) body: PatchItemRequest,
    ): Promise<ItemResponse> {
        return this.items.update({ userId: currentUser.userId, workspaceId, itemId, ...body });
    }

    /** Deletes an item. */
    @Delete(':itemId')
    async deleteItem(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'itemId', schema: guidSchema }) itemId: string,
    ): Promise<void> {
        await this.items.remove({ userId: currentUser.userId, workspaceId, itemId });
    }
}
