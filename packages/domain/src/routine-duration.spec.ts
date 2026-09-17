import { describe, expect, it } from 'vitest';
import { DEFAULT_REST_SECONDS } from './rest-timer.js';
import {
    estimateRemainingSessionSeconds,
    estimateRoutineSeconds,
    SECONDS_PER_REP,
    type RoutineSlotLike,
} from './routine-duration.js';
import { TrackingType } from './tracking-type.js';

const repped: RoutineSlotLike = {
    trackingType: TrackingType.WeightReps,
    targetSets: 3,
    targetReps: 8,
    targetDurationSeconds: null,
    restSeconds: 120,
};

const timed: RoutineSlotLike = {
    trackingType: TrackingType.Duration,
    targetSets: 3,
    targetReps: null,
    targetDurationSeconds: 60,
    restSeconds: 30,
};

describe('estimateRoutineSeconds', () => {
    it('is zero for a routine with no slots', () => {
        expect(estimateRoutineSeconds([])).toBe(0);
    });

    it('counts reps as working time plus the rest between sets', () => {
        expect(estimateRoutineSeconds([repped])).toBe(3 * 8 * SECONDS_PER_REP + 2 * 120);
    });

    it('counts a timed slot by its target duration', () => {
        expect(estimateRoutineSeconds([timed])).toBe(3 * 60 + 2 * 30);
    });

    it('treats a distance slot like a timed one, and skips it without a target time', () => {
        const distance = { ...timed, trackingType: TrackingType.DistanceTime };

        expect(estimateRoutineSeconds([distance])).toBe(3 * 60 + 2 * 30);
        expect(estimateRoutineSeconds([{ ...distance, targetDurationSeconds: null }])).toBe(0);
    });

    it('falls back to the default rest when a slot sets none', () => {
        expect(estimateRoutineSeconds([{ ...repped, restSeconds: null }])).toBe(
            3 * 8 * SECONDS_PER_REP + 2 * DEFAULT_REST_SECONDS,
        );
    });

    it('adds no rest to a single-set slot', () => {
        expect(estimateRoutineSeconds([{ ...repped, targetSets: 1 }])).toBe(8 * SECONDS_PER_REP);
    });

    it('contributes nothing for a slot with no usable target', () => {
        expect(estimateRoutineSeconds([{ ...repped, targetReps: null }])).toBe(0);
    });

    it('sums every slot in the routine', () => {
        expect(estimateRoutineSeconds([repped, timed])).toBe(3 * 8 * SECONDS_PER_REP + 2 * 120 + (3 * 60 + 2 * 30));
    });
});

describe('estimateRemainingSessionSeconds', () => {
    const pending = { ...repped, skippedAt: null, loggedWorkingSets: 0 };

    it('counts only the sets still to log', () => {
        expect(estimateRemainingSessionSeconds([{ ...pending, loggedWorkingSets: 1 }])).toBe(
            2 * 8 * SECONDS_PER_REP + 120,
        );
    });

    it('costs nothing once every set is logged', () => {
        expect(estimateRemainingSessionSeconds([{ ...pending, loggedWorkingSets: 3 }])).toBe(0);
    });

    it('does not go negative when more sets were logged than planned', () => {
        expect(estimateRemainingSessionSeconds([{ ...pending, loggedWorkingSets: 5 }])).toBe(0);
    });

    it('ignores a skipped exercise', () => {
        expect(estimateRemainingSessionSeconds([{ ...pending, skippedAt: '2026-01-01T00:00:00.000Z' }])).toBe(0);
    });

    it('matches the routine estimate before anything is logged', () => {
        expect(estimateRemainingSessionSeconds([pending])).toBe(estimateRoutineSeconds([repped]));
    });
});
