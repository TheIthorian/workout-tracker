import { describe, expect, it } from 'vitest';
import { restTimer, sessionRestTimer } from './rest-timer.js';

describe('restTimer', () => {
    it('uses persisted time and rounds fractional seconds up', () => {
        expect(
            restTimer({
                startedAt: '2026-09-13T10:00:00.000Z',
                restSeconds: 90,
                now: new Date('2026-09-13T10:01:29.200Z'),
            }),
        ).toEqual({ endsAt: '2026-09-13T10:01:30.000Z', remainingSeconds: 1, isFinished: false });
    });

    it('does not exceed prescribed rest when clocks disagree', () => {
        expect(
            restTimer({
                startedAt: '2026-09-13T10:00:00.000Z',
                restSeconds: 90,
                now: new Date('2026-09-13T09:00:00.000Z'),
            }).remainingSeconds,
        ).toBe(90);
    });

    it('uses the latest set in an active session and stops after completion', () => {
        const session = {
            completedAt: null,
            exercises: [
                {
                    id: 'exercise',
                    position: 0,
                    targetSets: 1,
                    restSeconds: 60,
                    skippedAt: null,
                    sets: [{ isWarmup: false, completedAt: '2026-09-13T10:00:00.000Z' }],
                },
            ],
        };
        expect(sessionRestTimer({ session, now: new Date('2026-09-13T10:00:30.000Z') })?.remainingSeconds).toBe(30);
        expect(
            sessionRestTimer({ session: { ...session, completedAt: '2026-09-13T10:05:00.000Z' }, now: new Date() }),
        ).toBeNull();
    });
});
