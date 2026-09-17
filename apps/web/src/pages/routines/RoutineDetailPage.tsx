import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, Pencil, Play, Plus } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { EquipmentChips } from '@/components/equipment/EquipmentChips';
import { ExercisePickerSheet } from '@/components/routines/ExercisePickerSheet';
import { RoutineExerciseList } from '@/components/routines/RoutineExerciseList';
import { RoutineExerciseTargetsForm } from '@/components/routines/RoutineExerciseTargetsForm';
import { StartWorkoutButton } from '@/components/sessions/StartWorkoutButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';
import {
    useAddRoutineExercise,
    useRemoveRoutineExercise,
    useReplaceRoutineExercises,
    useRoutine,
    useUpdateRoutine,
    useUpdateRoutineExercise,
} from '@/hooks/use-routines';
import { useActiveSession, useStartSession } from '@/hooks/use-sessions';
import { toast } from '@/hooks/use-toast';
import { getStartWorkoutBlockedReason } from '@/lib/start-workout';
import type { Exercise } from '@/models/exercise';
import {
    aggregateRoutineEquipment,
    type PatchRoutineExerciseRequest,
    type RoutineExercise,
    type SaveRoutineExerciseRequest,
} from '@/models/routine';
import NotFoundError from '@/pages/NotFoundError';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/**
 * The routine editor. Every change saves as it is made — there is no draft to lose when a phone
 * locks mid-edit. On a phone the selected slot's form is a bottom sheet over the list; on a desktop
 * it is the right-hand column.
 */
export default function RoutineDetailPage(): JSX.Element {
    const { routineId = '' } = useParams<{ routineId: string }>();
    const { workspaceId } = useWorkspace();
    const navigate = useNavigate();
    const isMobile = useIsMobile();

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isPickerOpen, setPickerOpen] = useState(false);
    const [isDetailsOpen, setDetailsOpen] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [descriptionDraft, setDescriptionDraft] = useState('');

    const { data: routine, isLoading, isError } = useRoutine({ workspaceId, routineId });
    const updateRoutine = useUpdateRoutine({ workspaceId });
    const addExercise = useAddRoutineExercise({ workspaceId, routineId });
    const updateExercise = useUpdateRoutineExercise({ workspaceId, routineId });
    const removeExercise = useRemoveRoutineExercise({ workspaceId, routineId });
    const replaceExercises = useReplaceRoutineExercises({ workspaceId, routineId });
    const startSession = useStartSession({ workspaceId });
    const activeSession = useActiveSession({ workspaceId });

    if (isLoading) {
        return (
            <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
                <LoadingState label="Loading routine…" />
            </div>
        );
    }

    if (isError || !routine) return <NotFoundError />;

    const selected = routine.exercises.find((slot) => slot.id === selectedId) ?? null;
    const routineEquipment = aggregateRoutineEquipment(routine.exercises);
    const isArchived = routine.archivedAt !== null;
    const sessionInProgress = activeSession.data?.session ?? null;
    const startBlockedReason = getStartWorkoutBlockedReason({
        hasActiveSession: sessionInProgress !== null,
        isRoutineArchived: isArchived,
    });

    const openDetails = (): void => {
        setNameDraft(routine.name);
        setDescriptionDraft(routine.description ?? '');
        setDetailsOpen(true);
    };

    const saveDetails = (): void => {
        updateRoutine.mutate(
            { routineId, data: { name: nameDraft.trim(), description: descriptionDraft.trim() || null } },
            {
                onSuccess: () => setDetailsOpen(false),
                onError: (error) =>
                    toast({ title: 'Could not save', description: error.message, variant: 'destructive' }),
            },
        );
    };

    const toggleArchived = (): void => {
        updateRoutine.mutate(
            { routineId, data: { archived: !isArchived } },
            {
                onSuccess: () => toast({ title: isArchived ? 'Routine restored' : 'Routine archived' }),
                onError: (error) =>
                    toast({
                        title: isArchived ? 'Could not restore' : 'Could not archive',
                        description: error.message,
                        variant: 'destructive',
                    }),
            },
        );
    };

    const startWorkout = (): void => {
        startSession.mutate(
            { routineId },
            {
                onSuccess: (session) => navigate(`/sessions/${session.id}`),
                // Another tab or an MCP client can open a workout between this page's last read and
                // the tap. The shared HTTP client has already surfaced the problem detail, so all
                // that is left is to catch this page up so the control explains itself from now on.
                onError: () => void activeSession.refetch(),
            },
        );
    };

    // A double-tap before the first add resolves would otherwise fire two mutations against the
    // same routine; the picker also disables its rows on `isAdding`, this is the belt and braces.
    const handlePick = (exercise: Exercise): void => {
        if (addExercise.isPending) return;

        addExercise.mutate(
            { exerciseId: exercise.id, targetSets: 3 },
            {
                onSuccess: (updated) => {
                    const last = updated.exercises[updated.exercises.length - 1];
                    toast({ title: `Added ${exercise.name}` });
                    if (last) setSelectedId(last.id);
                },
            },
        );
    };

    const handleSave = (patch: PatchRoutineExerciseRequest): void => {
        if (!selected) return;
        updateExercise.mutate(
            { routineExerciseId: selected.id, data: patch },
            {
                onSuccess: () => {
                    toast({ title: 'Saved' });
                    if (isMobile) setSelectedId(null);
                },
                onError: (error) =>
                    toast({ title: 'Could not save', description: error.message, variant: 'destructive' }),
            },
        );
    };

    const handleRemove = (): void => {
        if (!selected) return;
        removeExercise.mutate(selected.id, {
            onSuccess: () => setSelectedId(null),
            onError: (error) =>
                toast({ title: 'Could not remove', description: error.message, variant: 'destructive' }),
        });
    };

    // Reordering replaces every slot server-side, so the ids in `updated` are new — the previous
    // selection has to be carried over by position, not by id, or the panel just goes blank.
    // Returning the promise (and rethrowing on failure) lets the list roll the drag back on reject.
    const handleReorder = async (orderedIds: string[]): Promise<void> => {
        const isSaving =
            updateExercise.isPending || removeExercise.isPending || addExercise.isPending || replaceExercises.isPending;

        if (isSaving) {
            // A patch, add, or remove already in flight would be overwritten by this PUT's stale
            // cached targets; reject with no toast so the list just snaps the drag back silently.
            throw new Error('Routine reorder skipped: another change is already in progress');
        }

        const byId = new Map(routine.exercises.map((slot) => [slot.id, slot]));
        const requests = orderedIds.flatMap((id) => {
            const slot = byId.get(id);
            return slot ? [toSaveRequest(slot)] : [];
        });

        try {
            const updated = await replaceExercises.mutateAsync(requests);
            const index = selectedId === null ? -1 : orderedIds.indexOf(selectedId);
            setSelectedId(index === -1 ? null : (updated.exercises[index]?.id ?? null));
        } catch (error) {
            toast({ title: 'Could not reorder', variant: 'destructive' });
            throw error;
        }
    };

    const isSlotSaving = updateExercise.isPending || removeExercise.isPending;

    const form = selected && (
        <RoutineExerciseTargetsForm
            slot={selected}
            isSaving={isSlotSaving}
            onSave={handleSave}
            onRemove={handleRemove}
        />
    );

    return (
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
            <Button variant="ghost" className="mb-6 gap-2" onClick={() => navigate('/routines')}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to routines
            </Button>

            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="font-heading text-3xl text-foreground">{routine.name}</h1>
                    {routine.description && <p className="mt-1.5 text-muted-foreground">{routine.description}</p>}
                    {isArchived && (
                        <Badge variant="outline" className="mt-2">
                            Archived
                        </Badge>
                    )}
                </div>
                <div className="flex gap-2">
                    <StartWorkoutButton
                        blockedReason={startBlockedReason}
                        onStart={startWorkout}
                        disabled={startSession.isPending || activeSession.isLoading}
                        className="gap-2"
                    >
                        <Play className="h-4 w-4" aria-hidden />
                        {startSession.isPending ? 'Starting…' : 'Start workout'}
                    </StartWorkoutButton>
                    <Button variant="outline" className="gap-2" onClick={openDetails}>
                        <Pencil className="h-4 w-4" aria-hidden />
                        Edit
                    </Button>
                    <Button
                        variant="ghost"
                        className="gap-2"
                        onClick={toggleArchived}
                        disabled={updateRoutine.isPending}
                    >
                        {isArchived ? (
                            <ArchiveRestore className="h-4 w-4" aria-hidden />
                        ) : (
                            <Archive className="h-4 w-4" aria-hidden />
                        )}
                        {isArchived ? 'Restore' : 'Archive'}
                    </Button>
                </div>
            </div>

            {sessionInProgress && (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-secondary/50 p-4">
                    <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{sessionInProgress.name}</span> is still in
                        progress. Finish or abandon it to start another workout.
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => navigate(`/sessions/${sessionInProgress.id}`)}
                    >
                        <ArrowRight className="h-4 w-4" aria-hidden />
                        Resume workout
                    </Button>
                </div>
            )}

            <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <section>
                    {routine.exercises.length === 0 ? (
                        <EmptyState
                            title="No exercises yet"
                            description="Add the movements this routine is made of. You can drag them into order and set targets for each."
                            actionLabel="Add exercise"
                            onAction={() => setPickerOpen(true)}
                        />
                    ) : (
                        <>
                            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card p-3">
                                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    What you need
                                </h2>
                                <EquipmentChips equipment={routineEquipment} />
                            </div>
                            <RoutineExerciseList
                                slots={routine.exercises}
                                selectedId={selectedId}
                                onSelect={(slot) => setSelectedId(slot.id)}
                                onReorder={handleReorder}
                            />
                            <Button variant="outline" className="mt-4 w-full gap-2" onClick={() => setPickerOpen(true)}>
                                <Plus className="h-4 w-4" aria-hidden />
                                Add exercise
                            </Button>
                        </>
                    )}
                </section>

                {!isMobile && (
                    <aside className="rounded-2xl border border-border bg-card p-5">
                        {form ?? (
                            <p className="text-sm text-muted-foreground">Select an exercise to set its targets.</p>
                        )}
                    </aside>
                )}
            </div>

            {isMobile && (
                <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
                    <SheetContent side="bottom" className="rounded-t-2xl">
                        <SheetHeader className="sr-only">
                            <SheetTitle>Exercise targets</SheetTitle>
                        </SheetHeader>
                        {form}
                    </SheetContent>
                </Sheet>
            )}

            <ExercisePickerSheet
                workspaceId={workspaceId}
                open={isPickerOpen}
                onOpenChange={setPickerOpen}
                onPick={handlePick}
                isAdding={addExercise.isPending}
            />

            <Dialog open={isDetailsOpen} onOpenChange={setDetailsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit routine</DialogTitle>
                        <DialogDescription>Name and an optional description.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="routine-name">Name</Label>
                            <Input
                                id="routine-name"
                                value={nameDraft}
                                maxLength={200}
                                onChange={(event) => setNameDraft(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="routine-description">Description</Label>
                            <Textarea
                                id="routine-description"
                                value={descriptionDraft}
                                maxLength={2000}
                                rows={3}
                                onChange={(event) => setDescriptionDraft(event.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDetailsOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={saveDetails}
                            disabled={nameDraft.trim().length === 0 || updateRoutine.isPending}
                        >
                            {updateRoutine.isPending ? 'Saving…' : 'Save'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** A stored slot as the PUT body wants it — the same targets, keyed by exercise rather than slot. */
function toSaveRequest(slot: RoutineExercise): SaveRoutineExerciseRequest {
    return {
        exerciseId: slot.exercise.id,
        targetSets: slot.targetSets,
        restSeconds: slot.restSeconds,
        notes: slot.notes,
        targetReps: slot.targetReps,
        targetWeightKg: slot.targetWeightKg,
        targetDurationSeconds: slot.targetDurationSeconds,
        targetDistanceM: slot.targetDistanceM,
    };
}
