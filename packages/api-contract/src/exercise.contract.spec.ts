import { Equipment, MuscleGroup, TrackingType } from '@app/domain';
import { describe, expect, it } from 'vitest';
import {
    exerciseListQuerySchema,
    exerciseResponseSchema,
    patchExerciseRequestSchema,
    postExerciseLinkRequestSchema,
    postExerciseRequestSchema,
    putExercisePreferencesRequestSchema,
} from './exercise.contract.js';

describe('postExerciseRequestSchema', () => {
    it('accepts a name and a tracking type', () => {
        const parsed = postExerciseRequestSchema.parse({ name: 'Bench Press', trackingType: 'weight_reps' });

        expect(parsed.trackingType).toBe(TrackingType.WeightReps);
    });

    it('rejects an unknown tracking type', () => {
        expect(() => postExerciseRequestSchema.parse({ name: 'Bench Press', trackingType: 'vibes' })).toThrow();
    });

    it('rejects an empty name', () => {
        expect(() => postExerciseRequestSchema.parse({ name: '', trackingType: 'duration' })).toThrow();
    });

    it('accepts the guide fields', () => {
        const parsed = postExerciseRequestSchema.parse({
            name: 'Plank',
            trackingType: 'duration',
            guideSetup: 'Forearms under shoulders.',
            guideCues: 'Ribs down, glutes on.',
        });

        expect(parsed.guideSetup).toBe('Forearms under shoulders.');
    });
});

describe('patchExerciseRequestSchema', () => {
    it('rejects an empty body', () => {
        expect(() => patchExerciseRequestSchema.parse({})).toThrow();
    });

    it('accepts a single field', () => {
        expect(patchExerciseRequestSchema.parse({ guideCues: 'Elbows at 45 degrees.' })).toMatchObject({
            guideCues: 'Elbows at 45 degrees.',
        });
    });
});

describe('exerciseListQuerySchema', () => {
    it('rejects a junk includeArchived value instead of coercing it', () => {
        expect(() => exerciseListQuerySchema.parse({ includeArchived: 'yes' })).toThrow();
    });

    it('parses "true" to true', () => {
        expect(exerciseListQuerySchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
    });

    it('defaults to false when absent', () => {
        expect(exerciseListQuerySchema.parse({}).includeArchived).toBe(false);
    });
});

describe('postExerciseLinkRequestSchema', () => {
    it('accepts an https url with a label', () => {
        expect(
            postExerciseLinkRequestSchema.parse({ url: 'https://example.com/bench', label: 'Form check' }),
        ).toMatchObject({ url: 'https://example.com/bench' });
    });

    it('rejects a non-url', () => {
        expect(() => postExerciseLinkRequestSchema.parse({ url: 'not a url' })).toThrow();
    });
});

describe('exerciseResponseSchema', () => {
    it('requires isCatalog and slug on a response', () => {
        const result = exerciseResponseSchema.safeParse({
            id: '11111111-1111-4111-8111-111111111111',
            name: 'x',
            trackingType: 'weight_reps',
            notes: null,
            restSeconds: null,
            archivedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        expect(result.success).toBe(false);
    });
});

describe('exercise equipment', () => {
    it('defaults equipment to an empty list on create and rejects duplicates', () => {
        expect(postExerciseRequestSchema.parse({ name: 'Plank', trackingType: 'duration' }).equipment).toEqual([]);
        expect(
            postExerciseRequestSchema.safeParse({
                name: 'Squat',
                trackingType: 'weight_reps',
                equipment: [Equipment.Barbell, Equipment.Barbell],
            }).success,
        ).toBe(false);
        expect(
            postExerciseRequestSchema.safeParse({ name: 'Squat', trackingType: 'weight_reps', equipment: ['vibes'] })
                .success,
        ).toBe(false);
    });

    it('parses the equipment list query as absent, empty, or a list', () => {
        expect(exerciseListQuerySchema.parse({}).equipment).toBeUndefined();
        expect(exerciseListQuerySchema.parse({ equipment: '' }).equipment).toEqual([]);
        expect(exerciseListQuerySchema.parse({ equipment: 'barbell,bench' }).equipment).toEqual([
            Equipment.Barbell,
            Equipment.Bench,
        ]);
        expect(exerciseListQuerySchema.safeParse({ equipment: 'barbell,vibes' }).success).toBe(false);
    });
});

describe('putExercisePreferencesRequestSchema', () => {
    it('accepts zero rest, meaning no timer', () => {
        expect(putExercisePreferencesRequestSchema.parse({ restSeconds: 0 })).toEqual({ restSeconds: 0 });
    });

    it('rejects a negative or fractional rest', () => {
        expect(putExercisePreferencesRequestSchema.safeParse({ restSeconds: -1 }).success).toBe(false);
        expect(putExercisePreferencesRequestSchema.safeParse({ restSeconds: 1.5 }).success).toBe(false);
    });
});

describe('exercise muscles', () => {
    it('defaults both lists to empty on create and rejects an unknown or repeated muscle', () => {
        const created = postExerciseRequestSchema.parse({ name: 'Plank', trackingType: 'duration' });

        expect(created.primaryMuscles).toEqual([]);
        expect(created.secondaryMuscles).toEqual([]);
        expect(
            postExerciseRequestSchema.safeParse({
                name: 'Curl',
                trackingType: 'weight_reps',
                primaryMuscles: [MuscleGroup.Biceps, MuscleGroup.Biceps],
            }).success,
        ).toBe(false);
        expect(
            postExerciseRequestSchema.safeParse({
                name: 'Curl',
                trackingType: 'weight_reps',
                primaryMuscles: ['spleen'],
            }).success,
        ).toBe(false);
    });

    it('accepts a single muscle as a library filter and rejects anything else', () => {
        expect(exerciseListQuerySchema.parse({}).muscle).toBeUndefined();
        expect(exerciseListQuerySchema.parse({ muscle: 'lats' }).muscle).toBe(MuscleGroup.Lats);
        expect(exerciseListQuerySchema.safeParse({ muscle: 'spleen' }).success).toBe(false);
    });
});
