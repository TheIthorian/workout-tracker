import { DEFAULT_REST_SECONDS } from './rest-timer.js';
import { TrackingType } from './tracking-type.js';

/** A routine slot reduced to what an estimate needs, so callers need not share a row type. */
export type RoutineSlotLike = {
    trackingType: TrackingType;
    targetSets: number;
    targetReps: number | null;
    targetDurationSeconds: number | null;
    restSeconds: number | null;
};

/** Seconds a single rep is assumed to take when a slot counts reps rather than time. */
export const SECONDS_PER_REP = 4;

/**
 * Working seconds assumed for a set whose target says only how many sets to do. Most routines are
 * written that way, and treating those sets as instant would estimate the whole routine at zero.
 */
export const DEFAULT_SET_WORK_SECONDS = 40;

/**
 * Estimated seconds to work through a routine: each slot's working time plus the rest between its
 * sets, falling back to `DEFAULT_REST_SECONDS` where a slot sets none. Warm-ups, setup, and moving
 * between stations are deliberately not modelled, so a real session runs longer than this.
 *
 * A slot that names only its set count still costs `DEFAULT_SET_WORK_SECONDS` a set: those sets get
 * done, and estimating them at zero hides the estimate entirely on a routine written that way. Only
 * a slot with no sets at all is free.
 */
export function estimateRoutineSeconds(slots: RoutineSlotLike[]): number {
    return slots.reduce((total, slot) => total + slotSeconds(slot), 0);
}

function slotSeconds(slot: RoutineSlotLike): number {
    const workSeconds = slotWorkSeconds(slot);
    if (!Number.isFinite(workSeconds) || workSeconds <= 0) return 0;

    const restSeconds = slot.restSeconds ?? DEFAULT_REST_SECONDS;

    return workSeconds + Math.max(0, slot.targetSets - 1) * restSeconds;
}

function slotWorkSeconds(slot: RoutineSlotLike): number {
    return slot.targetSets * perSetSeconds(slot);
}

function perSetSeconds(slot: RoutineSlotLike): number {
    switch (slot.trackingType) {
        case TrackingType.WeightReps:
            return slot.targetReps === null ? DEFAULT_SET_WORK_SECONDS : slot.targetReps * SECONDS_PER_REP;
        case TrackingType.Duration:
        case TrackingType.DistanceTime:
            return slot.targetDurationSeconds ?? DEFAULT_SET_WORK_SECONDS;
    }
}

/** A session's slot: the plan, plus how much of it is already done. */
export type SessionSlotLike = RoutineSlotLike & {
    skippedAt: string | null;
    loggedWorkingSets: number;
};

/**
 * Estimated seconds still to do in a session: the same model as `estimateRoutineSeconds`, counting
 * only the sets not yet logged. A skipped exercise costs nothing, and neither does one already past
 * its target — an extra set beyond the plan does not push the estimate negative.
 */
export function estimateRemainingSessionSeconds(slots: SessionSlotLike[]): number {
    const outstanding = slots
        .filter((slot) => slot.skippedAt === null)
        .map((slot) => ({ ...slot, targetSets: Math.max(0, slot.targetSets - slot.loggedWorkingSets) }))
        .filter((slot) => slot.targetSets > 0);

    return estimateRoutineSeconds(outstanding);
}
