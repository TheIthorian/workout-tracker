import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { ExerciseGuide } from '@/components/exercises/ExerciseGuide';
import { ExerciseGuideEditor } from '@/components/exercises/ExerciseGuideEditor';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExercise, useExerciseHistory } from '@/hooks/use-exercises';
import { TRACKING_TYPE_META } from '@/models/exercise';
import type { SessionSet } from '@/models/session';
import NotFoundError from '@/pages/NotFoundError';

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
    const { workspaceId = '', exerciseId = '' } = useParams<{ workspaceId: string; exerciseId: string }>();
    const navigate = useNavigate();

    const [isEditing, setEditing] = useState(false);

    const { data: exercise, isLoading, isError } = useExercise({ workspaceId, exerciseId });
    const { data: history, isLoading: isHistoryLoading } = useExerciseHistory({ workspaceId, exerciseId });

    if (isLoading) {
        return (
            <div className='mx-auto max-w-3xl px-4 py-10 md:px-8'>
                <LoadingState label='Loading exercise…' />
            </div>
        );
    }

    if (isError || !exercise) {
        return <NotFoundError />;
    }

    const { label, icon: Icon } = TRACKING_TYPE_META[exercise.trackingType];

    return (
        <div className='mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10'>
            <Button
                variant='ghost'
                className='mb-6 gap-2'
                onClick={() => navigate(`/workspaces/${workspaceId}/exercises`)}
            >
                <ArrowLeft className='h-4 w-4' aria-hidden />
                Back to exercises
            </Button>

            <div className='flex flex-wrap items-start justify-between gap-4'>
                <div>
                    <h1 className='font-heading text-3xl text-foreground'>{exercise.name}</h1>
                    <div className='mt-2 flex flex-wrap gap-2'>
                        <Badge variant='secondary' className='gap-1'>
                            <Icon className='h-3 w-3' aria-hidden />
                            {label}
                        </Badge>
                        {exercise.isCatalog && <Badge variant='outline'>Catalog</Badge>}
                    </div>
                </div>
                {/* While editing, ExerciseGuideEditor renders its own close control: it alone knows
                    whether there's unsaved guide text or an open link draft a close might
                    otherwise silently discard, so it alone can decide whether closing is safe. */}
                {!isEditing && !exercise.isCatalog && (
                    <Button variant='outline' className='gap-2' onClick={() => setEditing(true)}>
                        <Pencil className='h-4 w-4' aria-hidden />
                        Edit guide
                    </Button>
                )}
            </div>

            <div className='mt-8'>
                {isEditing ? (
                    <ExerciseGuideEditor
                        workspaceId={workspaceId}
                        exercise={exercise}
                        onDone={() => setEditing(false)}
                    />
                ) : (
                    <ExerciseGuide exercise={exercise} />
                )}
            </div>

            <section className='mt-10 border-t border-border pt-8' aria-labelledby='exercise-history-heading'>
                <h2 id='exercise-history-heading' className='font-heading text-xl'>
                    Recent workouts
                </h2>
                {isHistoryLoading ? (
                    <p className='mt-3 text-sm text-muted-foreground'>Loading workout history…</p>
                ) : (history?.data.length ?? 0) === 0 ? (
                    <p className='mt-3 text-sm text-muted-foreground'>No completed workouts for this exercise yet.</p>
                ) : (
                    <ul className='mt-4 space-y-3'>
                        {history?.data.map((appearance) => (
                            <li key={appearance.sessionExerciseId} className='rounded-xl border border-border bg-card p-4'>
                                <div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
                                    <Link
                                        className='font-medium hover:underline'
                                        to={`/workspaces/${workspaceId}/sessions/${appearance.sessionId}`}
                                    >
                                        {appearance.sessionName}
                                    </Link>
                                    <time className='text-xs text-muted-foreground' dateTime={appearance.completedAt}>
                                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                                            new Date(appearance.completedAt),
                                        )}
                                    </time>
                                </div>
                                <p className='mt-2 text-sm text-muted-foreground'>
                                    {appearance.sets.length === 0
                                        ? 'No sets recorded'
                                        : appearance.sets.map((set) => describeSet({ trackingType: appearance.trackingType, set })).join(' · ')}
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
function describeSet({ trackingType, set }: { trackingType: keyof typeof TRACKING_TYPE_META; set: SessionSet }): string {
    const warmup = set.isWarmup ? 'Warm-up ' : '';
    if (trackingType === 'weight_reps') return `${warmup}${set.weightKg ?? '—'} kg × ${set.reps ?? '—'}`;
    if (trackingType === 'duration') return `${warmup}${set.durationSeconds ?? '—'} sec`;
    return `${warmup}${set.distanceM ?? '—'} m in ${set.durationSeconds ?? '—'} sec`;
}
