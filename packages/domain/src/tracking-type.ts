/** How an exercise's work is measured. Decides which fields a logged set must carry. */
export enum TrackingType {
    WeightReps = 'weight_reps',
    Duration = 'duration',
    DistanceTime = 'distance_time',
}

/** The measurement fields a set may carry, in canonical units: kilograms, metres, seconds. */
export type SetMeasurements = {
    weightKg?: number | null;
    reps?: number | null;
    durationSeconds?: number | null;
    distanceM?: number | null;
};

export type SetMeasurementsValidation =
    | { valid: true }
    | { valid: false; missing: ReadonlyArray<keyof SetMeasurements>; unexpected: ReadonlyArray<keyof SetMeasurements> };

/**
 * The measurement fields a set of this tracking type must carry.
 *
 * Load is deliberately absent for `WeightReps`: a bodyweight movement is a weight/reps exercise
 * with no load, and requiring a zero would make "unloaded" and "zero kilograms" indistinguishable.
 */
export function requiredMeasurementFields(trackingType: TrackingType): ReadonlyArray<keyof SetMeasurements> {
    return REQUIRED_FIELDS[trackingType];
}

/** Every field a set of this tracking type is allowed to carry, required or not. */
export function allowedMeasurementFields(trackingType: TrackingType): ReadonlyArray<keyof SetMeasurements> {
    return ALLOWED_FIELDS[trackingType];
}

/**
 * Checks a set's measurements against its exercise's tracking type.
 *
 * @returns the missing required fields and the fields that do not belong to this tracking type.
 */
export function validateSetMeasurements({
    trackingType,
    measurements,
}: {
    trackingType: TrackingType;
    measurements: SetMeasurements;
}): SetMeasurementsValidation {
    const present = (field: keyof SetMeasurements): boolean =>
        measurements[field] !== undefined && measurements[field] !== null;

    const missing = requiredMeasurementFields(trackingType).filter((field) => !present(field));

    const allowed = allowedMeasurementFields(trackingType);
    const unexpected = MEASUREMENT_FIELDS.filter((field) => present(field) && !allowed.includes(field));

    if (missing.length === 0 && unexpected.length === 0) return { valid: true };

    return { valid: false, missing, unexpected };
}

const MEASUREMENT_FIELDS: ReadonlyArray<keyof SetMeasurements> = ['weightKg', 'reps', 'durationSeconds', 'distanceM'];

const REQUIRED_FIELDS: Record<TrackingType, ReadonlyArray<keyof SetMeasurements>> = {
    [TrackingType.WeightReps]: ['reps'],
    [TrackingType.Duration]: ['durationSeconds'],
    [TrackingType.DistanceTime]: ['distanceM', 'durationSeconds'],
};

const ALLOWED_FIELDS: Record<TrackingType, ReadonlyArray<keyof SetMeasurements>> = {
    [TrackingType.WeightReps]: ['weightKg', 'reps'],
    [TrackingType.Duration]: ['durationSeconds'],
    [TrackingType.DistanceTime]: ['distanceM', 'durationSeconds'],
};
