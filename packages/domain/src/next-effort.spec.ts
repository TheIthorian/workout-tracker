import { describe, expect, it } from 'vitest';
import {
    FIRST_ATTEMPT_MESSAGE,
    NextEffortSource,
    suggestNextEffort,
    type LastPerformance,
    type NextEffortTarget,
} from './next-effort.js';
import { TrackingType } from './tracking-type.js';

const performance = (overrides: Partial<LastPerformance> = {}): LastPerformance => ({
    weightKg: 60,
    reps: 8,
    durationSeconds: null,
    distanceM: null,
    rpe: null,
    performedAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
});

const target = (overrides: Partial<NextEffortTarget> = {}): NextEffortTarget => ({
    weightKg: 70,
    reps: 5,
    durationSeconds: null,
    distanceM: null,
    note: null,
    setAt: '2026-01-11T10:00:00.000Z',
    ...overrides,
});

describe('suggestNextEffort', () => {
    it('advises finding a baseline the first time an exercise is trained', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: null,
            lastPerformance: null,
        });

        expect(suggestion).toEqual({
            source: NextEffortSource.Baseline,
            isFirstAttempt: true,
            message: FIRST_ATTEMPT_MESSAGE,
            weightKg: null,
            reps: null,
            durationSeconds: null,
            distanceM: null,
        });
    });

    it('uses a target set after the last session, with its note as the message', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: target({ note: 'Go for a heavy triple.' }),
            lastPerformance: performance(),
        });

        expect(suggestion.source).toBe(NextEffortSource.Target);
        expect(suggestion.weightKg).toBe(70);
        expect(suggestion.reps).toBe(5);
        expect(suggestion.message).toBe('Go for a heavy triple.');
    });

    it('applies a target on a first attempt and still reports it as one', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: target(),
            lastPerformance: null,
        });

        expect(suggestion.source).toBe(NextEffortSource.Target);
        expect(suggestion.isFirstAttempt).toBe(true);
    });

    it('treats a target older than the last session as spent', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: target({ setAt: '2026-01-09T10:00:00.000Z' }),
            lastPerformance: performance(),
        });

        expect(suggestion.source).toBe(NextEffortSource.LastPerformance);
        expect(suggestion.weightKg).toBe(60);
    });

    it('drops measurements that do not belong to the tracking type', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.Duration,
            target: target({ durationSeconds: 90 }),
            lastPerformance: null,
        });

        expect(suggestion).toMatchObject({ durationSeconds: 90, weightKg: null, reps: null, distanceM: null });
    });

    it('repeats the last set when no RPE was recorded', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: null,
            lastPerformance: performance({ rpe: null }),
        });

        expect(suggestion).toMatchObject({ weightKg: 60, reps: 8, message: 'Matches what you did last time.' });
    });

    it('repeats the last set when it was already at the limit', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: null,
            lastPerformance: performance({ rpe: 10 }),
        });

        expect(suggestion.weightKg).toBe(60);
        expect(suggestion.message).toContain('lock it in');
    });

    it('holds effort steady for an RPE between easy and hard', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: null,
            lastPerformance: performance({ rpe: 8.5 }),
        });

        expect(suggestion.weightKg).toBe(60);
        expect(suggestion.message).toContain('same effort');
    });

    it('raises the weight after an easy set, rounded to a plate change', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: null,
            lastPerformance: performance({ weightKg: 60, rpe: 6 }),
        });

        expect(suggestion.weightKg).toBe(65);
        expect(suggestion.reps).toBe(8);
    });

    it('raises a light weight by a single increment rather than a fraction of one', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: null,
            lastPerformance: performance({ weightKg: 10, rpe: 7 }),
        });

        expect(suggestion.weightKg).toBe(12.5);
    });

    it('adds a rep instead of load when the last set carried no weight', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.WeightReps,
            target: null,
            lastPerformance: performance({ weightKg: null, reps: 12, rpe: 6 }),
        });

        expect(suggestion).toMatchObject({ weightKg: null, reps: 13 });
    });

    it('extends the time after an easy timed set', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.Duration,
            target: null,
            lastPerformance: performance({ weightKg: null, reps: null, durationSeconds: 60, rpe: 6 }),
        });

        expect(suggestion.durationSeconds).toBe(65);
    });

    it('extends the distance after an easy cardio set and leaves the time alone', () => {
        const suggestion = suggestNextEffort({
            trackingType: TrackingType.DistanceTime,
            target: null,
            lastPerformance: performance({
                weightKg: null,
                reps: null,
                distanceM: 5000,
                durationSeconds: 1500,
                rpe: 5,
            }),
        });

        expect(suggestion).toMatchObject({ distanceM: 5300, durationSeconds: 1500 });
    });
});
