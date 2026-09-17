import { Equipment, SessionExerciseSource, TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema, paginatedResponseSchema, paginationQuerySchema } from './primitives.js';

export const sessionSetResponseSchema = z.object({
    id: guidSchema,
    setIndex: z.number().int(),
    completedAt: z.string(),
    isWarmup: z.boolean(),
    rpe: z.number().nullable(),
    weightKg: z.number().nullable(),
    reps: z.number().int().nullable(),
    durationSeconds: z.number().int().nullable(),
    distanceM: z.number().nullable(),
});
export const sessionExerciseSummarySchema = z.object({
    id: guidSchema,
    name: z.string(),
    isCatalog: z.boolean(),
    /** What the movement needs; empty means bodyweight. */
    equipment: z.array(z.enum(Equipment)),
    archivedAt: z.string().nullable(),
});
export const sessionExerciseResponseSchema = z.object({
    id: guidSchema,
    position: z.number().int(),
    source: z.enum(SessionExerciseSource),
    trackingType: z.enum(TrackingType),
    targetSets: z.number().int(),
    restSeconds: z.number().int().nullable(),
    notes: z.string().nullable(),
    skippedAt: z.string().nullable(),
    targetReps: z.number().int().nullable(),
    targetWeightKg: z.number().nullable(),
    targetDurationSeconds: z.number().int().nullable(),
    targetDistanceM: z.number().nullable(),
    exercise: sessionExerciseSummarySchema,
    sets: z.array(sessionSetResponseSchema),
});
export const sessionProgressSchema = z.object({
    totalExercises: z.number().int(),
    completedExercises: z.number().int(),
    skippedExercises: z.number().int(),
    targetSets: z.number().int(),
    loggedSets: z.number().int(),
});
export const sessionStateSchema = z.object({
    currentSessionExerciseId: guidSchema.nullable(),
    nextSetIndex: z.number().int().nullable(),
    progress: sessionProgressSchema,
    canComplete: z.boolean(),
});
export const sessionResponseSchema = z.object({
    id: guidSchema,
    name: z.string(),
    routineId: guidSchema.nullable(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    notes: z.string().nullable(),
    exerciseCount: z.number().int(),
    setCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export const sessionDetailResponseSchema = sessionResponseSchema.extend({
    exercises: z.array(sessionExerciseResponseSchema),
    state: sessionStateSchema,
});
export const sessionListResponseSchema = paginatedResponseSchema(sessionResponseSchema);
export const activeSessionResponseSchema = z.object({ session: sessionDetailResponseSchema.nullable() });
export const sessionListQuerySchema = paginationQuerySchema;
export const postSessionRequestSchema = z
    .object({ routineId: guidSchema.nullable().optional(), name: z.string().min(1).max(200).nullable().optional() })
    .default({});
export const completeSessionRequestSchema = z.object({ notes: z.string().max(4000).nullable().optional() }).default({});
const targetsSchema = z.object({
    targetSets: z.number().int().min(1).max(100),
    restSeconds: z.number().int().min(0).max(3600).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    targetReps: z.number().int().min(0).max(1000).nullable().optional(),
    targetWeightKg: z.number().min(0).max(10000).nullable().optional(),
    targetDurationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    targetDistanceM: z.number().min(0).max(1000000).nullable().optional(),
});
export const postSessionExerciseRequestSchema = targetsSchema.extend({
    exerciseId: guidSchema,
    targetSets: z.number().int().min(1).max(100).default(3),
});
export const patchSessionExerciseRequestSchema = targetsSchema
    .partial()
    .extend({ skipped: z.boolean().optional() })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });
export const putSessionExerciseOrderRequestSchema = z.object({
    sessionExerciseIds: z
        .array(guidSchema)
        .min(1)
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'Each id may appear once' }),
});
const measurementsSchema = z.object({
    weightKg: z.number().min(0).max(10000).nullable().optional(),
    reps: z.number().int().min(0).max(1000).nullable().optional(),
    durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    distanceM: z.number().min(0).max(1000000).nullable().optional(),
});
export const postSetRequestSchema = measurementsSchema.extend({
    isWarmup: z.boolean().default(false),
    rpe: z.number().min(0).max(10).nullable().optional(),
});
export const patchSetRequestSchema = measurementsSchema
    .extend({ isWarmup: z.boolean().optional(), rpe: z.number().min(0).max(10).nullable().optional() })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });
export const exerciseHistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
export const exerciseHistoryEntrySchema = z.object({
    sessionId: guidSchema,
    sessionName: z.string(),
    startedAt: z.string(),
    completedAt: z.string(),
    sessionExerciseId: guidSchema,
    trackingType: z.enum(TrackingType),
    sets: z.array(sessionSetResponseSchema),
});
export const exerciseHistoryResponseSchema = z.object({ data: z.array(exerciseHistoryEntrySchema) });
export type SessionSetResponse = z.infer<typeof sessionSetResponseSchema>;
export type SessionExerciseResponse = z.infer<typeof sessionExerciseResponseSchema>;
export type SessionStateResponse = z.infer<typeof sessionStateSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type ActiveSessionResponse = z.infer<typeof activeSessionResponseSchema>;
export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;
export type PostSessionRequest = z.infer<typeof postSessionRequestSchema>;
export type CompleteSessionRequest = z.infer<typeof completeSessionRequestSchema>;
export type PostSessionExerciseRequest = z.infer<typeof postSessionExerciseRequestSchema>;
export type PatchSessionExerciseRequest = z.infer<typeof patchSessionExerciseRequestSchema>;
export type PutSessionExerciseOrderRequest = z.infer<typeof putSessionExerciseOrderRequestSchema>;
export type PostSetRequest = z.infer<typeof postSetRequestSchema>;
export type PatchSetRequest = z.infer<typeof patchSetRequestSchema>;
export type ExerciseHistoryQuery = z.infer<typeof exerciseHistoryQuerySchema>;
export type ExerciseHistoryEntry = z.infer<typeof exerciseHistoryEntrySchema>;
export type ExerciseHistoryResponse = z.infer<typeof exerciseHistoryResponseSchema>;
