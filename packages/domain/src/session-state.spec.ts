import { describe, expect, it } from 'vitest';
import {
    computeSessionState,
    lastLoggedSet,
    sessionExerciseStatus,
    SessionExerciseStatus,
    type SessionExerciseLike,
} from './session-state.js';

const completedAt = '2026-09-13T10:00:00.000Z';

function exercise(overrides: Partial<SessionExerciseLike> & { id: string; position: number }): SessionExerciseLike {
    return { targetSets: 3, restSeconds: 90, skippedAt: null, sets: [], ...overrides };
}

describe('session state', () => {
    it('uses working sets for status and lets skip take precedence', () => {
        expect(sessionExerciseStatus(exercise({ id: 'one', position: 0 }))).toBe(SessionExerciseStatus.Pending);
        expect(
            sessionExerciseStatus(
                exercise({
                    id: 'two',
                    position: 1,
                    targetSets: 1,
                    sets: [
                        { isWarmup: true, completedAt },
                        { isWarmup: false, completedAt },
                    ],
                }),
            ),
        ).toBe(SessionExerciseStatus.Done);
        expect(sessionExerciseStatus(exercise({ id: 'three', position: 2, skippedAt: completedAt }))).toBe(
            SessionExerciseStatus.Skipped,
        );
    });

    it('selects the first unfinished exercise and counts working-set progress', () => {
        const state = computeSessionState({
            completedAt: null,
            exercises: [
                exercise({
                    id: 'done',
                    position: 1,
                    targetSets: 1,
                    sets: [{ isWarmup: false, completedAt }],
                }),
                exercise({ id: 'next', position: 2 }),
                exercise({ id: 'skipped', position: 0, skippedAt: completedAt }),
            ],
        });
        expect(state).toEqual({
            currentSessionExerciseId: 'next',
            nextSetIndex: 1,
            progress: { totalExercises: 3, completedExercises: 1, skippedExercises: 1, targetSets: 4, loggedSets: 1 },
            canComplete: true,
        });
    });

    it('finds the latest set by instant across exercises', () => {
        expect(
            lastLoggedSet({
                completedAt: null,
                exercises: [
                    exercise({
                        id: 'older',
                        position: 0,
                        restSeconds: 60,
                        sets: [{ isWarmup: false, completedAt: '2026-09-13T10:00:00.000Z' }],
                    }),
                    exercise({
                        id: 'latest',
                        position: 1,
                        restSeconds: 120,
                        sets: [{ isWarmup: false, completedAt: '2026-09-13 10:02:00+00' }],
                    }),
                ],
            }),
        ).toEqual({ sessionExerciseId: 'latest', completedAt: '2026-09-13 10:02:00+00', restSeconds: 120 });
    });
});
