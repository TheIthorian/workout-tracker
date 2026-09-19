import { EQUIPMENT_ORDER, type Equipment } from './equipment';
import type { TrackingType } from './exercise';

/** A workout template, as listed. */
export type Routine = {
    id: string;
    name: string;
    description: string | null;
    archivedAt: string | null;
    exerciseCount: number;
    /** Estimated seconds to work through the routine; 0 when nothing in it has a usable target. */
    estimatedDurationSeconds: number;
    createdAt: string;
    updatedAt: string;
};

/** The exercise a slot points at — enough to render the row and pick an input widget. */
export type RoutineExerciseSummary = {
    id: string;
    name: string;
    trackingType: TrackingType;
    isCatalog: boolean;
    /** What the movement needs; empty means bodyweight. */
    equipment: Equipment[];
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

/**
 * Everything a routine's slots need between them, deduplicated and in the library's display order
 * so the same routine always reads the same way. Empty when every exercise is bodyweight.
 */
export function aggregateRoutineEquipment(slots: RoutineExercise[]): Equipment[] {
    const needed = new Set(slots.flatMap((slot) => slot.exercise.equipment));

    return EQUIPMENT_ORDER.filter((item) => needed.has(item));
}
