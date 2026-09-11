import { TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema, MAX_PAGE_SIZE } from './primitives.js';

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

/** `list_exercises`. */
export const listExercisesToolArgsSchema = z.strictObject({
    search: z.string().max(200).nullish(),
    includeArchived: z.boolean().nullish(),
    page: z.number().int().min(1).nullish(),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).nullish(),
});

/** `get_exercise`. */
export const getExerciseToolArgsSchema = z.strictObject({
    exerciseId: guidSchema,
});

/** `create_exercise`. `trackingType` decides which fields a logged set for this exercise carries. */
export const createExerciseToolArgsSchema = z.strictObject({
    name: z.string().min(1).max(200),
    trackingType: z.enum(TrackingType),
    notes: z.string().max(2000).nullish(),
    guideSetup: z.string().max(4000).nullish(),
    guideExecution: z.string().max(4000).nullish(),
    guideCues: z.string().max(4000).nullish(),
    guideMistakes: z.string().max(4000).nullish(),
});

/** `update_exercise`. An omitted key leaves the stored value alone. */
export const updateExerciseToolArgsSchema = createExerciseToolArgsSchema.partial().extend({
    exerciseId: guidSchema,
    archived: z.boolean().nullish(),
});

/** `add_exercise_link`. */
export const addExerciseLinkToolArgsSchema = z.strictObject({
    exerciseId: guidSchema,
    url: z.url().max(2000),
    label: z.string().max(200).nullish(),
});

export type GetCurrentUserToolArgs = z.infer<typeof getCurrentUserToolArgsSchema>;
export type ListWorkspacesToolArgs = z.infer<typeof listWorkspacesToolArgsSchema>;
export type ListItemsToolArgs = z.infer<typeof listItemsToolArgsSchema>;
export type GetItemToolArgs = z.infer<typeof getItemToolArgsSchema>;
export type CreateItemToolArgs = z.infer<typeof createItemToolArgsSchema>;
export type UpdateItemToolArgs = z.infer<typeof updateItemToolArgsSchema>;
export type DeleteItemToolArgs = z.infer<typeof deleteItemToolArgsSchema>;
export type ListExercisesToolArgs = z.infer<typeof listExercisesToolArgsSchema>;
export type GetExerciseToolArgs = z.infer<typeof getExerciseToolArgsSchema>;
export type CreateExerciseToolArgs = z.infer<typeof createExerciseToolArgsSchema>;
export type UpdateExerciseToolArgs = z.infer<typeof updateExerciseToolArgsSchema>;
export type AddExerciseLinkToolArgs = z.infer<typeof addExerciseLinkToolArgsSchema>;
