import { MuscleGroup } from '@app/domain';
import { z } from 'zod';
import { guidSchema } from './primitives.js';

/** How far back the muscle heatmap looks by default. */
export const DEFAULT_MUSCLE_VOLUME_DAYS = 30;
export const MAX_MUSCLE_VOLUME_DAYS = 365;

/**
 * Query parameters for `GET /api/v1/workspaces/{workspaceId}/analytics/muscle-volume`.
 *
 * The window is a number of days back rather than a pair of dates: the client asks for "the last
 * month" without having to agree with the server on which timezone's midnight that starts at.
 */
export const muscleVolumeQuerySchema = z.object({
    days: z
        .unknown()
        .optional()
        .transform((raw) => {
            if (raw === undefined || raw === null || raw === '') return DEFAULT_MUSCLE_VOLUME_DAYS;
            const parsed = Number.parseInt(String(raw), 10);
            if (Number.isNaN(parsed)) return DEFAULT_MUSCLE_VOLUME_DAYS;
            return Math.max(1, Math.min(parsed, MAX_MUSCLE_VOLUME_DAYS));
        })
        .pipe(z.number().int()),
});

/** One muscle's share of the period's work. */
export const muscleVolumeEntrySchema = z.object({
    muscle: z.enum(MuscleGroup),
    /** Sets whose exercise names this muscle at all. */
    sets: z.number().int(),
    /** Sets weighted by engagement — a secondary muscle counts half. */
    weightedSets: z.number(),
    /** `weightedSets` as a share of the hardest-worked muscle's, 0 to 1. */
    intensity: z.number(),
});

/** One exercise's contribution, so the heatmap can say what drove a hot spot. */
export const muscleVolumeExerciseSchema = z.object({
    exerciseId: guidSchema,
    name: z.string(),
    sets: z.number().int(),
    primaryMuscles: z.array(z.enum(MuscleGroup)),
    secondaryMuscles: z.array(z.enum(MuscleGroup)),
});

export const muscleVolumeResponseSchema = z.object({
    days: z.number().int(),
    /** Inclusive start of the window, ISO 8601. */
    since: z.string(),
    sessionCount: z.number().int(),
    /** Working sets across the window, whether or not their exercise tags any muscle. */
    totalSets: z.number().int(),
    /** Sets whose exercise tags no muscle at all, so the page can explain a thin heatmap. */
    untaggedSets: z.number().int(),
    muscles: z.array(muscleVolumeEntrySchema),
    exercises: z.array(muscleVolumeExerciseSchema),
});

export type MuscleVolumeQuery = z.infer<typeof muscleVolumeQuerySchema>;
export type MuscleVolumeEntry = z.infer<typeof muscleVolumeEntrySchema>;
export type MuscleVolumeExercise = z.infer<typeof muscleVolumeExerciseSchema>;
export type MuscleVolumeResponse = z.infer<typeof muscleVolumeResponseSchema>;
