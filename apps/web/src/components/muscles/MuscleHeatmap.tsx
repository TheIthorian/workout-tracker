import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { BodyDiagram, type MuscleShades } from '@/components/muscles/BodyDiagram';
import { useMuscleVolume } from '@/hooks/use-muscle-volume';
import { MUSCLE_META, type MuscleGroup, type MuscleVolumeEntry, type MuscleVolumeExercise } from '@/models/muscle';

/** The windows the heatmap offers, shortest first. */
const WINDOWS: { days: number; label: string }[] = [
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
];

/**
 * Completed workouts as sets per muscle: a shaded body, then the same muscles ranked.
 *
 * Shading is relative to the hardest-worked muscle in the window rather than to an absolute set
 * count, so a light week and a heavy one are read the same way — the question being asked is which
 * muscles are behind the others, not how much was lifted.
 */
export function MuscleHeatmap({ workspaceId, className }: { workspaceId: string; className?: string }): JSX.Element {
    const [days, setDays] = useState(30);
    const { data, isLoading, isError, refetch } = useMuscleVolume({ workspaceId, days });

    return (
        <section
            aria-labelledby="muscle-heatmap-heading"
            className={cn('rounded-2xl border border-border bg-card p-5', className)}
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 id="muscle-heatmap-heading" className="font-heading text-xl">
                        Muscles trained
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">Sets per muscle from your finished workouts.</p>
                </div>
                <div role="group" aria-label="Time period" className="flex gap-1 rounded-xl bg-secondary p-1">
                    {WINDOWS.map((window) => (
                        <button
                            key={window.days}
                            type="button"
                            aria-pressed={days === window.days}
                            onClick={() => setDays(window.days)}
                            className={cn(
                                'min-h-10 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                days === window.days
                                    ? 'bg-card shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {window.label}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <LoadingState label="Loading…" />
            ) : isError ? (
                <EmptyState
                    title="Your heatmap couldn’t load"
                    description="Check your connection and try again."
                    actionLabel="Try again"
                    onAction={() => void refetch()}
                />
            ) : data === undefined || data.muscles.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">
                    {data && data.totalSets > 0
                        ? 'None of the exercises you trained have muscles tagged yet. Tag them on their exercise pages to see them here.'
                        : 'No finished workouts in this period.'}
                </p>
            ) : (
                <>
                    <BodyDiagram
                        className="mt-6"
                        shades={shadesFrom(data.muscles)}
                        labelForPart={(parts) => describePart({ parts, muscles: data.muscles })}
                    />
                    <p className="mt-4 text-center text-xs text-muted-foreground">
                        {data.sessionCount} {data.sessionCount === 1 ? 'workout' : 'workouts'} · {data.totalSets}{' '}
                        working
                        {data.totalSets === 1 ? ' set' : ' sets'}
                        {data.untaggedSets > 0 && ` · ${data.untaggedSets} from untagged exercises`}
                    </p>
                    <MuscleRanking muscles={data.muscles} />
                    <ExerciseBreakdown exercises={data.exercises} />
                </>
            )}
        </section>
    );
}

function MuscleRanking({ muscles }: { muscles: MuscleVolumeEntry[] }): JSX.Element {
    return (
        <ul className="mt-6 space-y-2">
            {muscles.map((entry) => (
                <li key={entry.muscle} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-sm">{MUSCLE_META[entry.muscle].label}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(3, entry.intensity * 100)}%` }}
                        />
                    </span>
                    <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {formatSets(entry.weightedSets)}
                    </span>
                </li>
            ))}
        </ul>
    );
}

function ExerciseBreakdown({ exercises }: { exercises: MuscleVolumeExercise[] }): JSX.Element | null {
    if (exercises.length === 0) return null;

    return (
        <details className="mt-6 border-t border-border pt-4">
            <summary className="min-h-10 cursor-pointer text-sm font-medium">By exercise</summary>
            <ul className="mt-3 space-y-2">
                {exercises.map((exercise) => (
                    <li key={exercise.exerciseId} className="flex items-baseline justify-between gap-3 text-sm">
                        <Link className="min-w-0 truncate hover:underline" to={`/exercises/${exercise.exerciseId}`}>
                            {exercise.name}
                        </Link>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {exercise.sets} {exercise.sets === 1 ? 'set' : 'sets'}
                        </span>
                    </li>
                ))}
            </ul>
        </details>
    );
}

function shadesFrom(muscles: MuscleVolumeEntry[]): MuscleShades {
    const shades: MuscleShades = {};

    for (const entry of muscles) shades[entry.muscle] = entry.intensity;

    return shades;
}

/**
 * Names a shape and what it took. Where several muscles share a shape only the trained ones are
 * named, so a shoulder reads as the head that was actually worked rather than all three.
 */
function describePart({ parts, muscles }: { parts: MuscleGroup[]; muscles: MuscleVolumeEntry[] }): string {
    const trained = parts
        .map((muscle) => muscles.find((entry) => entry.muscle === muscle))
        .filter((entry): entry is MuscleVolumeEntry => entry !== undefined);

    if (trained.length === 0) return `${parts.map((muscle) => MUSCLE_META[muscle].label).join(' / ')} — nothing yet`;

    return trained.map((entry) => `${MUSCLE_META[entry.muscle].label} — ${formatSets(entry.weightedSets)}`).join(' · ');
}

/** Weighted sets are halves at worst, so one decimal is enough and a whole number stays whole. */
function formatSets(weightedSets: number): string {
    const rounded = Math.round(weightedSets * 10) / 10;

    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${rounded === 1 ? 'set' : 'sets'}`;
}
