import { z } from 'zod';
import { guidSchema } from './primitives.js';
import { workspaceListItemSchema } from './workspace.contract.js';

/** The body of `GET /api/v1/me`. */
export const userResponseSchema = z.object({
    userId: guidSchema,
    displayName: z.string(),
    email: z.string(),
    workspaces: z.array(workspaceListItemSchema),
});

/** The body of `PATCH /api/v1/me`. */
export const patchUserRequestSchema = z.object({
    displayName: z.string().min(1, 'Display name is required').max(100, 'Display name must not exceed 100 characters'),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
export type PatchUserRequest = z.infer<typeof patchUserRequestSchema>;
