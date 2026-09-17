import { Equipment, TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema, paginatedResponseSchema, paginationQuerySchema } from './primitives.js';

/** The exercise a routine slot points at — enough to render the row and pick an input widget. */
export const routineExerciseSummarySchema = z.object({
    id: guidSchema,
    name: z.string(),
    trackingType: z.enum(TrackingType),
    isCatalog: z.boolean(),
    /** What the movement needs; empty means bodyweight. */
    equipment: z.array(z.enum(Equipment)),
    /** Set when the exercise was archived after being added; the slot stays, flagged. */
    archivedAt: z.string().nullable(),
});

export const routineExerciseResponseSchema = z.object({
    id: guidSchema,
    position: z.number().int(),
    targetSets: z.number().int(),
    restSeconds: z.number().int().nullable(),
    notes: z.string().nullable(),
    targetReps: z.number().int().nullable(),
    targetWeightKg: z.number().nullable(),
    targetDurationSeconds: z.number().int().nullable(),
    targetDistanceM: z.number().nullable(),
    exercise: routineExerciseSummarySchema,
});

export const routineResponseSchema = z.object({
    id: guidSchema,
    name: z.string(),
    description: z.string().nullable(),
    archivedAt: z.string().nullable(),
    exerciseCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** The routine plus its ordered exercises — what the editor and the MCP get tool read. */
export const routineDetailResponseSchema = routineResponseSchema.extend({
    exercises: z.array(routineExerciseResponseSchema),
});

export const routineListResponseSchema = paginatedResponseSchema(routineResponseSchema);

/** Query parameters for `GET /api/v1/workspaces/{workspaceId}/routines`. */
export const routineListQuerySchema = paginationQuerySchema.extend({
    search: z.string().max(200).optional(),
    includeArchived: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
});

/** The body of `POST /api/v1/workspaces/{workspaceId}/routines`. */
export const postRoutineRequestSchema = z.object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
    description: z.string().max(2000).nullable().optional(),
});

/** The body of `PATCH /api/v1/workspaces/{workspaceId}/routines/{routineId}`. An omitted key leaves the stored value alone. */
export const patchRoutineRequestSchema = z
    .object({
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        archived: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

/**
 * Targets for one routine slot. Every measurement is optional and nullable — a target is a
 * suggestion, not a requirement — and the bounds are sanity limits, not training advice. Which
 * fields fit the exercise's tracking type is checked by the service, which can see the exercise.
 */
const routineExerciseTargetsSchema = z.object({
    targetSets: z.number().int().min(1).max(100),
    restSeconds: z.number().int().min(0).max(3600).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    targetReps: z.number().int().min(0).max(1000).nullable().optional(),
    targetWeightKg: z.number().min(0).max(10000).nullable().optional(),
    targetDurationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    targetDistanceM: z.number().min(0).max(1000000).nullable().optional(),
});

/** The body of `POST .../routines/{routineId}/exercises`: appends a slot. */
export const postRoutineExerciseRequestSchema = routineExerciseTargetsSchema.extend({
    exerciseId: guidSchema,
    targetSets: z.number().int().min(1).max(100).default(3),
});

/**
 * The body of `PATCH .../routines/{routineId}/exercises/{routineExerciseId}`. Position is not
 * editable here — reordering goes through the PUT of the whole list.
 */
export const patchRoutineExerciseRequestSchema = routineExerciseTargetsSchema
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

/** The body of `PUT .../routines/{routineId}/exercises`: the complete ordered list, replacing what was there. */
export const putRoutineExercisesRequestSchema = z.object({
    exercises: z.array(postRoutineExerciseRequestSchema).max(50),
});

export type RoutineExerciseSummary = z.infer<typeof routineExerciseSummarySchema>;
export type RoutineExerciseResponse = z.infer<typeof routineExerciseResponseSchema>;
export type RoutineResponse = z.infer<typeof routineResponseSchema>;
export type RoutineDetailResponse = z.infer<typeof routineDetailResponseSchema>;
export type RoutineListResponse = z.infer<typeof routineListResponseSchema>;
export type RoutineListQuery = z.infer<typeof routineListQuerySchema>;
export type PostRoutineRequest = z.infer<typeof postRoutineRequestSchema>;
export type PatchRoutineRequest = z.infer<typeof patchRoutineRequestSchema>;
export type PostRoutineExerciseRequest = z.infer<typeof postRoutineExerciseRequestSchema>;
export type PatchRoutineExerciseRequest = z.infer<typeof patchRoutineExerciseRequestSchema>;
export type PutRoutineExercisesRequest = z.infer<typeof putRoutineExercisesRequestSchema>;
