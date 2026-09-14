import { Equipment, TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema, paginatedResponseSchema, paginationQuerySchema } from './primitives.js';

const guideFieldSchema = z.string().max(4000);

/** A set of equipment with no repeats. */
export const equipmentListSchema = z
    .array(z.enum(Equipment))
    .max(Object.values(Equipment).length)
    .refine((list) => new Set(list).size === list.length, { message: 'Equipment must not repeat' });

export const exerciseGuideImageResponseSchema = z.object({
    id: guidSchema,
    caption: z.string().nullable(),
    position: z.number().int(),
    /** Absolute URL; custom images require a workspace session, catalog images use the CDN. */
    url: z.url(),
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
    /** Set on catalog exercises; the seed's stable key. Null on a workspace's own exercise. */
    slug: z.string().nullable(),
    /** True for shared catalog content, which no workspace route may write. */
    isCatalog: z.boolean(),
    trackingType: z.enum(TrackingType),
    equipment: z.array(z.enum(Equipment)),
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
    /** Comma-separated. Absent: no filter. Empty: bodyweight only. Otherwise: only exercises needing a subset. */
    equipment: z
        .string()
        .optional()
        .transform((raw, ctx) => {
            if (raw === undefined) return undefined;
            const values = raw === '' ? [] : raw.split(',');
            const parsed = equipmentListSchema.safeParse(values);
            if (!parsed.success) {
                ctx.addIssue({ code: 'custom', message: 'Unknown equipment' });
                return z.NEVER;
            }
            return parsed.data;
        }),
});

/** The body of `POST /api/v1/workspaces/{workspaceId}/exercises`. */
export const postExerciseRequestSchema = z.object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
    trackingType: z.enum(TrackingType),
    equipment: equipmentListSchema.default([]),
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
        equipment: equipmentListSchema.optional(),
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

/** Image uploads use one multipart file, with an optional caption in the query string. */
export const postExerciseImageQuerySchema = z.object({ caption: z.string().max(200).optional() });
export const patchExerciseImageRequestSchema = z.object({ caption: z.string().max(200).nullable() });
export const MAX_EXERCISE_IMAGE_BYTES = 10 * 1024 * 1024;
export enum ExerciseImageContentType {
    Jpeg = 'image/jpeg',
    Png = 'image/png',
    Webp = 'image/webp',
}
export type PostExerciseImageQuery = z.infer<typeof postExerciseImageQuerySchema>;
export type PatchExerciseImageRequest = z.infer<typeof patchExerciseImageRequestSchema>;
