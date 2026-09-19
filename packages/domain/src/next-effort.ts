import { Decimal } from './decimal.js';
import { TrackingType } from './tracking-type.js';

/** Where a suggested effort came from, so a caller can say why it is proposing these numbers. */
export enum NextEffortSource {
    /** Nothing has been logged yet, so there is nothing to suggest — only advice to find a baseline. */
    Baseline = 'baseline',
    /** A target the user or their coach set for the next session. */
    Target = 'target',
    /** Derived from the last working set, nudged up when that set came in easy. */
    LastPerformance = 'last_performance',
}

/** A target set ahead of the next session, by the user or an agent on their behalf. */
export type NextEffortTarget = {
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
    note: string | null;
    /** When the target was last written, used to tell an unused target from a spent one. */
    setAt: string;
};

/** The most recent non-warm-up set of an exercise, from a completed session. */
export type LastPerformance = {
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
    rpe: number | null;
    performedAt: string;
};

export type NextEffortSuggestion = {
    source: NextEffortSource;
    /** True when the exercise has no completed working set, which is what the baseline advice is for. */
    isFirstAttempt: boolean;
    /** One short line explaining the numbers, shown in the app and returned to an agent. */
    message: string;
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
};

/** What the app says the first time someone trains an exercise, before there is anything to go on. */
export const FIRST_ATTEMPT_MESSAGE =
    'Since this is your first go at this exercise, keep it light so we can work out your baseline.';

/** An RPE at or below this means the set had room left in it, so the next one goes up. */
export const EASY_RPE_CEILING = 7;

/** An RPE at or above this means the set was at the limit, so the next one repeats rather than climbs. */
export const HARD_RPE_FLOOR = 9.5;

/** The smallest plate change worth suggesting, and the rounding every weight suggestion lands on. */
export const WEIGHT_INCREMENT_KG = 2.5;

/** The smallest duration change worth suggesting, and the rounding every duration suggestion lands on. */
export const DURATION_INCREMENT_SECONDS = 5;

/** The smallest distance change worth suggesting, and the rounding every distance suggestion lands on. */
export const DISTANCE_INCREMENT_M = 100;

/** How much a suggestion climbs after an easy set, before rounding up to the increment. */
export const PROGRESSION_FRACTION = 0.05;

/**
 * Suggests the weight, reps, time or distance to open the next session with.
 *
 * A target wins while it is unused; once the exercise has been trained since the target was set, it
 * is treated as spent and the last working set drives the suggestion instead. Without either, the
 * answer is the baseline advice rather than a guess.
 */
export function suggestNextEffort({
    trackingType,
    target,
    lastPerformance,
}: {
    trackingType: TrackingType;
    target: NextEffortTarget | null;
    lastPerformance: LastPerformance | null;
}): NextEffortSuggestion {
    const isFirstAttempt = lastPerformance === null;

    if (target !== null && isTargetUnused({ target, lastPerformance })) {
        return {
            source: NextEffortSource.Target,
            isFirstAttempt,
            message: target.note ?? 'This is the target set for your next go at this exercise.',
            ...measurementsFor({ trackingType, effort: target }),
        };
    }

    if (lastPerformance === null) {
        return {
            source: NextEffortSource.Baseline,
            isFirstAttempt: true,
            message: FIRST_ATTEMPT_MESSAGE,
            weightKg: null,
            reps: null,
            durationSeconds: null,
            distanceM: null,
        };
    }

    return progressFrom({ trackingType, lastPerformance });
}

/** A target applies until the exercise is trained again; after that it describes a session already done. */
function isTargetUnused({
    target,
    lastPerformance,
}: {
    target: NextEffortTarget;
    lastPerformance: LastPerformance | null;
}): boolean {
    if (lastPerformance === null) return true;

    return Date.parse(target.setAt) > Date.parse(lastPerformance.performedAt);
}

/** Repeats the last working set, raising it by one increment when the RPE says it had room left. */
function progressFrom({
    trackingType,
    lastPerformance,
}: {
    trackingType: TrackingType;
    lastPerformance: LastPerformance;
}): NextEffortSuggestion {
    const { rpe } = lastPerformance;
    const measurements = measurementsFor({ trackingType, effort: lastPerformance });
    const repeat = (message: string): NextEffortSuggestion => ({
        source: NextEffortSource.LastPerformance,
        isFirstAttempt: false,
        message,
        ...measurements,
    });

    if (rpe === null) return repeat('Matches what you did last time.');
    if (rpe >= HARD_RPE_FLOOR) return repeat(`Last time came in at RPE ${rpe}, so this repeats it to lock it in.`);
    if (rpe > EASY_RPE_CEILING) return repeat(`Last time came in at RPE ${rpe}, so this holds you at the same effort.`);

    return {
        source: NextEffortSource.LastPerformance,
        isFirstAttempt: false,
        message: `Last time came in at RPE ${rpe}, so this steps you up a little.`,
        ...raise({ trackingType, measurements }),
    };
}

/** Adds one step to whichever measurement carries the load for this tracking type. */
function raise({
    trackingType,
    measurements,
}: {
    trackingType: TrackingType;
    measurements: Measurements;
}): Measurements {
    switch (trackingType) {
        case TrackingType.WeightReps:
            // A bodyweight movement has no load to add, so the extra work has to come from a rep.
            return measurements.weightKg === null || measurements.weightKg === 0
                ? { ...measurements, reps: measurements.reps === null ? null : measurements.reps + 1 }
                : {
                      ...measurements,
                      weightKg: stepUp({ value: measurements.weightKg, increment: WEIGHT_INCREMENT_KG }),
                  };
        case TrackingType.Duration:
            return {
                ...measurements,
                durationSeconds:
                    measurements.durationSeconds === null
                        ? null
                        : stepUp({
                              value: measurements.durationSeconds,
                              increment: DURATION_INCREMENT_SECONDS,
                          }),
            };
        case TrackingType.DistanceTime:
            return {
                ...measurements,
                distanceM:
                    measurements.distanceM === null
                        ? null
                        : stepUp({ value: measurements.distanceM, increment: DISTANCE_INCREMENT_M }),
            };
    }
}

/**
 * Raises a value by `PROGRESSION_FRACTION`, rounded up to the increment and never by less than one
 * increment — so a light lift still moves and a heavy one moves by more than a token amount.
 */
function stepUp({ value, increment }: { value: number; increment: number }): number {
    const raised = new Decimal(value).times(1 + PROGRESSION_FRACTION);
    const stepped = raised.dividedBy(increment).ceil().times(increment);
    const atLeastOneStep = new Decimal(value).plus(increment);

    return Decimal.max(stepped, atLeastOneStep).toNumber();
}

type Measurements = Pick<NextEffortSuggestion, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>;

/** Keeps only the measurements the tracking type allows, so a suggestion can never carry a stray field. */
function measurementsFor({ trackingType, effort }: { trackingType: TrackingType; effort: Measurements }): Measurements {
    const empty: Measurements = { weightKg: null, reps: null, durationSeconds: null, distanceM: null };

    switch (trackingType) {
        case TrackingType.WeightReps:
            return { ...empty, weightKg: effort.weightKg, reps: effort.reps };
        case TrackingType.Duration:
            return { ...empty, durationSeconds: effort.durationSeconds };
        case TrackingType.DistanceTime:
            return { ...empty, distanceM: effort.distanceM, durationSeconds: effort.durationSeconds };
    }
}
