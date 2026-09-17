import { DEFAULT_REST_SECONDS } from '@app/domain';
import { TrackingType } from './exercise';

/** Seconds one rep is assumed to take, covering the rep itself and the breath either side of it. */
export const SECONDS_PER_REP = 4;

/** A workout template, as listed. */
export type Routine = {
    id: string;
    name: string;
    description: string | null;
    archivedAt: string | null;
    exerciseCount: number;
    createdAt: string;
    updatedAt: string;
};

/** The exercise a slot points at — enough to render the row and pick an input widget. */
export type RoutineExerciseSummary = {
    id: string;
    name: string;
    trackingType: TrackingType;
    isCatalog: boolean;
    /** Set when the exercise was archived after being added; the slot stays, flagged. */
    archivedAt: string | null;
};

/** The editable part of a slot. Canonical units: kg, m, s. */
export type RoutineExerciseTargets = {
    targetSets: number;
    restSeconds: number | null;
    notes: string | null;
    targetReps: number | null;
    targetWeightKg: number | null;
    targetDurationSeconds: number | null;
    targetDistanceM: number | null;
};

/** One slot in a routine, in position order. */
export type RoutineExercise = RoutineExerciseTargets & {
    id: string;
    position: number;
    exercise: RoutineExerciseSummary;
};

export type RoutineDetail = Routine & { exercises: RoutineExercise[] };

export type SaveRoutineRequest = { name: string; description?: string | null };

export type PatchRoutineRequest = { name?: string; description?: string | null; archived?: boolean };

export type SaveRoutineExerciseRequest = Partial<RoutineExerciseTargets> & { exerciseId: string };

export type PatchRoutineExerciseRequest = Partial<RoutineExerciseTargets>;

/**
 * One line summarising a slot's targets — "3 × 8 · 62.5 kg · rest 1:30" — for the list row.
 * Only the targets that fit the exercise's tracking type are shown; the server rejects the rest.
 */
export function describeTargets(slot: RoutineExercise): string {
    const parts: string[] = [];

    const primary = primaryTarget(slot);
    parts.push(primary === null ? `${slot.targetSets} sets` : `${slot.targetSets} × ${primary}`);

    if (slot.exercise.trackingType === TrackingType.WeightReps && slot.targetWeightKg !== null) {
        parts.push(`${formatNumber(slot.targetWeightKg)} kg`);
    }

    if (slot.exercise.trackingType === TrackingType.DistanceTime && slot.targetDurationSeconds !== null) {
        parts.push(formatClock(slot.targetDurationSeconds));
    }

    if (slot.restSeconds !== null && slot.restSeconds > 0) parts.push(`rest ${formatClock(slot.restSeconds)}`);

    return parts.join(' · ');
}

/**
 * Rough total time a routine takes, in seconds.
 *
 * Work per slot is `sets × duration` for a duration or distance-and-time slot, and
 * `sets × reps × SECONDS_PER_REP` for a weight-and-reps one. A slot that does any work then adds
 * `(sets - 1) × rest` between its sets, falling back to `DEFAULT_REST_SECONDS` when it prescribes
 * none. A slot whose relevant target is unset contributes nothing: the target is a suggestion the
 * user has not made yet, not an instruction to do no work. Warm-up and the walk between machines
 * are not modelled, so the estimate reads low for a long session.
 */
export function estimateRoutineSeconds(slots: RoutineExercise[]): number {
    return slots.reduce((total, slot) => total + slotSeconds(slot), 0);
}

/**
 * An estimated duration as `~45 min`, or `~1h 05m` once it passes an hour. Null when there is
 * nothing worth showing, so an empty routine renders no estimate rather than `~0 min`.
 */
export function formatEstimatedDuration(totalSeconds: number): string | null {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;

    const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
    if (totalMinutes < 60) return `~${totalMinutes} min`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `~${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

/** Seconds as `m:ss`. */
export function formatClock(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Metres as `400 m` or `5 km`, trimming trailing zeros. */
export function formatDistance(metres: number): string {
    return metres >= 1000 ? `${formatNumber(metres / 1000)} km` : `${formatNumber(metres)} m`;
}

function slotSeconds(slot: RoutineExercise): number {
    const workSeconds = slotWorkSeconds(slot);
    if (!Number.isFinite(workSeconds) || workSeconds <= 0) return 0;

    const restSeconds = slot.restSeconds ?? DEFAULT_REST_SECONDS;
    return workSeconds + Math.max(0, slot.targetSets - 1) * restSeconds;
}

function slotWorkSeconds(slot: RoutineExercise): number {
    switch (slot.exercise.trackingType) {
        case TrackingType.WeightReps:
            return slot.targetReps === null ? 0 : slot.targetSets * slot.targetReps * SECONDS_PER_REP;
        case TrackingType.Duration:
        case TrackingType.DistanceTime:
            return slot.targetDurationSeconds === null ? 0 : slot.targetSets * slot.targetDurationSeconds;
    }
}

function primaryTarget(slot: RoutineExercise): string | null {
    switch (slot.exercise.trackingType) {
        case TrackingType.WeightReps:
            return slot.targetReps === null ? null : String(slot.targetReps);
        case TrackingType.Duration:
            return slot.targetDurationSeconds === null ? null : formatClock(slot.targetDurationSeconds);
        case TrackingType.DistanceTime:
            return slot.targetDistanceM === null ? null : formatDistance(slot.targetDistanceM);
    }
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}
