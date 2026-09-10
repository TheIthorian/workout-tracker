import { describe, expect, it } from 'vitest';
import { TrackingType, requiredMeasurementFields, validateSetMeasurements } from './tracking-type.js';

describe('requiredMeasurementFields', () => {
    it('requires reps for a weight_reps exercise, but not the load', () => {
        expect(requiredMeasurementFields(TrackingType.WeightReps)).toEqual(['reps']);
    });

    it('requires duration for a duration exercise', () => {
        expect(requiredMeasurementFields(TrackingType.Duration)).toEqual(['durationSeconds']);
    });

    it('requires both distance and duration for a distance_time exercise', () => {
        expect(requiredMeasurementFields(TrackingType.DistanceTime)).toEqual(['distanceM', 'durationSeconds']);
    });
});

describe('validateSetMeasurements', () => {
    it('accepts a weight_reps set with load and reps', () => {
        const result = validateSetMeasurements({
            trackingType: TrackingType.WeightReps,
            measurements: { weightKg: 60, reps: 8 },
        });

        expect(result).toEqual({ valid: true });
    });

    it('accepts a bodyweight set with reps and no load', () => {
        expect(validateSetMeasurements({ trackingType: TrackingType.WeightReps, measurements: { reps: 12 } })).toEqual({
            valid: true,
        });
    });

    it('reports a missing required field', () => {
        const result = validateSetMeasurements({
            trackingType: TrackingType.Duration,
            measurements: { reps: 10 },
        });

        expect(result).toEqual({ valid: false, missing: ['durationSeconds'], unexpected: ['reps'] });
    });

    it('reports a field that does not belong to this tracking type', () => {
        const result = validateSetMeasurements({
            trackingType: TrackingType.DistanceTime,
            measurements: { distanceM: 5000, durationSeconds: 1500, weightKg: 20 },
        });

        expect(result).toEqual({ valid: false, missing: [], unexpected: ['weightKg'] });
    });

    it('treats null the same as absent', () => {
        const result = validateSetMeasurements({
            trackingType: TrackingType.WeightReps,
            measurements: { reps: null, weightKg: null },
        });

        expect(result).toEqual({ valid: false, missing: ['reps'], unexpected: [] });
    });
});
