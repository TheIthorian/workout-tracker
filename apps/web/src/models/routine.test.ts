import { DEFAULT_REST_SECONDS } from '@app/domain';
import { describe, expect, it } from 'vitest';
import { TrackingType } from './exercise';
import {
    describeTargets,
    estimateRoutineSeconds,
    formatEstimatedDuration,
    SECONDS_PER_REP,
    type RoutineExercise,
} from './routine';

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

describe('estimateRoutineSeconds', () => {
    it('is zero for a routine with no exercises', () => {
        expect(estimateRoutineSeconds([])).toBe(0);
    });

    it('counts reps as work and adds rest between sets', () => {
        const slots = [slot({ trackingType: TrackingType.WeightReps, targetReps: 8, restSeconds: 120 })];
        expect(estimateRoutineSeconds(slots)).toBe(3 * 8 * SECONDS_PER_REP + 2 * 120);
    });

    it('falls back to the default rest when the slot prescribes none', () => {
        const slots = [slot({ trackingType: TrackingType.WeightReps, targetReps: 8 })];
        expect(estimateRoutineSeconds(slots)).toBe(3 * 8 * SECONDS_PER_REP + 2 * DEFAULT_REST_SECONDS);
    });

    it('counts a duration slot as sets of its target duration', () => {
        const slots = [slot({ trackingType: TrackingType.Duration, targetDurationSeconds: 60, restSeconds: 30 })];
        expect(estimateRoutineSeconds(slots)).toBe(3 * 60 + 2 * 30);
    });

    it('counts a distance slot only once it has a target duration', () => {
        const timed = slot({ trackingType: TrackingType.DistanceTime, targetDistanceM: 5000, targetSets: 1 });
        expect(estimateRoutineSeconds([{ ...timed, targetDurationSeconds: 1500 }])).toBe(1500);
        expect(estimateRoutineSeconds([timed])).toBe(0);
    });

    it('adds no rest to a single-set slot', () => {
        const slots = [slot({ trackingType: TrackingType.WeightReps, targetReps: 10, targetSets: 1 })];
        expect(estimateRoutineSeconds(slots)).toBe(10 * SECONDS_PER_REP);
    });

    it('contributes nothing, not NaN, for a slot with no usable target', () => {
        expect(estimateRoutineSeconds([slot({ trackingType: TrackingType.WeightReps })])).toBe(0);
        expect(estimateRoutineSeconds([slot({ trackingType: TrackingType.Duration })])).toBe(0);
    });

    it('sums every slot', () => {
        const slots = [
            slot({ trackingType: TrackingType.WeightReps, targetReps: 8, restSeconds: 60 }),
            slot({ trackingType: TrackingType.Duration, targetDurationSeconds: 45, targetSets: 2, restSeconds: 15 }),
            slot({ trackingType: TrackingType.WeightReps }),
        ];
        expect(estimateRoutineSeconds(slots)).toBe(3 * 8 * SECONDS_PER_REP + 2 * 60 + (2 * 45 + 15));
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
