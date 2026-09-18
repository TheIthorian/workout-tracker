import { Equipment, MuscleGroup, TrackingType } from '@app/domain';
import { z } from 'zod';
import { equipmentListSchema, muscleListSchema } from './exercise.contract.js';
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

/** `list_exercises`. */
export const listExercisesToolArgsSchema = z.strictObject({
    search: z.string().max(200).nullish(),
    includeArchived: z.boolean().nullish(),
    equipment: z.array(z.enum(Equipment)).nullish(),
    muscle: z.enum(MuscleGroup).nullish(),
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
    equipment: equipmentListSchema.nullish(),
    primaryMuscles: muscleListSchema.nullish(),
    secondaryMuscles: muscleListSchema.nullish(),
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

/** One slot in a routine as a tool supplies it. Omitted targets are left unset. */
export const routineExerciseToolInputSchema = z.strictObject({
    exerciseId: guidSchema,
    targetSets: z.number().int().min(1).max(100).nullish(),
    restSeconds: z.number().int().min(0).max(3600).nullish(),
    notes: z.string().max(1000).nullish(),
    targetReps: z.number().int().min(0).max(1000).nullish(),
    targetWeightKg: z.number().min(0).max(10000).nullish(),
    targetDurationSeconds: z.number().int().min(0).max(86400).nullish(),
    targetDistanceM: z.number().min(0).max(1000000).nullish(),
});

/** `list_routines`. */
export const listRoutinesToolArgsSchema = z.strictObject({
    search: z.string().max(200).nullish(),
    includeArchived: z.boolean().nullish(),
    page: z.number().int().min(1).nullish(),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).nullish(),
});

/** `get_routine`. */
export const getRoutineToolArgsSchema = z.strictObject({
    routineId: guidSchema,
});

/** `create_routine`. `exercises`, when given, is the complete ordered list. */
export const createRoutineToolArgsSchema = z.strictObject({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullish(),
    exercises: z.array(routineExerciseToolInputSchema).max(50).nullish(),
});

/** `update_routine`. An omitted key leaves the stored value alone; `exercises` replaces the whole list. */
export const updateRoutineToolArgsSchema = z.strictObject({
    routineId: guidSchema,
    name: z.string().min(1).max(200).nullish(),
    description: z.string().max(2000).nullish(),
    archived: z.boolean().nullish(),
    exercises: z.array(routineExerciseToolInputSchema).max(50).nullish(),
});

/** `list_sessions`. */
export const listSessionsToolArgsSchema = z.strictObject({
    page: z.number().int().min(1).nullish(),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).nullish(),
});

/** `get_active_session` takes no arguments. */
export const getActiveSessionToolArgsSchema = z.strictObject({});

/** `get_session`. */
export const getSessionToolArgsSchema = z.strictObject({ sessionId: guidSchema });

/** `start_session`. */
export const startSessionToolArgsSchema = z.strictObject({
    routineId: guidSchema.nullish(),
    name: z.string().min(1).max(200).nullish(),
});

/** `log_set`. */
export const logSetToolArgsSchema = z.strictObject({
    sessionId: guidSchema,
    sessionExerciseId: guidSchema,
    isWarmup: z.boolean().nullish(),
    rpe: z.number().min(0).max(10).nullish(),
    weightKg: z.number().min(0).max(10000).nullish(),
    reps: z.number().int().min(0).max(1000).nullish(),
    durationSeconds: z.number().int().min(0).max(86400).nullish(),
    distanceM: z.number().min(0).max(1000000).nullish(),
});

/** `complete_session`. */
export const completeSessionToolArgsSchema = z.strictObject({
    sessionId: guidSchema,
    notes: z.string().max(4000).nullish(),
});

export type GetCurrentUserToolArgs = z.infer<typeof getCurrentUserToolArgsSchema>;
export type ListExercisesToolArgs = z.infer<typeof listExercisesToolArgsSchema>;
export type GetExerciseToolArgs = z.infer<typeof getExerciseToolArgsSchema>;
export type CreateExerciseToolArgs = z.infer<typeof createExerciseToolArgsSchema>;
export type UpdateExerciseToolArgs = z.infer<typeof updateExerciseToolArgsSchema>;
export type AddExerciseLinkToolArgs = z.infer<typeof addExerciseLinkToolArgsSchema>;
export type RoutineExerciseToolInput = z.infer<typeof routineExerciseToolInputSchema>;
export type ListRoutinesToolArgs = z.infer<typeof listRoutinesToolArgsSchema>;
export type GetRoutineToolArgs = z.infer<typeof getRoutineToolArgsSchema>;
export type CreateRoutineToolArgs = z.infer<typeof createRoutineToolArgsSchema>;
export type UpdateRoutineToolArgs = z.infer<typeof updateRoutineToolArgsSchema>;
export type ListSessionsToolArgs = z.infer<typeof listSessionsToolArgsSchema>;
export type GetActiveSessionToolArgs = z.infer<typeof getActiveSessionToolArgsSchema>;
export type GetSessionToolArgs = z.infer<typeof getSessionToolArgsSchema>;
export type StartSessionToolArgs = z.infer<typeof startSessionToolArgsSchema>;
export type LogSetToolArgs = z.infer<typeof logSetToolArgsSchema>;
export type CompleteSessionToolArgs = z.infer<typeof completeSessionToolArgsSchema>;
