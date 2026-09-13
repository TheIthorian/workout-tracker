import { TrackingType } from './exercise';

/** One recorded set in a workout session. Measurements use kg, metres, and seconds. */
export type SessionSet = {
    id: string;
    setIndex: number;
    completedAt: string;
    isWarmup: boolean;
    rpe: number | null;
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
};

/** An exercise snapshot inside a workout session. */
export type SessionExercise = {
    id: string;
    position: number;
    source: 'from_routine' | 'added_ad_hoc';
    trackingType: TrackingType;
    targetSets: number;
    restSeconds: number | null;
    notes: string | null;
    skippedAt: string | null;
    targetReps: number | null;
    targetWeightKg: number | null;
    targetDurationSeconds: number | null;
    targetDistanceM: number | null;
    exercise: { id: string; name: string; isCatalog: boolean; archivedAt: string | null };
    sets: SessionSet[];
};

/** The server-derived workout progress. */
export type SessionState = {
    currentSessionExerciseId: string | null;
    nextSetIndex: number | null;
    progress: {
        totalExercises: number;
        completedExercises: number;
        skippedExercises: number;
        targetSets: number;
        loggedSets: number;
    };
    canComplete: boolean;
};

/** The lightweight session shape used in the history list. */
export type SessionSummary = {
    id: string;
    name: string;
    routineId: string | null;
    startedAt: string;
    completedAt: string | null;
    notes: string | null;
    exerciseCount: number;
    setCount: number;
    createdAt: string;
    updatedAt: string;
};

/** A full workout aggregate. */
export type SessionDetail = SessionSummary & { exercises: SessionExercise[]; state: SessionState };

export type ActiveSessionResponse = { session: SessionDetail | null };
export type StartSessionRequest = { routineId?: string | null; name?: string | null };
export type LogSetRequest = {
    isWarmup?: boolean;
    rpe?: number | null;
    weightKg?: number | null;
    reps?: number | null;
    durationSeconds?: number | null;
    distanceM?: number | null;
};
export type AddSessionExerciseRequest = {
    exerciseId: string;
    targetSets?: number;
    restSeconds?: number | null;
    notes?: string | null;
    targetReps?: number | null;
    targetWeightKg?: number | null;
    targetDurationSeconds?: number | null;
    targetDistanceM?: number | null;
};
export type PatchSessionExerciseRequest = Partial<Omit<AddSessionExerciseRequest, 'exerciseId'>> & {
    skipped?: boolean;
};

/** Formats a number without insignificant trailing zeroes. */
export function formatSessionNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

/** Formats seconds for a workout target or timer. */
export function formatSessionClock(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
