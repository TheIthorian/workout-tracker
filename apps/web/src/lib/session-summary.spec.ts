import { describe, expect, it } from 'vitest';
import { buildSessionSummary } from './session-summary';
import { formatDate } from './date-format';
import { TrackingType } from '@/models/exercise';
import type { SessionDetail, SessionExercise, SessionSet } from '@/models/session';

describe('buildSessionSummary', () => {
    it('renders the header, every set, and the workout notes', () => {
        const summary = buildSessionSummary(
            makeSession({
                completedAt: '2026-09-17T11:00:00.000Z',
                notes: 'Felt strong',
                exercises: [
                    makeExercise({
                        sets: [
                            makeSet({ setIndex: 0, isWarmup: true, reps: 8, weightKg: 40 }),
                            makeSet({ setIndex: 1, reps: 8, weightKg: 62.5, rpe: 8 }),
                        ],
                    }),
                ],
            }),
        );

        expect(summary).toBe(
            [
                `Push day — ${formatDate('2026-09-17T10:00:00.000Z')}`,
                'Status: completed',
                'Duration: 60 min',
                'Working sets: 1 of 3',
                '',
                '1. Bench press (1/3 working sets)',
                '   Warm-up: 8 reps @ 40 kg',
                '   Set 1: 8 reps @ 62.5 kg (RPE 8)',
                '',
                'Notes: Felt strong',
            ].join('\n'),
        );
    });

    it('omits the duration while the workout is still in progress', () => {
        const summary = buildSessionSummary(makeSession({}));

        expect(summary).toContain('Status: in progress');
        expect(summary).not.toContain('Duration:');
    });

    it('marks a skipped exercise and one with no sets', () => {
        const summary = buildSessionSummary(
            makeSession({ exercises: [makeExercise({ skippedAt: '2026-09-17T10:30:00.000Z', sets: [] })] }),
        );

        expect(summary).toContain('1. Bench press (0/3 working sets) - skipped');
        expect(summary).toContain('   No sets logged');
    });

    it('formats duration and distance tracking types', () => {
        const summary = buildSessionSummary(
            makeSession({
                exercises: [
                    makeExercise({
                        trackingType: TrackingType.Duration,
                        exercise: { ...baseExercise.exercise, name: 'Plank' },
                        sets: [makeSet({ setIndex: 1, durationSeconds: 90 })],
                    }),
                    makeExercise({
                        trackingType: TrackingType.DistanceTime,
                        exercise: { ...baseExercise.exercise, name: 'Row' },
                        sets: [makeSet({ setIndex: 1, distanceM: 500, durationSeconds: 105 })],
                    }),
                ],
            }),
        );

        expect(summary).toContain('   Set 1: 1:30');
        expect(summary).toContain('   Set 1: 500 m in 1:45');
    });

    it('says so when nothing was logged', () => {
        expect(buildSessionSummary(makeSession({ exercises: [] }))).toContain('No exercises logged.');
    });
});

const baseSet: SessionSet = {
    id: 'set-1',
    setIndex: 1,
    completedAt: '2026-09-17T10:05:00.000Z',
    isWarmup: false,
    rpe: null,
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceM: null,
};

const baseExercise: SessionExercise = {
    id: 'session-exercise-1',
    position: 1,
    source: 'from_routine',
    trackingType: TrackingType.WeightReps,
    targetSets: 3,
    restSeconds: 90,
    notes: null,
    skippedAt: null,
    targetReps: 8,
    targetWeightKg: null,
    targetDurationSeconds: null,
    targetDistanceM: null,
    exercise: { id: 'exercise-1', name: 'Bench press', isCatalog: true, equipment: [], archivedAt: null },
    sets: [],
};

const baseSession: SessionDetail = {
    id: 'session-1',
    name: 'Push day',
    routineId: 'routine-1',
    startedAt: '2026-09-17T10:00:00.000Z',
    completedAt: null,
    notes: null,
    exerciseCount: 1,
    setCount: 1,
    createdAt: '2026-09-17T10:00:00.000Z',
    updatedAt: '2026-09-17T10:00:00.000Z',
    exercises: [],
    state: {
        currentSessionExerciseId: null,
        nextSetIndex: null,
        progress: {
            totalExercises: 1,
            completedExercises: 0,
            skippedExercises: 0,
            targetSets: 3,
            loggedSets: 1,
        },
        canComplete: true,
    },
};

function makeSession(overrides: Partial<SessionDetail>): SessionDetail {
    return { ...baseSession, exercises: [makeExercise({})], ...overrides };
}

function makeExercise(overrides: Partial<SessionExercise>): SessionExercise {
    return { ...baseExercise, ...overrides };
}

function makeSet(overrides: Partial<SessionSet>): SessionSet {
    return { ...baseSet, ...overrides };
}
