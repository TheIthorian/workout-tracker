import { TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema, paginatedResponseSchema, paginationQuerySchema } from './primitives.js';

const guideFieldSchema = z.string().max(4000);

/** The optional `caption` multipart field on a guide image upload. */
export const exerciseImageCaptionSchema = z.string().trim().max(200).optional();

export const exerciseGuideImageResponseSchema = z.object({
    id: guidSchema,
    caption: z.string().nullable(),
    position: z.number().int(),
    url: z.string(),
});

export const exerciseLinkResponseSchema = z.object({
    id: guidSchema,
    url: z.string(),
    label: z.string().nullable(),
    position: z.number().int(),
});

export const exerciseResponseSchema = z.object({
    id: guidSchema,
    name: z.string(),
    trackingType: z.enum(TrackingType),
    notes: z.string().nullable(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** The exercise plus its guide — what the detail page and the MCP guide tool read. */
export const exerciseDetailResponseSchema = exerciseResponseSchema.extend({
    guideSetup: z.string().nullable(),
    guideExecution: z.string().nullable(),
    guideCues: z.string().nullable(),
    guideMistakes: z.string().nullable(),
    images: z.array(exerciseGuideImageResponseSchema),
    links: z.array(exerciseLinkResponseSchema),
});

export const exerciseListResponseSchema = paginatedResponseSchema(exerciseResponseSchema);

/** Query parameters for `GET /api/v1/workspaces/{workspaceId}/exercises`. */
export const exerciseListQuerySchema = paginationQuerySchema.extend({
    search: z.string().max(200).optional(),
    includeArchived: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
});

/** The body of `POST /api/v1/workspaces/{workspaceId}/exercises`. */
export const postExerciseRequestSchema = z.object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
    trackingType: z.enum(TrackingType),
    notes: z.string().max(2000).nullable().optional(),
    guideSetup: guideFieldSchema.nullable().optional(),
    guideExecution: guideFieldSchema.nullable().optional(),
    guideCues: guideFieldSchema.nullable().optional(),
    guideMistakes: guideFieldSchema.nullable().optional(),
});

/** The body of `PATCH /api/v1/workspaces/{workspaceId}/exercises/{exerciseId}`. An omitted key leaves the stored value alone. */
export const patchExerciseRequestSchema = z
    .object({
        name: z.string().min(1).max(200).optional(),
        trackingType: z.enum(TrackingType).optional(),
        notes: z.string().max(2000).nullable().optional(),
        guideSetup: guideFieldSchema.nullable().optional(),
        guideExecution: guideFieldSchema.nullable().optional(),
        guideCues: guideFieldSchema.nullable().optional(),
        guideMistakes: guideFieldSchema.nullable().optional(),
        archived: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

export const postExerciseLinkRequestSchema = z.object({
    url: z.url().max(2000),
    label: z.string().max(200).nullable().optional(),
});

export const patchExerciseLinkRequestSchema = z
    .object({
        url: z.url().max(2000).optional(),
        label: z.string().max(200).nullable().optional(),
        position: z.number().int().min(0).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>;
export type ExerciseDetailResponse = z.infer<typeof exerciseDetailResponseSchema>;
export type ExerciseListResponse = z.infer<typeof exerciseListResponseSchema>;
export type ExerciseListQuery = z.infer<typeof exerciseListQuerySchema>;
export type ExerciseGuideImageResponse = z.infer<typeof exerciseGuideImageResponseSchema>;
export type ExerciseLinkResponse = z.infer<typeof exerciseLinkResponseSchema>;
export type PostExerciseRequest = z.infer<typeof postExerciseRequestSchema>;
export type PatchExerciseRequest = z.infer<typeof patchExerciseRequestSchema>;
export type PostExerciseLinkRequest = z.infer<typeof postExerciseLinkRequestSchema>;
export type PatchExerciseLinkRequest = z.infer<typeof patchExerciseLinkRequestSchema>;
