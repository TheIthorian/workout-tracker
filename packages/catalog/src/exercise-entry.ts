import { Equipment, MuscleGroup, TrackingType } from '@app/domain';
import { z } from 'zod';

/** The directory name of a catalog entry. Doubles as the row's slug, so it must be URL-safe. */
export const CATALOG_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const guideField = z.string().max(4000).nullable().default(null);

const muscleList = z
    .array(z.enum(MuscleGroup))
    .refine((list) => new Set(list).size === list.length, { message: 'Muscles must not repeat' });

/** One `exercise.json`. Mirrors the limits `postExerciseRequestSchema` enforces on custom exercises. */
export const exerciseEntrySchema = z.object({
    name: z.string().min(1).max(200),
    trackingType: z.enum(TrackingType),
    /** Everything the movement requires. Empty means bodyweight. */
    equipment: z
        .array(z.enum(Equipment))
        .refine((list) => new Set(list).size === list.length, { message: 'Equipment must not repeat' })
        .default([]),
    notes: z.string().max(2000).nullable().default(null),
    /** What the movement trains. `primary` is what it is for; `secondary` assists or stabilises. */
    muscles: z
        .object({
            primary: muscleList.default([]),
            secondary: muscleList.default([]),
        })
        .default({ primary: [], secondary: [] }),
    guide: z
        .object({
            setup: guideField,
            execution: guideField,
            cues: guideField,
            mistakes: guideField,
        })
        .default({ setup: null, execution: null, cues: null, mistakes: null }),
    links: z
        .array(
            z.object({
                url: z.url().max(2000),
                label: z.string().max(200).nullable().default(null),
            }),
        )
        .default([]),
    images: z
        .array(
            z.object({
                file: z.string().min(1),
                caption: z.string().max(200).nullable().default(null),
            }),
        )
        .default([]),
});

export type ExerciseEntry = z.infer<typeof exerciseEntrySchema>;
