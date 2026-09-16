/** Why a start control will not open a new workout right now. */
export enum StartWorkoutBlockedReason {
    ActiveSession = 'active_session',
    RoutineArchived = 'routine_archived',
}

/** The sentence shown wherever a start control is disabled, keyed by the blocker. */
export const START_WORKOUT_BLOCKED_MESSAGES: Record<StartWorkoutBlockedReason, string> = {
    [StartWorkoutBlockedReason.ActiveSession]:
        'You already have a workout in progress. Finish or abandon it to start another.',
    [StartWorkoutBlockedReason.RoutineArchived]: 'This routine is archived. Restore it to train with it again.',
};

/**
 * Mirrors the API's one-active-workout rule so a start control can explain itself instead of the
 * request coming back 409.
 *
 * @returns the blocker to explain, or `null` when a workout may be started.
 */
export function getStartWorkoutBlockedReason({
    hasActiveSession,
    isRoutineArchived = false,
}: {
    hasActiveSession: boolean;
    isRoutineArchived?: boolean;
}): StartWorkoutBlockedReason | null {
    // Archiving outlasts the workout in progress, so it is the more useful of the two to name.
    if (isRoutineArchived) return StartWorkoutBlockedReason.RoutineArchived;
    if (hasActiveSession) return StartWorkoutBlockedReason.ActiveSession;

    return null;
}
