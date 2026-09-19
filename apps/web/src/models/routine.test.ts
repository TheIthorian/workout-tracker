import { describe, expect, it } from 'vitest';
import { Equipment } from './equipment';
import { TrackingType } from './exercise';
import { aggregateRoutineEquipment, formatEstimatedDuration, formatLastDone, type RoutineExercise } from './routine';

function slot(
    overrides: Partial<RoutineExercise> & { trackingType: TrackingType; equipment?: Equipment[] },
): RoutineExercise {
    const { trackingType, equipment = [], ...rest } = overrides;
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
        exercise: { id: 'ex', name: 'Bench', trackingType, isCatalog: false, equipment, archivedAt: null },
        ...rest,
    };
}

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

describe('aggregateRoutineEquipment', () => {
    const weightReps = TrackingType.WeightReps;

    it('is empty for a routine with no slots', () => {
        expect(aggregateRoutineEquipment([])).toEqual([]);
    });

    it('is empty when every exercise is bodyweight', () => {
        expect(
            aggregateRoutineEquipment([slot({ trackingType: weightReps }), slot({ trackingType: weightReps })]),
        ).toEqual([]);
    });

    it('deduplicates equipment shared by several slots', () => {
        const slots = [
            slot({ trackingType: weightReps, equipment: [Equipment.Barbell, Equipment.Bench] }),
            slot({ trackingType: weightReps, equipment: [Equipment.Barbell] }),
        ];

        expect(aggregateRoutineEquipment(slots)).toEqual([Equipment.Barbell, Equipment.Bench]);
    });

    it('orders the result by the library display order, not by slot order', () => {
        const slots = [
            slot({ trackingType: weightReps, equipment: [Equipment.Treadmill] }),
            slot({ trackingType: weightReps, equipment: [Equipment.Dumbbell, Equipment.Barbell] }),
        ];

        expect(aggregateRoutineEquipment(slots)).toEqual([Equipment.Barbell, Equipment.Dumbbell, Equipment.Treadmill]);
    });
});

describe('formatLastDone', () => {
    const now = new Date('2026-09-19T08:00:00');

    it('shows nothing for a routine that has never been completed', () => {
        expect(formatLastDone(null, now)).toBeNull();
    });

    it('reads today for a completion earlier the same day', () => {
        expect(formatLastDone('2026-09-19T06:30:00', now)).toBe('Last done today');
    });

    it('reads yesterday for the previous calendar day, however few hours ago', () => {
        expect(formatLastDone('2026-09-18T22:00:00', now)).toBe('Last done yesterday');
    });

    it('counts calendar days for anything older', () => {
        expect(formatLastDone('2026-09-07T19:00:00', now)).toBe('Last done 12 days ago');
    });

    it('shows nothing for an unparseable timestamp', () => {
        expect(formatLastDone('not a date', now)).toBeNull();
    });
});
