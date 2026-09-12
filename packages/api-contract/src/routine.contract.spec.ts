import { describe, expect, it } from 'vitest';
import {
    patchRoutineExerciseRequestSchema,
    patchRoutineRequestSchema,
    postRoutineExerciseRequestSchema,
    putRoutineExercisesRequestSchema,
    routineListQuerySchema,
} from './routine.contract.js';

const exerciseId = '4b6c7e39-0f8b-4c8b-9a8e-2d1f0f0e1a11';

describe('postRoutineExerciseRequestSchema', () => {
    it('defaults targetSets to 3', () => {
        expect(postRoutineExerciseRequestSchema.parse({ exerciseId })).toMatchObject({ exerciseId, targetSets: 3 });
    });

    it('rejects zero sets and negative targets', () => {
        expect(postRoutineExerciseRequestSchema.safeParse({ exerciseId, targetSets: 0 }).success).toBe(false);
        expect(postRoutineExerciseRequestSchema.safeParse({ exerciseId, targetWeightKg: -1 }).success).toBe(false);
        expect(postRoutineExerciseRequestSchema.safeParse({ exerciseId, restSeconds: -5 }).success).toBe(false);
    });

    it('accepts explicit nulls to clear a target', () => {
        expect(postRoutineExerciseRequestSchema.parse({ exerciseId, targetReps: null }).targetReps).toBeNull();
    });
});

describe('patchRoutineExerciseRequestSchema', () => {
    it('requires at least one field', () => {
        expect(patchRoutineExerciseRequestSchema.safeParse({}).success).toBe(false);
        expect(patchRoutineExerciseRequestSchema.safeParse({ targetSets: 4 }).success).toBe(true);
    });

    it('does not accept exerciseId or position', () => {
        expect(patchRoutineExerciseRequestSchema.safeParse({ exerciseId }).success).toBe(false);
        expect(patchRoutineExerciseRequestSchema.safeParse({ position: 1 }).success).toBe(false);
    });
});

describe('putRoutineExercisesRequestSchema', () => {
    it('accepts an empty list', () => {
        expect(putRoutineExercisesRequestSchema.parse({ exercises: [] }).exercises).toEqual([]);
    });

    it('caps the list at 50', () => {
        const exercises = Array.from({ length: 51 }, () => ({ exerciseId }));
        expect(putRoutineExercisesRequestSchema.safeParse({ exercises }).success).toBe(false);
    });
});

describe('patchRoutineRequestSchema', () => {
    it('requires at least one field', () => {
        expect(patchRoutineRequestSchema.safeParse({}).success).toBe(false);
        expect(patchRoutineRequestSchema.safeParse({ archived: true }).success).toBe(true);
    });
});

describe('routineListQuerySchema', () => {
    it('reads includeArchived as a boolean', () => {
        expect(routineListQuerySchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
        expect(routineListQuerySchema.parse({}).includeArchived).toBe(false);
    });
});
