import { Equipment, RoutineOrder, TrackingType } from '@app/domain';
import { describe, expect, it } from 'vitest';
import {
    patchRoutineExerciseRequestSchema,
    patchRoutineRequestSchema,
    postRoutineExerciseRequestSchema,
    putRoutineExercisesRequestSchema,
    routineExerciseSummarySchema,
    routineListItemSchema,
    routineListQuerySchema,
    routineResponseSchema,
} from './routine.contract.js';

const exerciseId = '4b6c7e39-0f8b-4c8b-9a8e-2d1f0f0e1a11';

const summary = {
    id: exerciseId,
    name: 'Bench press',
    trackingType: TrackingType.WeightReps,
    isCatalog: true,
    equipment: [Equipment.Barbell, Equipment.Bench],
    archivedAt: null,
};

describe('routineExerciseSummarySchema', () => {
    it('carries the exercise equipment', () => {
        expect(routineExerciseSummarySchema.parse(summary).equipment).toEqual([Equipment.Barbell, Equipment.Bench]);
    });

    it('reads a bodyweight exercise as an empty list', () => {
        expect(routineExerciseSummarySchema.parse({ ...summary, equipment: [] }).equipment).toEqual([]);
    });

    it('requires equipment and rejects a value outside the vocabulary', () => {
        expect(routineExerciseSummarySchema.safeParse({ ...summary, equipment: undefined }).success).toBe(false);
        expect(routineExerciseSummarySchema.safeParse({ ...summary, equipment: ['jetpack'] }).success).toBe(false);
    });
});

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

    it('accepts excluding a routine from recommendations', () => {
        expect(patchRoutineRequestSchema.parse({ excludedFromRecommendations: true })).toEqual({
            excludedFromRecommendations: true,
        });
    });
});

describe('routineListQuerySchema', () => {
    it('reads includeArchived as a boolean', () => {
        expect(routineListQuerySchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
        expect(routineListQuerySchema.parse({}).includeArchived).toBe(false);
    });

    it('sorts by name unless recommended order is asked for', () => {
        expect(routineListQuerySchema.parse({}).sort).toBe(RoutineOrder.Name);
        expect(routineListQuerySchema.parse({ sort: 'recommended' }).sort).toBe(RoutineOrder.Recommended);
        expect(routineListQuerySchema.safeParse({ sort: 'random' }).success).toBe(false);
    });
});

describe('routineResponseSchema', () => {
    const routine = {
        id: '4b6c7e39-0f8b-4c8b-9a8e-2d1f0f0e1a12',
        name: 'Push Day',
        description: null,
        archivedAt: null,
        excludedFromRecommendations: false,
        exerciseCount: 2,
        estimatedDurationSeconds: 2400,
        lastCompletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('carries the estimated duration', () => {
        expect(routineResponseSchema.parse(routine).estimatedDurationSeconds).toBe(2400);
    });

    it('accepts zero for a routine with nothing to estimate', () => {
        expect(routineResponseSchema.parse({ ...routine, estimatedDurationSeconds: 0 }).estimatedDurationSeconds).toBe(
            0,
        );
    });

    it('carries the last completion, and null for a routine never done', () => {
        expect(routineResponseSchema.parse(routine).lastCompletedAt).toBeNull();
        expect(
            routineResponseSchema.parse({ ...routine, lastCompletedAt: '2026-01-05T09:00:00.000Z' }).lastCompletedAt,
        ).toBe('2026-01-05T09:00:00.000Z');
    });

    it('rejects a missing last completion', () => {
        expect(routineResponseSchema.safeParse({ ...routine, lastCompletedAt: undefined }).success).toBe(false);
    });

    it('rejects a missing or negative duration', () => {
        expect(routineResponseSchema.safeParse({ ...routine, estimatedDurationSeconds: undefined }).success).toBe(
            false,
        );
        expect(routineResponseSchema.safeParse({ ...routine, estimatedDurationSeconds: -1 }).success).toBe(false);
    });
});

describe('routineListItemSchema', () => {
    const item = {
        id: '4b6c7e39-0f8b-4c8b-9a8e-2d1f0f0e1a12',
        name: 'Push Day',
        description: null,
        archivedAt: null,
        excludedFromRecommendations: false,
        exerciseCount: 2,
        estimatedDurationSeconds: 2400,
        lastCompletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        recommendationScore: 64,
    };

    it('carries a 0-100 score, or null for a routine that is not recommended', () => {
        expect(routineListItemSchema.parse(item).recommendationScore).toBe(64);
        expect(routineListItemSchema.parse({ ...item, recommendationScore: null }).recommendationScore).toBeNull();
        expect(routineListItemSchema.safeParse({ ...item, recommendationScore: 101 }).success).toBe(false);
    });
});
