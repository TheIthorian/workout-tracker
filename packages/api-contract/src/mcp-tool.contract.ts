import { z } from 'zod';
import { guidSchema } from './primitives.js';

/**
 * Argument schemas for the MCP tool surface, one per tool, kept here rather than in `apps/mcp` so
 * the wire contract lives with every other contract in the repo.
 *
 * Every schema is a `strictObject`, so the advertised JSON Schema carries
 * `additionalProperties: false` and an unrecognised argument is rejected before the tool body runs.
 */

/** `get_current_user` takes no arguments — the caller comes from the access token. */
export const getCurrentUserToolArgsSchema = z.strictObject({});

/** `list_workspaces` takes no arguments - it lists what the caller can reach. */
export const listWorkspacesToolArgsSchema = z.strictObject({});

/** `list_items`. */
export const listItemsToolArgsSchema = z.strictObject({
    page: z.number().int().nullish(),
    pageSize: z.number().int().nullish(),
});

/** `get_item`. */
export const getItemToolArgsSchema = z.strictObject({
    itemId: guidSchema,
});

/** `create_item`. */
export const createItemToolArgsSchema = z.strictObject({
    name: z.string(),
    description: z.string().nullish(),
});

/** `update_item`. An omitted key leaves the stored value alone. */
export const updateItemToolArgsSchema = z.strictObject({
    itemId: guidSchema,
    name: z.string().nullish(),
    description: z.string().nullish(),
});

/** `delete_item`. */
export const deleteItemToolArgsSchema = z.strictObject({
    itemId: guidSchema,
});

export type GetCurrentUserToolArgs = z.infer<typeof getCurrentUserToolArgsSchema>;
export type ListWorkspacesToolArgs = z.infer<typeof listWorkspacesToolArgsSchema>;
export type ListItemsToolArgs = z.infer<typeof listItemsToolArgsSchema>;
export type GetItemToolArgs = z.infer<typeof getItemToolArgsSchema>;
export type CreateItemToolArgs = z.infer<typeof createItemToolArgsSchema>;
export type UpdateItemToolArgs = z.infer<typeof updateItemToolArgsSchema>;
export type DeleteItemToolArgs = z.infer<typeof deleteItemToolArgsSchema>;
