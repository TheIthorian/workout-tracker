import { describe, expect, it } from 'vitest';
import { TrackingType } from './exercise';
import { describeTargets, formatEstimatedDuration, type RoutineExercise } from './routine';

function slot(overrides: Partial<RoutineExercise> & { trackingType: TrackingType }): RoutineExercise {
    const { trackingType, ...rest } = overrides;
    return {
        id: 'slot',
        position: 0,
        targetSets: 3,
        restSeconds: null,
        notes: null,
        targetReps: null,
        targetWeightKg: null,
        targetDurationSeconds: null,
        targetDistanceM: null,
        exercise: { id: 'ex', name: 'Bench', trackingType, isCatalog: false, archivedAt: null },
        ...rest,
    };
}

describe('describeTargets', () => {
    it('summarises weight and reps', () => {
        expect(
            describeTargets(slot({ trackingType: TrackingType.WeightReps, targetReps: 8, targetWeightKg: 62.5 })),
        ).toBe('3 × 8 · 62.5 kg');
    });

    it('omits targets that are not set', () => {
        expect(describeTargets(slot({ trackingType: TrackingType.WeightReps }))).toBe('3 sets');
        expect(describeTargets(slot({ trackingType: TrackingType.WeightReps, targetReps: 10 }))).toBe('3 × 10');
    });

    it('formats duration as minutes and seconds', () => {
        expect(describeTargets(slot({ trackingType: TrackingType.Duration, targetDurationSeconds: 90 }))).toBe(
            '3 × 1:30',
        );
    });

    it('formats distance in metres or kilometres', () => {
        expect(
            describeTargets(slot({ trackingType: TrackingType.DistanceTime, targetDistanceM: 400, targetSets: 1 })),
        ).toBe('1 × 400 m');
        expect(
            describeTargets(
                slot({
                    trackingType: TrackingType.DistanceTime,
                    targetDistanceM: 5000,
                    targetDurationSeconds: 1500,
                    targetSets: 1,
                }),
            ),
        ).toBe('1 × 5 km · 25:00');
    });

    it('appends the rest time when set', () => {
        expect(describeTargets(slot({ trackingType: TrackingType.WeightReps, targetReps: 5, restSeconds: 120 }))).toBe(
            '3 × 5 · rest 2:00',
        );
    });
});

describe('formatEstimatedDuration', () => {
    it('shows nothing when there is nothing to estimate', () => {
        expect(formatEstimatedDuration(0)).toBeNull();
        expect(formatEstimatedDuration(-30)).toBeNull();
        expect(formatEstimatedDuration(Number.NaN)).toBeNull();
    });

    it('rounds to whole minutes under an hour', () => {
        expect(formatEstimatedDuration(2700)).toBe('~45 min');
        expect(formatEstimatedDuration(2710)).toBe('~45 min');
    });

    it('never rounds a non-empty routine down to nothing', () => {
        expect(formatEstimatedDuration(20)).toBe('~1 min');
    });

    it('splits hours out once it passes one', () => {
        expect(formatEstimatedDuration(3900)).toBe('~1h 05m');
        expect(formatEstimatedDuration(7200)).toBe('~2h 00m');
        expect(formatEstimatedDuration(3600 + 35 * 60)).toBe('~1h 35m');
    });
});
