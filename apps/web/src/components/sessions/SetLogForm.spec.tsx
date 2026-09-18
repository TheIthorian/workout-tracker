// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetLogForm } from './SetLogForm';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NextEffortSource, TrackingType, type ExerciseSuggestion } from '@/models/exercise';
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

    it('starts RPE at 8 when stepping up from empty', () => {
        const form = renderForm({ previousSet: buildSet({ rpe: null }), onLog: vi.fn() });

        fireEvent.click(form.rpeIncrease(), { detail: 0 });

        expect(form.rpeInput().value).toBe('8');
    });

    it('starts RPE at 6 when stepping down from empty', () => {
        const form = renderForm({ previousSet: buildSet({ rpe: null }), onLog: vi.fn() });

        fireEvent.click(form.rpeDecrease(), { detail: 0 });

        expect(form.rpeInput().value).toBe('6');
    });

    it('steps by the usual increment once RPE has a value', () => {
        const form = renderForm({ previousSet: buildSet({ rpe: null }), onLog: vi.fn() });

        fireEvent.click(form.rpeIncrease(), { detail: 0 });
        fireEvent.click(form.rpeIncrease(), { detail: 0 });

        expect(form.rpeInput().value).toBe('8.5');
    });

    it('fills in the suggested weight and reps when the sparkle is tapped', () => {
        const onApplySuggestion = vi.fn();
        const form = renderForm({
            previousSet: buildSet({ weightKg: 60, reps: 8 }),
            onLog: vi.fn(),
            suggestion: buildSuggestion({ weightKg: 65, reps: 6 }),
            onApplySuggestion,
        });

        fireEvent.click(form.suggestButton());

        expect(form.weightInput().value).toBe('65');
        expect(form.repsInput().value).toBe('6');
        expect(onApplySuggestion).toHaveBeenCalledOnce();
    });

    it('logs the suggested numbers after they are applied', () => {
        const onLog = vi.fn();
        const form = renderForm({
            previousSet: buildSet({ weightKg: 60, reps: 8 }),
            onLog,
            suggestion: buildSuggestion({ weightKg: 65, reps: 6 }),
        });

        fireEvent.click(form.suggestButton());
        fireEvent.click(form.logButton());

        expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ weightKg: 65, reps: 6 }));
    });

    it('offers no suggestion on a first attempt, which has numbers to find rather than repeat', () => {
        const form = renderForm({
            previousSet: null,
            onLog: vi.fn(),
            suggestion: buildSuggestion({
                weightKg: null,
                reps: null,
                source: NextEffortSource.Baseline,
                isFirstAttempt: true,
            }),
        });

        expect(form.querySuggestButton()).toBeNull();
    });

    it('disables the sparkle until the suggestion has loaded', () => {
        const form = renderForm({ previousSet: buildSet({}), onLog: vi.fn(), suggestion: null });

        expect(form.suggestButton().hasAttribute('disabled')).toBe(true);
    });
});

function renderForm({
    previousSet,
    onLog,
    suggestion = null,
    onApplySuggestion = vi.fn(),
}: {
    previousSet: SessionSet | null;
    onLog: (data: LogSetRequest) => void;
    suggestion?: ExerciseSuggestion | null;
    onApplySuggestion?: (suggestion: ExerciseSuggestion) => void;
}): {
    rpeInput: () => HTMLInputElement;
    rpeIncrease: () => HTMLElement;
    rpeDecrease: () => HTMLElement;
    weightInput: () => HTMLInputElement;
    repsInput: () => HTMLInputElement;
    logButton: () => HTMLElement;
    suggestButton: () => HTMLElement;
    querySuggestButton: () => HTMLElement | null;
} {
    const { container } = render(
        <TooltipProvider>
            <SetLogForm
                exercise={buildExercise()}
                previousSet={previousSet}
                suggestion={suggestion}
                isPending={false}
                onLog={onLog}
                onApplySuggestion={onApplySuggestion}
            />
        </TooltipProvider>,
    );
    const scope = within(container);
    const suggestName = 'Suggest my next set';

    return {
        rpeInput: () => scope.getByRole<HTMLInputElement>('spinbutton', { name: 'RPE' }),
        rpeIncrease: () => scope.getByRole('button', { name: 'Increase RPE' }),
        rpeDecrease: () => scope.getByRole('button', { name: 'Decrease RPE' }),
        weightInput: () => scope.getByRole<HTMLInputElement>('spinbutton', { name: 'Weight (kg)' }),
        repsInput: () => scope.getByRole<HTMLInputElement>('spinbutton', { name: 'Reps' }),
        logButton: () => scope.getByRole('button', { name: 'Log set' }),
        suggestButton: () => scope.getByRole('button', { name: suggestName }),
        querySuggestButton: () => scope.queryByRole('button', { name: suggestName }),
    };
}

function buildSuggestion(overrides: Partial<ExerciseSuggestion>): ExerciseSuggestion {
    return {
        exerciseId: 'exercise-1',
        trackingType: TrackingType.WeightReps,
        source: NextEffortSource.LastPerformance,
        isFirstAttempt: false,
        message: 'Last time came in at RPE 6, so this steps you up a little.',
        weightKg: 65,
        reps: 8,
        durationSeconds: null,
        distanceM: null,
        lastPerformedAt: '2026-09-10T10:00:00.000Z',
        target: null,
        ...overrides,
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
