import { z } from 'zod';
import { guidSchema, paginatedResponseSchema } from './primitives.js';

/**
 * Example resource contract. Every route in this repo starts with a schema here, then a controller
 * implemented against it — never a hand-written response shape in the controller itself.
 */
export const itemResponseSchema = z.object({
    id: guidSchema,
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const itemListResponseSchema = paginatedResponseSchema(itemResponseSchema);

/** The body of `POST /api/v1/items`. */
export const postItemRequestSchema = z.object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
    description: z.string().max(2000).nullable().optional(),
});

/** The body of `PATCH /api/v1/items/{itemId}`. An omitted key leaves the stored value alone. */
export const patchItemRequestSchema = z
    .object({
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

export type ItemResponse = z.infer<typeof itemResponseSchema>;
export type ItemListResponse = z.infer<typeof itemListResponseSchema>;
export type PostItemRequest = z.infer<typeof postItemRequestSchema>;
export type PatchItemRequest = z.infer<typeof patchItemRequestSchema>;
