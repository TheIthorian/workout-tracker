import { sessionExerciseStatus, SessionExerciseStatus } from '@app/domain';
import { ArrowDown, ArrowUp, BookOpen, CheckCircle2, MoreHorizontal, SkipForward } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SetLogForm } from '@/components/sessions/SetLogForm';
import { formatSessionClock, formatSessionNumber, type LogSetRequest, type SessionExercise } from '@/models/session';

type SessionExerciseCardProps = {
    exercise: SessionExercise;
    isCurrent: boolean;
    isReadOnly: boolean;
    isLogging: boolean;
    isUpdating: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onLog: (data: LogSetRequest) => void;
    onSkip: () => void;
    onMove: (direction: 'up' | 'down') => void;
    onOpenGuide: () => void;
};

/** One exercise in workout mode: recorded sets first, then the next-set input and compact controls. */
export function SessionExerciseCard({
    exercise,
    isCurrent,
    isReadOnly,
    isLogging,
    isUpdating,
    canMoveUp,
    canMoveDown,
    onLog,
    onSkip,
    onMove,
    onOpenGuide,
}: SessionExerciseCardProps): JSX.Element {
    const status = sessionExerciseStatus(exercise);
    const workingSets = exercise.sets.filter(set => !set.isWarmup).length;
    const isSkipped = status === SessionExerciseStatus.Skipped;
    const isDone = status === SessionExerciseStatus.Done;

    return (
        <article
            className={`rounded-2xl border bg-card p-4 shadow-sm transition-colors sm:p-5 ${
                isCurrent ? 'border-primary ring-1 ring-primary/25' : 'border-border'
            } ${isSkipped ? 'opacity-60' : ''}`}
        >
            <div className='flex items-start gap-3'>
                <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                        <h2 className='font-heading text-xl leading-tight'>{exercise.exercise.name}</h2>
                        {isCurrent && <Badge>Up next</Badge>}
                        {isDone && (
                            <Badge variant='secondary' className='gap-1 text-emerald-700 dark:text-emerald-400'>
                                <CheckCircle2 className='h-3.5 w-3.5' aria-hidden />
                                Done
                            </Badge>
                        )}
                        {isSkipped && <Badge variant='secondary'>Skipped</Badge>}
                    </div>
                    <p className='mt-1 text-sm text-muted-foreground'>
                        {workingSets} of {exercise.targetSets} working sets
                        {exercise.restSeconds && exercise.restSeconds > 0
                            ? ` · ${formatSessionClock(exercise.restSeconds)} rest`
                            : ''}
                    </p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='icon' aria-label={`Actions for ${exercise.exercise.name}`}>
                            <MoreHorizontal className='h-5 w-5' aria-hidden />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                        <DropdownMenuItem onSelect={onOpenGuide}>
                            <BookOpen className='mr-2 h-4 w-4' aria-hidden />
                            Exercise guide
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!canMoveUp || isUpdating || isReadOnly} onSelect={() => onMove('up')}>
                            <ArrowUp className='mr-2 h-4 w-4' aria-hidden />
                            Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!canMoveDown || isUpdating || isReadOnly} onSelect={() => onMove('down')}>
                            <ArrowDown className='mr-2 h-4 w-4' aria-hidden />
                            Move down
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={isUpdating || isReadOnly} onSelect={onSkip}>
                            <SkipForward className='mr-2 h-4 w-4' aria-hidden />
                            {isSkipped ? 'Restore exercise' : 'Skip exercise'}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {exercise.notes && <p className='mt-3 whitespace-pre-line text-sm text-muted-foreground'>{exercise.notes}</p>}

            {exercise.sets.length > 0 && (
                <ol className='mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border text-sm'>
                    {exercise.sets.map(set => (
                        <li key={set.id} className='flex items-center gap-3 px-3 py-2'>
                            <span className='w-12 shrink-0 text-xs font-medium text-muted-foreground'>
                                {set.isWarmup ? 'Warm-up' : `Set ${set.setIndex}`}
                            </span>
                            <span className='min-w-0 flex-1 font-medium'>{describeSet({ exercise, set })}</span>
                            {set.rpe !== null && <span className='text-xs text-muted-foreground'>RPE {set.rpe}</span>}
                        </li>
                    ))}
                </ol>
            )}

            {!isDone && !isSkipped && !isReadOnly && (
                <div className='mt-4'>
                    <SetLogForm exercise={exercise} isPending={isLogging} onLog={onLog} />
                </div>
            )}
        </article>
    );
}

/** Formats a stored set using the fields that its tracking type allows. */
function describeSet({ exercise, set }: { exercise: SessionExercise; set: SessionExercise['sets'][number] }): string {
    switch (exercise.trackingType) {
        case 'weight_reps':
            return `${set.reps ?? 0} reps${set.weightKg === null ? '' : ` · ${formatSessionNumber(set.weightKg)} kg`}`;
        case 'duration':
            return formatSessionClock(set.durationSeconds ?? 0);
        case 'distance_time':
            return `${formatSessionNumber(set.distanceM ?? 0)} m · ${formatSessionClock(set.durationSeconds ?? 0)}`;
    }
}
