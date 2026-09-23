import { describe, expect, it } from 'vitest';
import { MuscleGroup } from './muscle-group.js';
import {
    scoreRoutineRecommendations,
    type RecommendationCandidate,
    type TrainedExercise,
} from './routine-recommendation.js';

const NOW = new Date('2026-09-23T12:00:00.000Z');

function daysAgo(days: number): Date {
    return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function trained({
    primary,
    secondary = [],
    at,
}: {
    primary: MuscleGroup[];
    secondary?: MuscleGroup[];
    at: Date;
}): TrainedExercise {
    return { primaryMuscles: primary, secondaryMuscles: secondary, completedAt: at };
}

function candidate(overrides: Partial<RecommendationCandidate> & { id: string }): RecommendationCandidate {
    return {
        exerciseCount: 3,
        excludedFromRecommendations: false,
        primaryMuscles: [],
        secondaryMuscles: [],
        recentCompletions: 0,
        ...overrides,
    };
}

function scoresById(input: Parameters<typeof scoreRoutineRecommendations>[0]): Map<string, number | null> {
    return new Map([...scoreRoutineRecommendations(input)].map((entry) => [entry.routineId, entry.score]));
}

describe('scoreRoutineRecommendations', () => {
    it('gives the full rest share to a routine whose muscles have never been trained', () => {
        const scores = scoresById({
            candidates: [candidate({ id: 'legs', primaryMuscles: [MuscleGroup.Quads] })],
            history: [],
            now: NOW,
        });

        expect(scores.get('legs')).toBe(70);
    });

    it('recommends the routine whose muscles have rested longest', () => {
        const scores = scoresById({
            candidates: [
                candidate({ id: 'push', primaryMuscles: [MuscleGroup.Chest] }),
                candidate({ id: 'legs', primaryMuscles: [MuscleGroup.Quads] }),
            ],
            history: [
                trained({ primary: [MuscleGroup.Chest], at: daysAgo(1) }),
                trained({ primary: [MuscleGroup.Quads], at: daysAgo(4) }),
                trained({ primary: [MuscleGroup.Quads], at: daysAgo(9) }),
            ],
            now: NOW,
        });

        expect(scores.get('push')).toBe(10);
        expect(scores.get('legs')).toBe(40);
    });

    it('treats a muscle as fully rested once the recovery window has passed', () => {
        const scores = scoresById({
            candidates: [candidate({ id: 'push', primaryMuscles: [MuscleGroup.Chest] })],
            history: [trained({ primary: [MuscleGroup.Chest], at: daysAgo(30) })],
            now: NOW,
        });

        expect(scores.get('push')).toBe(70);
    });

    it('tires a muscle worked as secondary only by half', () => {
        const scores = scoresById({
            candidates: [candidate({ id: 'arms', primaryMuscles: [MuscleGroup.Triceps] })],
            history: [trained({ primary: [MuscleGroup.Chest], secondary: [MuscleGroup.Triceps], at: NOW })],
            now: NOW,
        });

        expect(scores.get('arms')).toBe(35);
    });

    it('takes the less rested of a muscle’s primary and secondary work', () => {
        const scores = scoresById({
            candidates: [candidate({ id: 'arms', primaryMuscles: [MuscleGroup.Triceps] })],
            history: [
                trained({ primary: [MuscleGroup.Triceps], at: daysAgo(3.5) }),
                trained({ primary: [MuscleGroup.Chest], secondary: [MuscleGroup.Triceps], at: NOW }),
            ],
            now: NOW,
        });

        // Primary 3.5 days ago leaves 0.5 rest; secondary just now leaves 0.5 too; the lower wins.
        expect(scores.get('arms')).toBe(35);
    });

    it('lets a routine’s secondary muscles weigh less than its primary ones', () => {
        const history = [trained({ primary: [MuscleGroup.Triceps], at: NOW })];

        const scores = scoresById({
            candidates: [
                candidate({
                    id: 'bench',
                    primaryMuscles: [MuscleGroup.Chest],
                    secondaryMuscles: [MuscleGroup.Triceps],
                }),
                candidate({ id: 'dips', primaryMuscles: [MuscleGroup.Triceps], secondaryMuscles: [MuscleGroup.Chest] }),
            ],
            history,
            now: NOW,
        });

        // Chest is rested, triceps are not: (1 * 1 + 0.5 * 0) / 1.5 vs (1 * 0 + 0.5 * 1) / 1.5.
        expect(scores.get('bench')).toBe(47);
        expect(scores.get('dips')).toBe(23);
    });

    it('rewards the routines done most often, relative to the most-done one', () => {
        const scores = scoresById({
            candidates: [
                candidate({ id: 'favourite', primaryMuscles: [MuscleGroup.Chest], recentCompletions: 10 }),
                candidate({ id: 'sometimes', primaryMuscles: [MuscleGroup.Lats], recentCompletions: 5 }),
                candidate({ id: 'never', primaryMuscles: [MuscleGroup.Quads], recentCompletions: 0 }),
            ],
            history: [],
            now: NOW,
        });

        expect(scores.get('favourite')).toBe(100);
        expect(scores.get('sometimes')).toBe(85);
        expect(scores.get('never')).toBe(70);
    });

    it('scores a routine with untagged exercises in the middle of the rest range', () => {
        const scores = scoresById({ candidates: [candidate({ id: 'misc' })], history: [], now: NOW });

        expect(scores.get('misc')).toBe(35);
    });

    it('does not score an excluded or empty routine', () => {
        const scores = scoresById({
            candidates: [
                candidate({ id: 'excluded', primaryMuscles: [MuscleGroup.Chest], excludedFromRecommendations: true }),
                candidate({ id: 'empty', exerciseCount: 0 }),
            ],
            history: [],
            now: NOW,
        });

        expect(scores.get('excluded')).toBeNull();
        expect(scores.get('empty')).toBeNull();
    });

    it('reads history from a generator, once', () => {
        let reads = 0;
        function* history(): Generator<TrainedExercise> {
            reads += 1;
            yield trained({ primary: [MuscleGroup.Chest], at: NOW });
        }

        const scores = scoresById({
            candidates: [candidate({ id: 'push', primaryMuscles: [MuscleGroup.Chest] })],
            history: history(),
            now: NOW,
        });

        expect(scores.get('push')).toBe(0);
        expect(reads).toBe(1);
    });

    it('yields one recommendation per candidate, in order', () => {
        const recommendations = scoreRoutineRecommendations({
            candidates: [candidate({ id: 'b' }), candidate({ id: 'a', exerciseCount: 0 })],
            history: [],
            now: NOW,
        });

        expect([...recommendations]).toEqual([
            { routineId: 'b', score: 35 },
            { routineId: 'a', score: null },
        ]);
    });
});
