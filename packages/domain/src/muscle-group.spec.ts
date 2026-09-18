import { describe, expect, it } from 'vitest';
import { MuscleGroup, summariseMuscleVolume } from './muscle-group.js';

describe('summariseMuscleVolume', () => {
    it('returns nothing when no exercise was performed', () => {
        expect(summariseMuscleVolume({ contributions: [] })).toEqual([]);
    });

    it('counts a secondary muscle at half a set and a primary at a full one', () => {
        const totals = summariseMuscleVolume({
            contributions: [{ primaryMuscles: [MuscleGroup.Chest], secondaryMuscles: [MuscleGroup.Triceps], sets: 4 }],
        });

        expect(totals).toEqual([
            { muscle: MuscleGroup.Chest, sets: 4, weightedSets: 4, intensity: 1 },
            { muscle: MuscleGroup.Triceps, sets: 4, weightedSets: 2, intensity: 0.5 },
        ]);
    });

    it('adds up appearances across exercises and scales intensity to the hardest-worked muscle', () => {
        const totals = summariseMuscleVolume({
            contributions: [
                { primaryMuscles: [MuscleGroup.Quads], secondaryMuscles: [MuscleGroup.Glutes], sets: 5 },
                { primaryMuscles: [MuscleGroup.Quads], secondaryMuscles: [], sets: 3 },
                { primaryMuscles: [MuscleGroup.Glutes], secondaryMuscles: [], sets: 2 },
            ],
        });

        expect(totals).toEqual([
            { muscle: MuscleGroup.Quads, sets: 8, weightedSets: 8, intensity: 1 },
            { muscle: MuscleGroup.Glutes, sets: 7, weightedSets: 4.5, intensity: 0.5625 },
        ]);
    });

    it('counts a muscle tagged both ways once, as primary', () => {
        const totals = summariseMuscleVolume({
            contributions: [{ primaryMuscles: [MuscleGroup.Lats], secondaryMuscles: [MuscleGroup.Lats], sets: 3 }],
        });

        expect(totals).toEqual([{ muscle: MuscleGroup.Lats, sets: 3, weightedSets: 3, intensity: 1 }]);
    });

    it('ignores an appearance with no sets recorded', () => {
        const totals = summariseMuscleVolume({
            contributions: [
                { primaryMuscles: [MuscleGroup.Abs], secondaryMuscles: [], sets: 0 },
                { primaryMuscles: [MuscleGroup.Calves], secondaryMuscles: [], sets: 2 },
            ],
        });

        expect(totals.map((total) => total.muscle)).toEqual([MuscleGroup.Calves, MuscleGroup.Abs]);
        expect(totals[1]).toEqual({ muscle: MuscleGroup.Abs, sets: 0, weightedSets: 0, intensity: 0 });
    });
});
