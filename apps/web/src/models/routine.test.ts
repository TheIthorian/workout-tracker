import { describe, expect, it } from 'vitest';
import { Equipment } from './equipment';
import { TrackingType } from './exercise';
import { aggregateRoutineEquipment, describeTargets, type RoutineExercise } from './routine';

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
