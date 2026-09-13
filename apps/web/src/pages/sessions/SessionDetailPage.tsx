import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BookOpen, CheckCircle2, Plus } from 'lucide-react';
import { ExerciseGuide } from '@/components/exercises/ExerciseGuide';
import { LoadingState } from '@/components/common/LoadingState';
import { ExercisePickerSheet } from '@/components/routines/ExercisePickerSheet';
import { RestTimer } from '@/components/sessions/RestTimer';
import { SessionExerciseCard } from '@/components/sessions/SessionExerciseCard';
import { SetEditDialog } from '@/components/sessions/SetEditDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useExercise } from '@/hooks/use-exercises';
import {
    useAddSessionExercise,
    useAbandonSession,
    useCompleteSession,
    useLogSet,
    useRemoveSessionSet,
    useReorderSessionExercises,
    useSession,
    useUpdateSessionExercise,
    useUpdateSessionSet,
} from '@/hooks/use-sessions';
import { toast } from '@/hooks/use-toast';
import type { PatchSetRequest, SessionExercise, SessionSet } from '@/models/session';
import NotFoundError from '@/pages/NotFoundError';

/** The focused, interruption-tolerant workout screen for an active session. */
export default function SessionDetailPage(): JSX.Element {
    const { workspaceId = '', sessionId = '' } = useParams<{ workspaceId: string; sessionId: string }>();
    const navigate = useNavigate();
    const [isPickerOpen, setPickerOpen] = useState(false);
    const [guideExerciseId, setGuideExerciseId] = useState<string | null>(null);
    const [isCompleteOpen, setCompleteOpen] = useState(false);
    const [isAbandonOpen, setAbandonOpen] = useState(false);
    const [setToEdit, setSetToEdit] = useState<SetSelection | null>(null);
    const [setToDelete, setSetToDelete] = useState<SetSelection | null>(null);
    const { data: session, isLoading, isError } = useSession({ workspaceId, sessionId });
    const { data: guideExercise, isLoading: isGuideLoading } = useExercise({
        workspaceId,
        exerciseId: guideExerciseId ?? '',
    });
    const addExercise = useAddSessionExercise({ workspaceId });
    const updateExercise = useUpdateSessionExercise({ workspaceId });
    const reorderExercises = useReorderSessionExercises({ workspaceId });
    const logSet = useLogSet({ workspaceId });
    const complete = useCompleteSession({ workspaceId });
    const abandon = useAbandonSession({ workspaceId });
    const updateSet = useUpdateSessionSet({ workspaceId });
    const removeSet = useRemoveSessionSet({ workspaceId });

    if (isLoading) {
        return (
            <div className='mx-auto max-w-3xl px-4 py-10 md:px-8'>
                <LoadingState label='Loading workout…' />
            </div>
        );
    }
    if (isError || !session) return <NotFoundError />;

    const isComplete = session.completedAt !== null;
    const handleAdd = (exercise: { id: string; name: string }): void => {
        if (addExercise.isPending || isComplete) return;
        addExercise.mutate(
            { sessionId, variables: { exerciseId: exercise.id, targetSets: 3 } },
            {
                onSuccess: () => toast({ title: `Added ${exercise.name}` }),
                onError: error => toast({ title: 'Could not add exercise', description: error.message, variant: 'destructive' }),
            },
        );
    };
    const handleMove = (exercise: SessionExercise, direction: 'up' | 'down'): void => {
        const orderedIds = session.exercises.map(item => item.id);
        const index = orderedIds.indexOf(exercise.id);
        const otherIndex = direction === 'up' ? index - 1 : index + 1;
        if (otherIndex < 0 || otherIndex >= orderedIds.length) return;
        [orderedIds[index], orderedIds[otherIndex]] = [orderedIds[otherIndex], orderedIds[index]];
        reorderExercises.mutate(
            { sessionId, variables: orderedIds },
            { onError: error => toast({ title: 'Could not reorder exercises', description: error.message, variant: 'destructive' }) },
        );
    };
    const handleComplete = (): void => {
        complete.mutate(
            { sessionId, variables: undefined },
            {
                onSuccess: () => {
                    setCompleteOpen(false);
                    toast({ title: 'Workout complete' });
                    navigate(`/workspaces/${workspaceId}/history`);
                },
                onError: error => toast({ title: 'Could not complete workout', description: error.message, variant: 'destructive' }),
            },
        );
    };
    const handleAbandon = (): void => {
        abandon.mutate(sessionId, {
            onSuccess: () => {
                setAbandonOpen(false);
                toast({ title: 'Workout abandoned' });
                navigate(`/workspaces/${workspaceId}/today`);
            },
            onError: error => toast({ title: 'Could not abandon workout', description: error.message, variant: 'destructive' }),
        });
    };
    const handleUpdateSet = (data: PatchSetRequest): void => {
        if (!setToEdit) return;
        updateSet.mutate(
            {
                sessionId,
                variables: { sessionExerciseId: setToEdit.exercise.id, setId: setToEdit.set.id, data },
            },
            {
                onSuccess: () => setSetToEdit(null),
                onError: error => toast({ title: 'Could not update set', description: error.message, variant: 'destructive' }),
            },
        );
    };
    const handleRemoveSet = (): void => {
        if (!setToDelete) return;
        removeSet.mutate(
            {
                sessionId,
                variables: { sessionExerciseId: setToDelete.exercise.id, setId: setToDelete.set.id },
            },
            {
                onSuccess: () => setSetToDelete(null),
                onError: error => toast({ title: 'Could not delete set', description: error.message, variant: 'destructive' }),
            },
        );
    };

    return (
        <div className='mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10'>
            <div className='flex flex-wrap items-start justify-between gap-4'>
                <div>
                    <p className='text-sm font-medium text-primary'>{isComplete ? 'Completed workout' : 'Workout in progress'}</p>
                    <h1 className='font-heading text-3xl'>{session.name}</h1>
                    <p className='mt-1 text-sm text-muted-foreground'>
                        {session.state.progress.loggedSets} of {session.state.progress.targetSets} working sets logged
                    </p>
                </div>
                {!isComplete && (
                    <div className='flex gap-2'>
                        <Button variant='ghost' onClick={() => setAbandonOpen(true)} disabled={abandon.isPending}>
                            Abandon
                        </Button>
                        <Button onClick={() => setCompleteOpen(true)} disabled={!session.state.canComplete} className='gap-2'>
                            <CheckCircle2 className='h-4 w-4' aria-hidden />
                            Finish workout
                        </Button>
                    </div>
                )}
            </div>

            {session.exercises.length === 0 ? (
                <div className='mt-8 rounded-2xl border border-dashed border-border bg-card p-8 text-center'>
                    <h2 className='font-heading text-xl'>Start with an exercise</h2>
                    <p className='mt-2 text-sm text-muted-foreground'>Add a movement from your library to begin logging.</p>
                    <Button className='mt-4 gap-2' onClick={() => setPickerOpen(true)}>
                        <Plus className='h-4 w-4' aria-hidden />
                        Add exercise
                    </Button>
                </div>
            ) : (
                <div className='mt-8 space-y-4'>
                    {session.exercises.map((exercise, index) => (
                        <SessionExerciseCard
                            key={exercise.id}
                            workspaceId={workspaceId}
                            exercise={exercise}
                            isCurrent={session.state.currentSessionExerciseId === exercise.id && !isComplete}
                            isReadOnly={isComplete}
                            isLogging={logSet.isPending && logSet.variables?.variables.sessionExerciseId === exercise.id}
                            isUpdating={updateExercise.isPending || reorderExercises.isPending || isComplete}
                            canMoveUp={index > 0}
                            canMoveDown={index < session.exercises.length - 1}
                            onLog={data =>
                                logSet.mutate(
                                    { sessionId, variables: { sessionExerciseId: exercise.id, data } },
                                    {
                                        onError: error =>
                                            toast({ title: 'Could not log set', description: error.message, variant: 'destructive' }),
                                    },
                                )
                            }
                            onSkip={() =>
                                updateExercise.mutate(
                                    { sessionId, variables: { sessionExerciseId: exercise.id, data: { skipped: exercise.skippedAt === null } } },
                                    {
                                        onError: error =>
                                            toast({ title: 'Could not update exercise', description: error.message, variant: 'destructive' }),
                                    },
                                )
                            }
                            onMove={direction => handleMove(exercise, direction)}
                            onOpenGuide={() => setGuideExerciseId(exercise.exercise.id)}
                            onEditSet={set => setSetToEdit({ exercise, set })}
                            onRemoveSet={set => setSetToDelete({ exercise, set })}
                            isSetMutating={updateSet.isPending || removeSet.isPending}
                        />
                    ))}
                    {!isComplete && (
                        <Button variant='outline' className='w-full gap-2' onClick={() => setPickerOpen(true)}>
                            <Plus className='h-4 w-4' aria-hidden />
                            Add exercise
                        </Button>
                    )}
                </div>
            )}

            {!isComplete && <RestTimer session={session} />}

            <ExercisePickerSheet
                workspaceId={workspaceId}
                open={isPickerOpen}
                onOpenChange={setPickerOpen}
                onPick={handleAdd}
                isAdding={addExercise.isPending}
            />
            <Sheet open={guideExerciseId !== null} onOpenChange={open => !open && setGuideExerciseId(null)}>
                <SheetContent side='bottom' className='max-h-[85vh] overflow-y-auto rounded-t-2xl md:mx-auto md:max-w-2xl'>
                    <SheetHeader>
                        <SheetTitle className='flex items-center gap-2'>
                            <BookOpen className='h-5 w-5' aria-hidden />
                            {guideExercise?.name ?? 'Exercise guide'}
                        </SheetTitle>
                    </SheetHeader>
                    <div className='mt-6'>{isGuideLoading ? <LoadingState label='Loading guide…' /> : guideExercise && <ExerciseGuide exercise={guideExercise} />}</div>
                </SheetContent>
            </Sheet>
            <AlertDialog open={isCompleteOpen} onOpenChange={setCompleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Finish workout?</AlertDialogTitle>
                        <AlertDialogDescription>Your logged sets will be saved to history. You can still correct them later.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep training</AlertDialogCancel>
                        <AlertDialogAction onClick={handleComplete} disabled={complete.isPending}>
                            {complete.isPending ? 'Finishing…' : 'Finish workout'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={isAbandonOpen} onOpenChange={setAbandonOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Abandon this workout?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This deletes the active session and its recorded sets. Completed workouts stay in history.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep workout</AlertDialogCancel>
                        <AlertDialogAction onClick={handleAbandon} disabled={abandon.isPending} className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
                            {abandon.isPending ? 'Abandoning…' : 'Abandon workout'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={setToDelete !== null} onOpenChange={open => !open && setSetToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this set?</AlertDialogTitle>
                        <AlertDialogDescription>The remaining sets will be renumbered automatically.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep set</AlertDialogCancel>
                        <AlertDialogAction onClick={handleRemoveSet} disabled={removeSet.isPending} className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
                            {removeSet.isPending ? 'Deleting…' : 'Delete set'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <SetEditDialog
                exercise={setToEdit?.exercise ?? null}
                set={setToEdit?.set ?? null}
                isSaving={updateSet.isPending}
                onOpenChange={open => !open && setSetToEdit(null)}
                onSave={handleUpdateSet}
            />
        </div>
    );
}

type SetSelection = { exercise: SessionExercise; set: SessionSet };
