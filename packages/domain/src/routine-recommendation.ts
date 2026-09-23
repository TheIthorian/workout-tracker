import { MUSCLE_ENGAGEMENT_WEIGHT, MuscleEngagement, type MuscleGroup } from './muscle-group.js';

/** The orders a routine list can be read in. */
export enum RoutineOrder {
    Name = 'name',
    /** Highest recommendation score first; routines with no score last, by name. */
    Recommended = 'recommended',
}

/** Days after training a muscle before it counts as fully rested and ready to be worked again. */
export const MUSCLE_RECOVERY_DAYS = 7;

/** How far back a routine's completions count towards how often it is done. */
export const ROUTINE_FREQUENCY_WINDOW_DAYS = 90;

/**
 * How much of the 0-100 score each factor can earn. Rest dominates, so a favourite routine cannot
 * crowd out the muscles it leaves untrained and following the top pick keeps the week rounded.
 */
export const RECOMMENDATION_WEIGHTS = { muscleRest: 70, frequency: 30 } as const;

/**
 * The rest score given to a routine whose exercises tag no muscles at all: nothing is known about
 * what it trains, so it is neither pushed forward nor buried.
 */
export const UNTAGGED_MUSCLE_REST = 0.5;

/** What one routine trains, and how often it has been done lately. */
export type RecommendationCandidate = {
    id: string;
    exerciseCount: number;
    excludedFromRecommendations: boolean;
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
    /** Completed workouts from this routine within `ROUTINE_FREQUENCY_WINDOW_DAYS`. */
    recentCompletions: number;
};

/** An exercise that had working sets logged in a completed workout, and when that workout ended. */
export type TrainedExercise = {
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
    completedAt: Date;
};

/** One routine's score: 0-100, or null when it should not be recommended at all. */
export type RoutineRecommendation = {
    routineId: string;
    score: number | null;
};

type MuscleLastTrained = { primaryAt: Date | null; secondaryAt: Date | null };

/**
 * Scores each candidate 0-100 for how good a pick it is right now: mostly how rested its muscles
 * are, and partly how often it gets done, since a routine done often is likely one the user enjoys.
 *
 * `history` is read once, so it may be a generator. `candidates` are read in full before the first
 * score is yielded, because frequency is relative to the most-done candidate.
 *
 * @returns one recommendation per candidate, in candidate order; the score is null for a routine
 * that is excluded or has no exercises, because starting one of those is never the right pick.
 */
export function* scoreRoutineRecommendations({
    candidates,
    history,
    now,
}: {
    candidates: Iterable<RecommendationCandidate>;
    history: Iterable<TrainedExercise>;
    now: Date;
}): Generator<RoutineRecommendation> {
    const allCandidates = [...candidates];
    const restByMuscle = new Map(
        [...lastTrainedByMuscle(history)].map(([muscle, entry]) => [muscle, muscleRest({ entry, now })]),
    );
    const mostCompletions = Math.max(0, ...allCandidates.map((candidate) => candidate.recentCompletions));

    for (const candidate of allCandidates) {
        if (candidate.excludedFromRecommendations || candidate.exerciseCount === 0) {
            yield { routineId: candidate.id, score: null };
            continue;
        }

        const rest = routineMuscleRest({ candidate, restByMuscle });
        const frequency = mostCompletions === 0 ? 0 : candidate.recentCompletions / mostCompletions;
        const score = rest * RECOMMENDATION_WEIGHTS.muscleRest + frequency * RECOMMENDATION_WEIGHTS.frequency;

        yield { routineId: candidate.id, score: Math.round(score) };
    }
}

/**
 * The latest time each muscle was worked at each engagement. A muscle an exercise tags as both
 * counts as primary, matching how volume is credited.
 */
function lastTrainedByMuscle(history: Iterable<TrainedExercise>): Map<MuscleGroup, MuscleLastTrained> {
    const byMuscle = new Map<MuscleGroup, MuscleLastTrained>();

    for (const exercise of history) {
        const primary = new Set(exercise.primaryMuscles);

        for (const muscle of primary) {
            const entry = byMuscle.get(muscle) ?? { primaryAt: null, secondaryAt: null };
            byMuscle.set(muscle, {
                ...entry,
                primaryAt: latest({ current: entry.primaryAt, candidate: exercise.completedAt }),
            });
        }

        for (const muscle of exercise.secondaryMuscles.filter((muscle) => !primary.has(muscle))) {
            const entry = byMuscle.get(muscle) ?? { primaryAt: null, secondaryAt: null };
            byMuscle.set(muscle, {
                ...entry,
                secondaryAt: latest({ current: entry.secondaryAt, candidate: exercise.completedAt }),
            });
        }
    }

    return byMuscle;
}

function latest({ current, candidate }: { current: Date | null; candidate: Date }): Date {
    return current === null || candidate > current ? candidate : current;
}

/**
 * How rested one muscle is, 0 (worked just now) to 1 (fully recovered). Work as a secondary muscle
 * tires it only by its engagement weight, so assisting on a bench press leaves triceps half-ready.
 */
function muscleRest({ entry, now }: { entry: MuscleLastTrained; now: Date }): number {
    return Math.min(
        restAfter({ at: entry.primaryAt, engagement: MuscleEngagement.Primary, now }),
        restAfter({ at: entry.secondaryAt, engagement: MuscleEngagement.Secondary, now }),
    );
}

function restAfter({ at, engagement, now }: { at: Date | null; engagement: MuscleEngagement; now: Date }): number {
    if (at === null) return 1;

    const days = Math.max(0, (now.getTime() - at.getTime()) / MS_PER_DAY);
    const recovered = Math.min(1, days / MUSCLE_RECOVERY_DAYS);

    return 1 - MUSCLE_ENGAGEMENT_WEIGHT[engagement] * (1 - recovered);
}

/**
 * The rest of a routine's muscles, averaged with secondary muscles counting for less than primary
 * ones. A muscle the routine names as both counts once, as primary.
 */
function routineMuscleRest({
    candidate,
    restByMuscle,
}: {
    candidate: RecommendationCandidate;
    restByMuscle: Map<MuscleGroup, number>;
}): number {
    const primary = new Set(candidate.primaryMuscles);
    const secondary = new Set(candidate.secondaryMuscles.filter((muscle) => !primary.has(muscle)));

    let weighted = 0;
    let totalWeight = 0;
    for (const [muscles, engagement] of [
        [primary, MuscleEngagement.Primary],
        [secondary, MuscleEngagement.Secondary],
    ] as const) {
        for (const muscle of muscles) {
            const weight = MUSCLE_ENGAGEMENT_WEIGHT[engagement];

            weighted += weight * (restByMuscle.get(muscle) ?? 1);
            totalWeight += weight;
        }
    }

    return totalWeight === 0 ? UNTAGGED_MUSCLE_REST : weighted / totalWeight;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
