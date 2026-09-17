// @vitest-environment jsdom
import { render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetLogForm } from './SetLogForm';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TrackingType } from '@/models/exercise';
import type { LogSetRequest, SessionExercise, SessionSet } from '@/models/session';

describe('SetLogForm', () => {
    it('carries the previous set’s RPE into the next set', () => {
        const form = renderForm({ previousSet: buildSet({ rpe: 8.5 }), onLog: vi.fn() });

        expect(form.rpeInput().value).toBe('8.5');
    });

    it('logs the remembered RPE when it is left untouched', () => {
        const onLog = vi.fn();
        const form = renderForm({ previousSet: buildSet({ rpe: 7 }), onLog });

        form.logButton().click();

        expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ rpe: 7 }));
    });

    it('leaves RPE unset when the previous set had none', () => {
        const form = renderForm({ previousSet: buildSet({ rpe: null }), onLog: vi.fn() });

        expect(form.rpeInput().value).toBe('');
    });
});

function renderForm({ previousSet, onLog }: { previousSet: SessionSet | null; onLog: (data: LogSetRequest) => void }): {
    rpeInput: () => HTMLInputElement;
    logButton: () => HTMLElement;
} {
    const { container } = render(
        <TooltipProvider>
            <SetLogForm exercise={buildExercise()} previousSet={previousSet} isPending={false} onLog={onLog} />
        </TooltipProvider>,
    );
    const scope = within(container);

    return {
        rpeInput: () => scope.getByRole<HTMLInputElement>('spinbutton', { name: 'RPE' }),
        logButton: () => scope.getByRole('button', { name: 'Log set' }),
    };
}

function buildSet(overrides: Partial<SessionSet>): SessionSet {
    return {
        id: 'set-1',
        setIndex: 1,
        completedAt: '2026-09-17T10:00:00.000Z',
        isWarmup: false,
        rpe: null,
        weightKg: 60,
        reps: 8,
        durationSeconds: null,
        distanceM: null,
        ...overrides,
    };
}

function buildExercise(): SessionExercise {
    return {
        id: 'session-exercise-1',
        position: 1,
        source: 'from_routine',
        trackingType: TrackingType.WeightReps,
        targetSets: 3,
        restSeconds: 90,
        notes: null,
        skippedAt: null,
        targetReps: 8,
        targetWeightKg: 60,
        targetDurationSeconds: null,
        targetDistanceM: null,
        exercise: { id: 'exercise-1', name: 'Back Squat', isCatalog: true, equipment: [], archivedAt: null },
        sets: [],
    };
}
