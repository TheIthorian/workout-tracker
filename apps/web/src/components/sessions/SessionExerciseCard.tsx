import { sessionExerciseStatus, SessionExerciseStatus } from '@app/domain';
import { useState } from 'react';
import {
    ArrowDown,
    ArrowUp,
    BookOpen,
    CheckCircle2,
    MoreHorizontal,
    Pencil,
    SkipForward,
    Timer,
    Trash2,
} from 'lucide-react';
import { EquipmentChips } from '@/components/equipment/EquipmentChips';
import { RestTimeSheet } from '@/components/exercises/RestTimeSheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SetLogForm } from '@/components/sessions/SetLogForm';
import { useExerciseHistory, useSetExercisePreferences } from '@/hooks/use-exercises';
import { toast } from '@/hooks/use-toast';
import { formatSessionClock, formatSessionNumber, type LogSetRequest, type SessionExercise } from '@/models/session';

type SessionExerciseCardProps = {
    workspaceId: string;
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
    onEditSet: (set: SessionExercise['sets'][number]) => void;
    onRemoveSet: (set: SessionExercise['sets'][number]) => void;
    isSetMutating: boolean;
};

/** One exercise in workout mode: recorded sets first, then the next-set input and compact controls. */
export function SessionExerciseCard({
    workspaceId,
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
    onEditSet,
    onRemoveSet,
    isSetMutating,
}: SessionExerciseCardProps): JSX.Element {
    const { data: history } = useExerciseHistory({ workspaceId, exerciseId: exercise.exercise.id });
    const setPreferences = useSetExercisePreferences({ workspaceId });
    const [isRestOpen, setRestOpen] = useState(false);
    const lastWorkoutSet = latestWorkingSet(history?.data ?? []);
    // The set just logged is the best guess for the next one; last workout only seeds the first.
    const previousSet = latestWorkingSet([exercise]) ?? lastWorkoutSet;
    const restSeconds = exercise.restSeconds ?? 0;
    const status = sessionExerciseStatus(exercise);
    const workingSets = exercise.sets.filter((set) => !set.isWarmup).length;
    const isSkipped = status === SessionExerciseStatus.Skipped;
    const isDone = status === SessionExerciseStatus.Done;

    return (
        <article
            className={`rounded-2xl border bg-card p-4 shadow-sm transition-colors sm:p-5 ${
                isCurrent ? 'border-primary ring-1 ring-primary/25' : 'border-border'
            } ${isSkipped ? 'opacity-60' : ''}`}
        >
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-heading text-xl leading-tight">{exercise.exercise.name}</h2>
                        {isCurrent && <Badge>Up next</Badge>}
                        {isDone && (
                            <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                                Done
                            </Badge>
                        )}
                        {isSkipped && <Badge variant="secondary">Skipped</Badge>}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                        <span>
                            {workingSets} of {exercise.targetSets} working sets
                        </span>
                        {isReadOnly ? (
                            restSeconds > 0 && <span>· {formatSessionClock(restSeconds)} rest</span>
                        ) : (
                            <button
                                type="button"
                                className="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-primary underline-offset-4 hover:underline"
                                onClick={() => setRestOpen(true)}
                            >
                                <Timer className="h-3.5 w-3.5" aria-hidden />
                                {restSeconds > 0 ? `${formatSessionClock(restSeconds)} rest` : 'No rest timer'}
                            </button>
                        )}
                    </p>
                    <EquipmentChips equipment={exercise.exercise.equipment} className="mt-2" />
                    {lastWorkoutSet && !isReadOnly && (
                        <p className="mt-1 text-xs text-muted-foreground">
                            Last workout: {describeSet({ exercise, set: lastWorkoutSet })}
                        </p>
                    )}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${exercise.exercise.name}`}>
                            <MoreHorizontal className="h-5 w-5" aria-hidden />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={onOpenGuide}>
                            <BookOpen className="mr-2 h-4 w-4" aria-hidden />
                            Exercise guide
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!canMoveUp || isUpdating || isReadOnly}
                            onSelect={() => onMove('up')}
                        >
                            <ArrowUp className="mr-2 h-4 w-4" aria-hidden />
                            Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!canMoveDown || isUpdating || isReadOnly}
                            onSelect={() => onMove('down')}
                        >
                            <ArrowDown className="mr-2 h-4 w-4" aria-hidden />
                            Move down
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={isUpdating || isReadOnly} onSelect={onSkip}>
                            <SkipForward className="mr-2 h-4 w-4" aria-hidden />
                            {isSkipped ? 'Restore exercise' : 'Skip exercise'}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {exercise.notes && (
                <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{exercise.notes}</p>
            )}

            {exercise.sets.length > 0 && (
                <ol className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
                    {exercise.sets.map((set) => (
                        <li key={set.id} className="flex items-center gap-3 px-3 py-2">
                            <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">
                                {set.isWarmup ? 'Warm-up' : `Set ${set.setIndex}`}
                            </span>
                            <span className="min-w-0 flex-1 font-medium">{describeSet({ exercise, set })}</span>
                            {set.rpe !== null && <span className="text-xs text-muted-foreground">RPE {set.rpe}</span>}
                            <span className="flex shrink-0 gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={`Edit set ${set.setIndex}`}
                                    disabled={isSetMutating}
                                    onClick={() => onEditSet(set)}
                                >
                                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    aria-label={`Delete set ${set.setIndex}`}
                                    disabled={isSetMutating}
                                    onClick={() => onRemoveSet(set)}
                                >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                            </span>
                        </li>
                    ))}
                </ol>
            )}

            {!isDone && !isSkipped && !isReadOnly && (
                <div className="mt-4">
                    <SetLogForm exercise={exercise} previousSet={previousSet} isPending={isLogging} onLog={onLog} />
                </div>
            )}

            <RestTimeSheet
                open={isRestOpen}
                exerciseName={exercise.exercise.name}
                restSeconds={restSeconds}
                isSaving={setPreferences.isPending}
                onOpenChange={setRestOpen}
                onSave={(seconds) =>
                    setPreferences.mutate(
                        { exerciseId: exercise.exercise.id, data: { restSeconds: seconds } },
                        {
                            onSuccess: () => {
                                setRestOpen(false);
                                toast({
                                    title:
                                        seconds > 0 ? `Rest set to ${formatSessionClock(seconds)}` : 'Rest timer off',
                                });
                            },
                            onError: (error) =>
                                toast({
                                    title: 'Could not save rest time',
                                    description: error.message,
                                    variant: 'destructive',
                                }),
                        },
                    )
                }
            />
        </article>
    );
}

/** Finds the latest non-warm-up set from a newest-first list of completed workout appearances. */
function latestWorkingSet(
    history: ReadonlyArray<{ sets: SessionExercise['sets'] }>,
): SessionExercise['sets'][number] | null {
    for (const appearance of history) {
        const set = [...appearance.sets].reverse().find((candidate) => !candidate.isWarmup);
        if (set) return set;
    }
    return null;
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
