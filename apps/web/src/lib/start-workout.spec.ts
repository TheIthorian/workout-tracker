import { describe, expect, it } from 'vitest';
import {
    getStartWorkoutBlockedReason,
    START_WORKOUT_BLOCKED_MESSAGES,
    StartWorkoutBlockedReason,
} from './start-workout';

describe('getStartWorkoutBlockedReason', () => {
    it('allows a start when nothing is in the way', () => {
        expect(getStartWorkoutBlockedReason({ hasActiveSession: false })).toBeNull();
        expect(getStartWorkoutBlockedReason({ hasActiveSession: false, isRoutineArchived: false })).toBeNull();
    });

    it('blocks a start while a workout is in progress', () => {
        expect(getStartWorkoutBlockedReason({ hasActiveSession: true })).toBe(StartWorkoutBlockedReason.ActiveSession);
    });

    it('blocks a start from an archived routine', () => {
        expect(getStartWorkoutBlockedReason({ hasActiveSession: false, isRoutineArchived: true })).toBe(
            StartWorkoutBlockedReason.RoutineArchived,
        );
    });

    it('names archiving first, because it outlasts the workout in progress', () => {
        expect(getStartWorkoutBlockedReason({ hasActiveSession: true, isRoutineArchived: true })).toBe(
            StartWorkoutBlockedReason.RoutineArchived,
        );
    });

    it('has a message for every reason', () => {
        for (const reason of Object.values(StartWorkoutBlockedReason)) {
            expect(START_WORKOUT_BLOCKED_MESSAGES[reason]).toBeTruthy();
        }
    });
});
