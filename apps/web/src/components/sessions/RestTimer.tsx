import { sessionRestTimer } from '@app/domain';
import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSessionClock, type SessionDetail } from '@/models/session';

/** A pinned, persisted-timestamp rest clock that stays correct through a reload or backgrounded tab. */
export function RestTimer({ session }: { session: SessionDetail }): JSX.Element | null {
    const [now, setNow] = useState(() => new Date());
    const [isDismissed, setDismissed] = useState(false);
    const timer = sessionRestTimer({ session, now });
    const timerEndsAt = timer?.endsAt;
    const isTimerFinished = timer?.isFinished ?? true;

    useEffect(() => {
        if (!timerEndsAt || isTimerFinished || isDismissed) return;
        const interval = window.setInterval(() => setNow(new Date()), 1_000);
        return () => window.clearInterval(interval);
    }, [isDismissed, isTimerFinished, timerEndsAt]);

    useEffect(() => setDismissed(false), [timerEndsAt]);

    if (!timer || timer.isFinished || isDismissed) return null;

    return (
        <div className='sticky bottom-20 z-20 mx-auto mt-5 flex max-w-3xl items-center justify-between rounded-xl border border-primary/30 bg-primary px-4 py-3 text-primary-foreground shadow-lg md:bottom-5'>
            <span className='flex items-center gap-2 text-sm font-medium'>
                <Timer className='h-4 w-4' aria-hidden />
                Rest timer
            </span>
            <time className='font-heading text-2xl tabular-nums' dateTime={timer.endsAt}>
                {formatSessionClock(timer.remainingSeconds)}
            </time>
            <Button variant='secondary' size='sm' onClick={() => setDismissed(true)}>
                Skip rest
            </Button>
        </div>
    );
}
