/** Where a session exercise originated. */
export enum SessionExerciseSource {
    FromRoutine = 'from_routine',
    AddedAdHoc = 'added_ad_hoc',
}

/** The derived status of an exercise within a workout session. */
export enum SessionExerciseStatus {
    Pending = 'pending',
    InProgress = 'in_progress',
    Done = 'done',
    Skipped = 'skipped',
}

export type SessionSetLike = { isWarmup: boolean; completedAt: string };
export type SessionExerciseLike = {
    id: string;
    position: number;
    targetSets: number;
    restSeconds: number | null;
    skippedAt: string | null;
    sets: ReadonlyArray<SessionSetLike>;
};
export type SessionLike = { completedAt: string | null; exercises: ReadonlyArray<SessionExerciseLike> };
export type SessionProgress = {
    totalExercises: number;
    completedExercises: number;
    skippedExercises: number;
    targetSets: number;
    loggedSets: number;
};
export type SessionState = {
    currentSessionExerciseId: string | null;
    nextSetIndex: number | null;
    progress: SessionProgress;
    canComplete: boolean;
};
export type LastLoggedSet = { sessionExerciseId: string; completedAt: string; restSeconds: number | null };

/** Derives the current exercise, progress, and completion eligibility for a session. */
export function computeSessionState(session: SessionLike): SessionState {
    const ordered = [...session.exercises].sort((left, right) => left.position - right.position);
    const statuses = ordered.map((exercise) => ({ exercise, status: sessionExerciseStatus(exercise) }));
    const current = statuses.find(
        ({ status }) => status === SessionExerciseStatus.Pending || status === SessionExerciseStatus.InProgress,
    );
    const progress: SessionProgress = {
        totalExercises: ordered.length,
        completedExercises: statuses.filter(({ status }) => status === SessionExerciseStatus.Done).length,
        skippedExercises: statuses.filter(({ status }) => status === SessionExerciseStatus.Skipped).length,
        targetSets: statuses
            .filter(({ status }) => status !== SessionExerciseStatus.Skipped)
            .reduce((total, { exercise }) => total + exercise.targetSets, 0),
        loggedSets: ordered.reduce((total, exercise) => total + workingSetCount(exercise), 0),
    };

    return {
        currentSessionExerciseId: current?.exercise.id ?? null,
        nextSetIndex: current === undefined ? null : current.exercise.sets.length + 1,
        progress,
        canComplete: session.completedAt === null && progress.loggedSets > 0,
    };
}

/** Derives an exercise's status, giving an explicit skip precedence. */
export function sessionExerciseStatus(exercise: SessionExerciseLike): SessionExerciseStatus {
    if (exercise.skippedAt !== null) return SessionExerciseStatus.Skipped;
    if (workingSetCount(exercise) >= exercise.targetSets) return SessionExerciseStatus.Done;
    return exercise.sets.length === 0 ? SessionExerciseStatus.Pending : SessionExerciseStatus.InProgress;
}

/** Counts working rather than warm-up sets. */
export function workingSetCount(exercise: SessionExerciseLike): number {
    return exercise.sets.filter((set) => !set.isWarmup).length;
}

/** Returns the latest logged set across all session exercises. */
export function lastLoggedSet(session: SessionLike): LastLoggedSet | null {
    let latest: LastLoggedSet | null = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const exercise of session.exercises) {
        for (const set of exercise.sets) {
            const completedMs = Date.parse(set.completedAt);
            if (Number.isNaN(completedMs) || completedMs <= latestMs) continue;
            latestMs = completedMs;
            latest = {
                sessionExerciseId: exercise.id,
                completedAt: set.completedAt,
                restSeconds: exercise.restSeconds,
            };
        }
    }
    return latest;
}
