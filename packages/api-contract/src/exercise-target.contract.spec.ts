import { NextEffortSource, TrackingType } from '@app/domain';
import { describe, expect, it } from 'vitest';
import {
    exerciseSuggestionResponseSchema,
    exerciseTargetResponseSchema,
    putExerciseTargetRequestSchema,
} from './exercise-target.contract.js';

const EXERCISE_ID = '3f1b2c44-8a3e-4f5b-9f0a-2c1d4e5f6a7b';
const TARGET_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('putExerciseTargetRequestSchema', () => {
    it('accepts a single measurement', () => {
        expect(putExerciseTargetRequestSchema.parse({ weightKg: 82.5 })).toMatchObject({ weightKg: 82.5 });
    });

    it('accepts a coaching note alongside the measurements', () => {
        const parsed = putExerciseTargetRequestSchema.parse({ reps: 5, note: 'Build to a heavy five.' });

        expect(parsed.note).toBe('Build to a heavy five.');
    });

    it('rejects a body with nothing to aim at', () => {
        expect(() => putExerciseTargetRequestSchema.parse({})).toThrow();
        expect(() => putExerciseTargetRequestSchema.parse({ note: 'Push hard.' })).toThrow();
        expect(() => putExerciseTargetRequestSchema.parse({ weightKg: null, reps: null })).toThrow();
    });

    it('rejects a negative measurement', () => {
        expect(() => putExerciseTargetRequestSchema.parse({ weightKg: -5 })).toThrow();
    });

    it('rejects an unrecognised field rather than dropping it', () => {
        expect(() => putExerciseTargetRequestSchema.parse({ reps: 5, rpe: 8 })).toThrow();
    });
});

describe('exerciseTargetResponseSchema', () => {
    it('accepts a stored target with the measurements its tracking type leaves unset', () => {
        const parsed = exerciseTargetResponseSchema.parse({
            id: TARGET_ID,
            exerciseId: EXERCISE_ID,
            trackingType: 'weight_reps',
            weightKg: 82.5,
            reps: 5,
            durationSeconds: null,
            distanceM: null,
            note: null,
            createdAt: '2026-09-17T10:00:00.000Z',
        });

        expect(parsed.trackingType).toBe(TrackingType.WeightReps);
    });
});

describe('exerciseSuggestionResponseSchema', () => {
    const baseline = {
        exerciseId: EXERCISE_ID,
        trackingType: 'weight_reps',
        source: 'baseline',
        isFirstAttempt: true,
        message: 'Keep it light.',
        weightKg: null,
        reps: null,
        durationSeconds: null,
        distanceM: null,
        lastPerformedAt: null,
        target: null,
    };

    it('accepts a baseline answer, which carries advice and no numbers', () => {
        const parsed = exerciseSuggestionResponseSchema.parse(baseline);

        expect(parsed.source).toBe(NextEffortSource.Baseline);
        expect(parsed.target).toBeNull();
    });

    it('accepts an answer carrying the target it came from', () => {
        const parsed = exerciseSuggestionResponseSchema.parse({
            ...baseline,
            source: 'target',
            isFirstAttempt: false,
            weightKg: 82.5,
            reps: 5,
            lastPerformedAt: '2026-09-10T10:00:00.000Z',
            target: {
                id: TARGET_ID,
                exerciseId: EXERCISE_ID,
                trackingType: 'weight_reps',
                weightKg: 82.5,
                reps: 5,
                durationSeconds: null,
                distanceM: null,
                note: null,
                createdAt: '2026-09-17T10:00:00.000Z',
            },
        });

        expect(parsed.source).toBe(NextEffortSource.Target);
        expect(parsed.target?.weightKg).toBe(82.5);
    });

    it('rejects a source outside the vocabulary', () => {
        expect(() => exerciseSuggestionResponseSchema.parse({ ...baseline, source: 'vibes' })).toThrow();
    });
});
