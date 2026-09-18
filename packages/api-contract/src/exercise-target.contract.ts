import { NextEffortSource, TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema } from './primitives.js';
import { setMeasurementsSchema } from './session.contract.js';

/** A target waiting to be used, as stored for one exercise in one workspace. */
export const exerciseTargetResponseSchema = z.object({
    exerciseId: guidSchema,
    trackingType: z.enum(TrackingType),
    weightKg: z.number().nullable(),
    reps: z.number().int().nullable(),
    durationSeconds: z.number().int().nullable(),
    distanceM: z.number().nullable(),
    /** What the app says when it offers the target; a coach's own wording wins over the default. */
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/**
 * The body of `PUT /api/v1/workspaces/{workspaceId}/exercises/{exerciseId}/target`. The whole target
 * is replaced, so an omitted measurement is cleared rather than kept — a partially updated target
 * would mix two sessions' intentions.
 */
export const putExerciseTargetRequestSchema = setMeasurementsSchema
    .extend({ note: z.string().max(500).nullable().optional() })
    .strict()
    .refine(
        (body) =>
            [body.weightKg, body.reps, body.durationSeconds, body.distanceM].some(
                (value) => value !== undefined && value !== null,
            ),
        { message: 'At least one measurement must be provided' },
    );

/** The answer to `GET /api/v1/workspaces/{workspaceId}/exercises/{exerciseId}/suggestion`. */
export const exerciseSuggestionResponseSchema = z.object({
    exerciseId: guidSchema,
    trackingType: z.enum(TrackingType),
    source: z.enum(NextEffortSource),
    /** True when nothing has been logged for the exercise yet, which is what `message` then advises on. */
    isFirstAttempt: z.boolean(),
    message: z.string(),
    weightKg: z.number().nullable(),
    reps: z.number().int().nullable(),
    durationSeconds: z.number().int().nullable(),
    distanceM: z.number().nullable(),
    /** When the exercise was last trained, or null on a first attempt. */
    lastPerformedAt: z.string().nullable(),
    /** The stored target, present even when it has been spent and no longer drives the suggestion. */
    target: exerciseTargetResponseSchema.nullable(),
});

export type ExerciseTargetResponse = z.infer<typeof exerciseTargetResponseSchema>;
export type PutExerciseTargetRequest = z.infer<typeof putExerciseTargetRequestSchema>;
export type ExerciseSuggestionResponse = z.infer<typeof exerciseSuggestionResponseSchema>;
