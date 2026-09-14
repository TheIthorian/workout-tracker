import { lastLoggedSet, restTimer } from '@app/domain';
import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSessionClock, type SessionDetail } from '@/models/session';

const EXTEND_STEP_SECONDS = 30;

/**
 * A pinned rest clock that counts from the last logged set's persisted timestamp, so it stays
 * correct through a reload or a backgrounded tab. Extending it is a local nudge for this rest only.
 */
export function RestTimer({ session }: { session: SessionDetail }): JSX.Element | null {
    const [now, setNow] = useState(() => new Date());
    const [isDismissed, setDismissed] = useState(false);
    const [extraSeconds, setExtraSeconds] = useState(0);
    const last = session.completedAt === null ? lastLoggedSet(session) : null;
    const plannedSeconds = last?.restSeconds ?? 0;
    const timer =
        last !== null && plannedSeconds > 0
            ? restTimer({ startedAt: last.completedAt, restSeconds: plannedSeconds + extraSeconds, now })
            : null;
    const startedAt = last?.completedAt;
    const isTimerFinished = timer?.isFinished ?? true;

    useEffect(() => {
        if (!startedAt || isTimerFinished || isDismissed) return;
        const interval = window.setInterval(() => setNow(new Date()), 1_000);
        return () => window.clearInterval(interval);
    }, [isDismissed, isTimerFinished, startedAt]);

    useEffect(() => {
        setDismissed(false);
        setExtraSeconds(0);
        setNow(new Date());
    }, [startedAt]);

    if (!timer || timer.isFinished || isDismissed) return null;

    const total = plannedSeconds + extraSeconds;
    const progress = total === 0 ? 0 : Math.max(0, Math.min(1, 1 - timer.remainingSeconds / total));

    return (
        <div className="sticky bottom-20 z-20 mx-auto mt-5 max-w-3xl overflow-hidden rounded-xl border border-primary/30 bg-primary text-primary-foreground shadow-lg md:bottom-5">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                    <Timer className="h-4 w-4" aria-hidden />
                    Rest
                </span>
                <time className="font-heading text-3xl tabular-nums" dateTime={timer.endsAt}>
                    {formatSessionClock(timer.remainingSeconds)}
                </time>
                <span className="flex gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-10"
                        onClick={() => setExtraSeconds((current) => current + EXTEND_STEP_SECONDS)}
                    >
                        +{EXTEND_STEP_SECONDS}s
                    </Button>
                    <Button variant="secondary" size="sm" className="h-10" onClick={() => setDismissed(true)}>
                        Skip
                    </Button>
                </span>
            </div>
            <div className="h-1 w-full bg-primary-foreground/20" aria-hidden>
                <div
                    className="h-full bg-primary-foreground/80 transition-[width]"
                    style={{ width: `${progress * 100}%` }}
                />
            </div>
        </div>
    );
}
