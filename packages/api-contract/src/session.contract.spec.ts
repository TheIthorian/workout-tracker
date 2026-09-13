import { describe, expect, it } from 'vitest';
import {
    patchSessionExerciseRequestSchema,
    postSessionRequestSchema,
    postSetRequestSchema,
} from './session.contract.js';

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
