import { describe, expect, it } from 'vitest';
import { MUSCLE_ORDER, MUSCLE_REGIONS, MuscleGroup, orderMuscles, summarizeMuscles } from './muscle';

describe('orderMuscles', () => {
    it('reads head to toe whatever order the server sent', () => {
        expect(orderMuscles([MuscleGroup.Calves, MuscleGroup.Chest, MuscleGroup.Biceps])).toEqual([
            MuscleGroup.Chest,
            MuscleGroup.Biceps,
            MuscleGroup.Calves,
        ]);
    });
});

describe('summarizeMuscles', () => {
    it('is empty when nothing is tagged', () => {
        expect(summarizeMuscles({ muscles: [] })).toBe('');
    });

    it('counts the muscles it had no room for', () => {
        expect(summarizeMuscles({ muscles: [MuscleGroup.Triceps, MuscleGroup.Chest, MuscleGroup.FrontDelts] })).toBe(
            'Chest, front delts +1',
        );
    });
});

describe('the muscle vocabulary', () => {
    it('gives every muscle exactly one place in the order and one region section', () => {
        const all = Object.values(MuscleGroup);

        expect(new Set(MUSCLE_ORDER)).toEqual(new Set(all));
        expect(MUSCLE_ORDER).toHaveLength(all.length);
        expect(MUSCLE_REGIONS.flatMap(({ muscles }) => muscles)).toHaveLength(all.length);
    });
});
