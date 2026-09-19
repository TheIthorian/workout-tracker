// @vitest-environment jsdom
import { render, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { ExerciseProgress } from './ExerciseProgress';
import { TrackingType } from '@/models/exercise';
import type { ExerciseHistoryEntry } from '@/models/session';

function entry({
    id,
    completedAt,
    trackingType,
    sets,
}: {
    id: string;
    completedAt: string;
    trackingType: TrackingType;
    sets: Partial<ExerciseHistoryEntry['sets'][number]>[];
}): ExerciseHistoryEntry {
    return {
        sessionId: `session-${id}`,
        sessionName: 'Push day',
        startedAt: completedAt,
        completedAt,
        sessionExerciseId: id,
        trackingType,
        sets: sets.map((set, index) => ({
            id: `${id}-${index}`,
            setIndex: index,
            completedAt,
            isWarmup: false,
            rpe: null,
            weightKg: null,
            reps: null,
            durationSeconds: null,
            distanceM: null,
            ...set,
        })),
    };
}

// Recharts' responsive container needs an observer jsdom does not implement.
beforeAll(() => {
    globalThis.ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    };
});

describe('ExerciseProgress', () => {
    it('invites the first workout when nothing has been logged', () => {
        const { container } = render(<ExerciseProgress trackingType={TrackingType.WeightReps} history={[]} />);

        expect(within(container).getByText('No progress to chart yet')).toBeDefined();
    });

    it('charts both weight and reps for a weight-and-reps exercise', () => {
        const history = [
            entry({
                id: 'b',
                completedAt: '2026-02-02T10:00:00.000Z',
                trackingType: TrackingType.WeightReps,
                sets: [
                    { weightKg: 60, reps: 5 },
                    { weightKg: 65, reps: 5 },
                ],
            }),
            entry({
                id: 'a',
                completedAt: '2026-01-01T10:00:00.000Z',
                trackingType: TrackingType.WeightReps,
                sets: [{ weightKg: 50, reps: 8 }],
            }),
        ];

        const scope = within(
            render(<ExerciseProgress trackingType={TrackingType.WeightReps} history={history} />).container,
        );

        expect(scope.getByText('Heaviest set')).toBeDefined();
        expect(scope.getByText('Total reps')).toBeDefined();
        // The newest workout's numbers lead each chart, whatever order history arrived in.
        expect(scope.getByText('65 kg')).toBeDefined();
        expect(scope.getByText('10')).toBeDefined();
    });

    it('ignores warm-up sets', () => {
        const history = [
            entry({
                id: 'a',
                completedAt: '2026-01-01T10:00:00.000Z',
                trackingType: TrackingType.WeightReps,
                sets: [
                    { weightKg: 100, reps: 1, isWarmup: true },
                    { weightKg: 40, reps: 10 },
                ],
            }),
        ];

        const scope = within(
            render(<ExerciseProgress trackingType={TrackingType.WeightReps} history={history} />).container,
        );

        expect(scope.getByText('40 kg')).toBeDefined();
        expect(scope.queryByText('100 kg')).toBeNull();
    });

    it('charts distance and time for a distance-and-time exercise', () => {
        const history = [
            entry({
                id: 'a',
                completedAt: '2026-01-01T10:00:00.000Z',
                trackingType: TrackingType.DistanceTime,
                sets: [{ distanceM: 1000, durationSeconds: 300 }],
            }),
        ];

        const scope = within(
            render(<ExerciseProgress trackingType={TrackingType.DistanceTime} history={history} />).container,
        );

        expect(scope.getByText('1000 m')).toBeDefined();
        expect(scope.getByText('5:00')).toBeDefined();
    });

    it('drops a measurement no workout recorded', () => {
        const history = [
            entry({
                id: 'a',
                completedAt: '2026-01-01T10:00:00.000Z',
                trackingType: TrackingType.WeightReps,
                sets: [{ reps: 12 }],
            }),
        ];

        const scope = within(
            render(<ExerciseProgress trackingType={TrackingType.WeightReps} history={history} />).container,
        );

        expect(scope.getByText('Total reps')).toBeDefined();
        expect(scope.queryByText('Heaviest set')).toBeNull();
    });
});
