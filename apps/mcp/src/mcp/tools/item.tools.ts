import {
    createItemToolArgsSchema,
    deleteItemToolArgsSchema,
    getItemToolArgsSchema,
    listItemsToolArgsSchema,
    paginationQuerySchema,
    updateItemToolArgsSchema,
    type ItemListResponse,
    type ItemResponse,
} from '@app/api-contract';
import type { ApiClient } from '@app/api-client';
import type { Logger } from '@app/logger';
import type { McpContext, ResourceUrlGenerator } from '@app/nest-common';
import { defineTool, type McpToolDefinition } from '../tool-definition.js';
import { runToolCaught, serializeToolResult } from '../tool-execution.js';
import { attachItemLinks } from './item-links.js';

/**
 * CRUD over the example `items` resource, and the worked example of how every tool in this app is
 * built: an `ApiClient` call to `apps/api` as the token's bearer, never a database query.
 *
 * No tool here takes a `workspaceId`. The workspace comes from the personal access token, and
 * exposing it as an argument would be a contract error, not a convenience - it would let a model
 * name a workspace the token was never issued for.
 *
 * Which tools catch and which propagate is deliberate. The writes go through `runToolCaught`, so a
 * validation complaint reaches the model as a readable problem body it can correct and retry. The
 * reads and the delete do not, so their failures surface as `isError: true` - a 404 from `get_item`
 * is not something the model can fix by rewording its arguments.
 */
export function buildItemTools({
    context,
    client,
    logger,
    urls,
}: {
    context: McpContext;
    client: ApiClient;
    logger: Logger;
    urls: ResourceUrlGenerator;
}): McpToolDefinition[] {
    const basePath = `/workspaces/${context.workspaceId}/items`;

    const withLinks = <T extends { id: string }>(item: T): T & { webUrl: string; resourceUrl: string } =>
        attachItemLinks({ urls, item, workspaceId: context.workspaceId });

    return [
        defineTool({
            methodName: 'ListItems',
            description:
                "Lists items in the token's workspace, newest first, with optional paging. Each entry includes webUrl, the page for that item in the web app.",
            inputSchema: listItemsToolArgsSchema,
            handler: async (args) => {
                const pagination = paginationQuerySchema.parse({
                    page: args.page ?? undefined,
                    pageSize: args.pageSize ?? undefined,
                });

                const page = await client.get<ItemListResponse>({
                    path: basePath,
                    query: { page: pagination.page, pageSize: pagination.pageSize },
                });

                return serializeToolResult({ body: { ...page, data: page.data.map(withLinks) } });
            },
        }),
        defineTool({
            methodName: 'GetItem',
            description: 'Gets an item by id. The response includes webUrl, the page for this item in the web app.',
            inputSchema: getItemToolArgsSchema,
            handler: async (args) => {
                const item = await client.get<ItemResponse>({ path: `${basePath}/${args.itemId}` });

                return serializeToolResult({ body: withLinks(item) });
            },
        }),
        defineTool({
            methodName: 'CreateItem',
            description:
                "Creates an item in the token's workspace. Returns the created item, including webUrl for its page in the web app.",
            inputSchema: createItemToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'create_item',
                    logger,
                    action: async () => {
                        const item = await client.post<ItemResponse>({
                            path: basePath,
                            body: { name: args.name, description: args.description ?? null },
                        });

                        return serializeToolResult({ body: withLinks(item) });
                    },
                }),
        }),
        defineTool({
            methodName: 'UpdateItem',
            description:
                'Updates an item. Omitted fields keep their stored value; pass an empty description to clear it.',
            inputSchema: updateItemToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'update_item',
                    logger,
                    action: async () => {
                        const item = await client.patch<ItemResponse>({
                            path: `${basePath}/${args.itemId}`,
                            body: buildItemPatch(args),
                        });

                        return serializeToolResult({ body: withLinks(item) });
                    },
                }),
        }),
        defineTool({
            methodName: 'DeleteItem',
            description: 'Deletes an item by id. This cannot be undone.',
            inputSchema: deleteItemToolArgsSchema,
            handler: async (args) => {
                await client.delete_({ path: `${basePath}/${args.itemId}` });

                return serializeToolResult({ body: { deleted: true, itemId: args.itemId } });
            },
        }),
    ];
}

/**
 * Builds the PATCH body from only the keys the caller actually sent, so an omitted field keeps its
 * stored value rather than being overwritten with null.
 *
 * An empty or whitespace-only `description` is the one way to clear the field - the alternative
 * would be a caller with no way to remove a description at all.
 */
function buildItemPatch(args: { name?: string | null; description?: string | null }): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    if (args.name !== undefined && args.name !== null) patch['name'] = args.name;

    if (args.description !== undefined && args.description !== null) {
        patch['description'] = args.description.trim() === '' ? null : args.description;
    }

    return patch;
}
