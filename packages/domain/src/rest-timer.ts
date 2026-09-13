import { lastLoggedSet, type SessionLike } from './session-state.js';

export type RestTimer = { endsAt: string; remainingSeconds: number; isFinished: boolean };

/** Calculates rest from a persisted set timestamp rather than a live interval. */
export function restTimer({
    startedAt,
    restSeconds,
    now,
}: {
    startedAt: string;
    restSeconds: number;
    now: Date;
}): RestTimer {
    const endsAtMs = Date.parse(startedAt) + restSeconds * 1000;
    const remainingSeconds = Math.min(restSeconds, Math.max(0, Math.ceil((endsAtMs - now.getTime()) / 1000)));
    return { endsAt: new Date(endsAtMs).toISOString(), remainingSeconds, isFinished: remainingSeconds === 0 };
}

/** Returns the active session's current rest timer, if its latest set has prescribed rest. */
export function sessionRestTimer({ session, now }: { session: SessionLike; now: Date }): RestTimer | null {
    if (session.completedAt !== null) return null;
    const last = lastLoggedSet(session);
    if (last === null || last.restSeconds === null || last.restSeconds <= 0) return null;
    return restTimer({ startedAt: last.completedAt, restSeconds: last.restSeconds, now });
}
