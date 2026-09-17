import { Equipment } from '@app/domain';
import { describe, expect, it } from 'vitest';
import {
    patchSessionExerciseRequestSchema,
    postSessionRequestSchema,
    postSetRequestSchema,
    sessionExerciseSummarySchema,
} from './session.contract.js';

const summary = {
    id: '4b6c7e39-0f8b-4c8b-9a8e-2d1f0f0e1a11',
    name: 'Bench press',
    isCatalog: true,
    equipment: [Equipment.Barbell, Equipment.Bench],
    archivedAt: null,
};

describe('sessionExerciseSummarySchema', () => {
    it('carries the exercise equipment', () => {
        expect(sessionExerciseSummarySchema.parse(summary).equipment).toEqual([Equipment.Barbell, Equipment.Bench]);
    });

    it('reads a bodyweight exercise as an empty list', () => {
        expect(sessionExerciseSummarySchema.parse({ ...summary, equipment: [] }).equipment).toEqual([]);
    });

    it('requires equipment and rejects a value outside the vocabulary', () => {
        expect(sessionExerciseSummarySchema.safeParse({ ...summary, equipment: undefined }).success).toBe(false);
        expect(sessionExerciseSummarySchema.safeParse({ ...summary, equipment: ['jetpack'] }).success).toBe(false);
    });
});

describe('session contract', () => {
    it('allows an empty start body', () => {
        expect(postSessionRequestSchema.parse(undefined)).toEqual({});
    });

    it('requires a meaningful session-exercise patch', () => {
        expect(patchSessionExerciseRequestSchema.safeParse({}).success).toBe(false);
        expect(patchSessionExerciseRequestSchema.parse({ skipped: true })).toEqual({ skipped: true });
    });

    it('defaults a logged set to working rather than warm-up', () => {
        expect(postSetRequestSchema.parse({ reps: 8, weightKg: 60 })).toEqual({
            isWarmup: false,
            reps: 8,
            weightKg: 60,
        });
    });
});
