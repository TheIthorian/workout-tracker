import { NextEffortSource, TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema } from './primitives.js';
import { setMeasurementsSchema } from './session.contract.js';

/**
 * The target that currently applies to an exercise. Targets are appended rather than overwritten,
 * so this is the newest one stored, and `createdAt` is when it was set.
 */
export const exerciseTargetResponseSchema = z.object({
    id: guidSchema,
    exerciseId: guidSchema,
    trackingType: z.enum(TrackingType),
    weightKg: z.number().nullable(),
    reps: z.number().int().nullable(),
    durationSeconds: z.number().int().nullable(),
    distanceM: z.number().nullable(),
    /** What the app says when it offers the target; a coach's own wording wins over the default. */
    note: z.string().nullable(),
    createdAt: z.string(),
});

/**
 * The body of `PUT /api/v1/workspaces/{workspaceId}/exercises/{exerciseId}/target`. Each call stores
 * a whole new target, so an omitted measurement is absent from it rather than carried over from the
 * target before — merging the two would mix two sessions' intentions.
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
    /** The newest stored target, present even when it has been spent and no longer drives this answer. */
    target: exerciseTargetResponseSchema.nullable(),
});

export type ExerciseTargetResponse = z.infer<typeof exerciseTargetResponseSchema>;
export type PutExerciseTargetRequest = z.infer<typeof putExerciseTargetRequestSchema>;
export type ExerciseSuggestionResponse = z.infer<typeof exerciseSuggestionResponseSchema>;
