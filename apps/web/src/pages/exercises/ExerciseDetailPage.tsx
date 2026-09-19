import { DEFAULT_REST_SECONDS } from '@app/domain';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, BookOpen, Pencil, PersonStanding, RotateCcw, Timer } from 'lucide-react';
import { formatDate } from '@/lib/date-format';
import { toast } from '@/hooks/use-toast';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/common/EmptyState';
import { isAxiosError } from 'axios';
import { ExerciseGuide } from '@/components/exercises/ExerciseGuide';
import { MuscleTargets } from '@/components/muscles/MuscleTargets';
import { ExerciseGuideEditor } from '@/components/exercises/ExerciseGuideEditor';
import { RestTimeSheet } from '@/components/exercises/RestTimeSheet';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useExercise, useExerciseHistory, useSetExercisePreferences, useUpdateExercise } from '@/hooks/use-exercises';
import { TRACKING_TYPE_META } from '@/models/exercise';
import { EQUIPMENT_META, EQUIPMENT_ORDER } from '@/models/equipment';
import { formatSessionClock, type SessionSet } from '@/models/session';
import ForbiddenError from '@/pages/ForbiddenError';
import NotFoundError from '@/pages/NotFoundError';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/**
 * One exercise's how-to guide: read it in a few seconds mid-rest, or switch to editing it.
 *
 * Loads the exercise once, here, and hands it down to `ExerciseGuide` and `ExerciseGuideEditor` as
 * a prop — neither of those components fetches anything itself, which is what lets `ExerciseGuide`
 * be reused inside a bottom sheet over the live workout screen without a second spinner.
 *
 * Catalog exercises are read-only here: the edit control is not rendered rather than disabled,
 * because there is nothing a member could do to make it work.
 */
export default function ExerciseDetailPage(): JSX.Element {
    const { exerciseId = '' } = useParams<{ exerciseId: string }>();
    const { workspaceId } = useWorkspace();
    const navigate = useNavigate();

    const [isEditing, setEditing] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const updateExercise = useUpdateExercise({ workspaceId });
    const [isRestOpen, setRestOpen] = useState(false);
    const [tab, setTab] = useState('guide');

    const { data: exercise, isLoading, isError, error, refetch } = useExercise({ workspaceId, exerciseId });
    const { data: history, isLoading: isHistoryLoading } = useExerciseHistory({ workspaceId, exerciseId });
    const setPreferences = useSetExercisePreferences({ workspaceId });

    if (isLoading) {
        return (
            <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
                <LoadingState label="Loading exercise…" />
            </div>
        );
    }

    if (isAxiosError(error) && error.response?.status === 403) return <ForbiddenError />;
    if (isError && (!isAxiosError(error) || error.response?.status !== 404))
        return (
            <div className="page-shell">
                <EmptyState
                    title="This exercise couldn’t load"
                    description="Check your connection and try again."
                    actionLabel="Try again"
                    onAction={() => void refetch()}
                />
            </div>
        );

    if (isError || !exercise) {
        return <NotFoundError />;
    }

    const { label, icon: Icon } = TRACKING_TYPE_META[exercise.trackingType];
    // A tab strip of one is just a heading. Catalog exercises nobody here can tag, and that carry
    // no tags, get the guide on its own instead.
    const showMusclesTab =
        !exercise.isCatalog || exercise.primaryMuscles.length > 0 || exercise.secondaryMuscles.length > 0;
    const restSeconds = exercise.restSeconds ?? DEFAULT_REST_SECONDS;
    const handleSaveRest = (seconds: number): void => {
        setPreferences.mutate(
            { exerciseId, data: { restSeconds: seconds } },
            {
                onSuccess: () => {
                    setRestOpen(false);
                    toast({ title: seconds > 0 ? `Rest set to ${formatSessionClock(seconds)}` : 'Rest timer off' });
                },
                onError: (error) =>
                    toast({ title: 'Could not save rest time', description: error.message, variant: 'destructive' }),
            },
        );
    };

    return (
        <div className="page-shell">
            <Button variant="ghost" className="mb-6 gap-2" onClick={() => navigate('/exercises')}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to exercises
            </Button>

            <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-7">
                <div className="min-w-0 flex-1">
                    <p className="eyebrow mb-3">Movement guide</p>
                    <h1 className="page-title break-words">{exercise.name}</h1>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="secondary" className="gap-1">
                            <Icon className="h-3 w-3" aria-hidden />
                            {label}
                        </Badge>
                        {exercise.equipment.length === 0 ? (
                            <Badge variant="outline">Bodyweight</Badge>
                        ) : (
                            EQUIPMENT_ORDER.filter((item) => exercise.equipment.includes(item)).map((item) => (
                                <Badge key={item} variant="outline">
                                    {EQUIPMENT_META[item].label}
                                </Badge>
                            ))
                        )}
                        {exercise.isCatalog && <Badge variant="outline">Forma guide</Badge>}
                        {exercise.archivedAt && <Badge variant="secondary">Archived</Badge>}
                    </div>
                    <button
                        type="button"
                        className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm hover:bg-secondary"
                        onClick={() => setRestOpen(true)}
                    >
                        <Timer className="h-4 w-4 text-primary" aria-hidden />
                        <span className="text-muted-foreground">Rest between sets</span>
                        <span className="font-medium tabular-nums">
                            {restSeconds > 0 ? formatSessionClock(restSeconds) : 'Off'}
                        </span>
                        {exercise.restSeconds === null && (
                            <span className="text-xs text-muted-foreground">(default)</span>
                        )}
                    </button>
                </div>
                {/* While editing, ExerciseGuideEditor renders its own close control: it alone knows
                    whether there's unsaved guide text or an open link draft a close might
                    otherwise silently discard, so it alone can decide whether closing is safe. */}
                {!isEditing && !exercise.isCatalog && (
                    <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}>
                        <Pencil className="h-4 w-4" aria-hidden />
                        Edit guide
                    </Button>
                )}
            </div>

            {isEditing ? (
                <div className="mt-8">
                    <ExerciseGuideEditor
                        key={exercise.id}
                        workspaceId={workspaceId}
                        exercise={exercise}
                        onDone={() => setEditing(false)}
                    />
                </div>
            ) : !showMusclesTab ? (
                <div className="mt-8">
                    <ExerciseGuide exercise={exercise} />
                </div>
            ) : (
                // Held here rather than inside Tabs' own state so the chosen tab survives a trip
                // through the editor and back.
                <Tabs value={tab} onValueChange={setTab} className="mt-8">
                    <TabsList
                        aria-label="Exercise sections"
                        className="h-auto w-full max-w-sm gap-1 rounded-xl border border-border/80 bg-muted/40 p-1.5"
                    >
                        <TabsTrigger value="guide" className="min-h-11 flex-1 gap-2 rounded-lg">
                            <BookOpen className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                            Guide
                        </TabsTrigger>
                        <TabsTrigger value="muscles" className="min-h-11 flex-1 gap-2 rounded-lg">
                            <PersonStanding className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                            Muscles
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="guide" className="mt-6 focus-visible:outline-none">
                        <ExerciseGuide exercise={exercise} />
                    </TabsContent>
                    <TabsContent value="muscles" className="mt-6 focus-visible:outline-none">
                        <MuscleTargets
                            muscles={{
                                primaryMuscles: exercise.primaryMuscles,
                                secondaryMuscles: exercise.secondaryMuscles,
                            }}
                            onEdit={exercise.isCatalog ? undefined : () => setEditing(true)}
                        />
                    </TabsContent>
                </Tabs>
            )}

            {!exercise.isCatalog && (
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-6">
                    <p className="text-xs text-muted-foreground">
                        {exercise.archivedAt
                            ? 'This movement is archived. Your guide and past workouts are safe.'
                            : 'Keep your library focused. Archived exercises keep their history.'}
                    </p>
                    <Button variant="ghost" className="text-muted-foreground" onClick={() => setArchiveOpen(true)}>
                        {exercise.archivedAt ? <RotateCcw /> : <Archive />}
                        {exercise.archivedAt ? 'Restore exercise' : 'Archive exercise'}
                    </Button>
                </div>
            )}
            <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {exercise.archivedAt ? 'Bring this movement back?' : 'Archive this exercise?'}
                        </DialogTitle>
                        <DialogDescription>
                            {exercise.archivedAt
                                ? 'It will appear in your library again.'
                                : 'It will be hidden from your active library. Your guide and workout history stay safe, and you can restore it anytime.'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setArchiveOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            disabled={updateExercise.isPending}
                            onClick={() =>
                                updateExercise.mutate(
                                    { exerciseId: exercise.id, data: { archived: !exercise.archivedAt } },
                                    {
                                        onSuccess: () => {
                                            setArchiveOpen(false);
                                            toast({
                                                title: exercise.archivedAt ? 'Exercise restored' : 'Exercise archived',
                                            });
                                        },
                                    },
                                )
                            }
                        >
                            {updateExercise.isPending
                                ? 'Saving…'
                                : exercise.archivedAt
                                  ? 'Restore exercise'
                                  : 'Archive exercise'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <RestTimeSheet
                open={isRestOpen}
                exerciseName={exercise.name}
                restSeconds={restSeconds}
                isSaving={setPreferences.isPending}
                onOpenChange={setRestOpen}
                onSave={handleSaveRest}
            />

            <section className="mt-10 border-t border-border pt-8" aria-labelledby="exercise-history-heading">
                <h2 id="exercise-history-heading" className="font-heading text-xl">
                    Recent workouts
                </h2>
                {isHistoryLoading ? (
                    <p className="mt-3 text-sm text-muted-foreground">Loading workout history…</p>
                ) : (history?.data.length ?? 0) === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No completed workouts for this exercise yet.</p>
                ) : (
                    <ul className="mt-4 space-y-3">
                        {history?.data.map((appearance) => (
                            <li
                                key={appearance.sessionExerciseId}
                                className="rounded-xl border border-border bg-card p-4"
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                    <Link
                                        className="font-medium hover:underline"
                                        to={`/sessions/${appearance.sessionId}`}
                                    >
                                        {appearance.sessionName}
                                    </Link>
                                    <time className="text-xs text-muted-foreground" dateTime={appearance.completedAt}>
                                        {formatDate(appearance.completedAt)}
                                    </time>
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    {appearance.sets.length === 0
                                        ? 'No sets recorded'
                                        : appearance.sets
                                              .map((set) => describeSet({ trackingType: appearance.trackingType, set }))
                                              .join(' · ')}
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

/** Formats a historical set according to the measurements its tracking type records. */
function describeSet({
    trackingType,
    set,
}: {
    trackingType: keyof typeof TRACKING_TYPE_META;
    set: SessionSet;
}): string {
    const warmup = set.isWarmup ? 'Warm-up ' : '';
    if (trackingType === 'weight_reps') return `${warmup}${set.weightKg ?? '—'} kg × ${set.reps ?? '—'}`;
    if (trackingType === 'duration') return `${warmup}${set.durationSeconds ?? '—'} sec`;
    return `${warmup}${set.distanceM ?? '—'} m in ${set.durationSeconds ?? '—'} sec`;
}
