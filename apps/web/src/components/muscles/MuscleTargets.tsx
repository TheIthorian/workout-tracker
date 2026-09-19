import { Suspense, lazy } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MuscleShades } from '@/components/muscles/BodyDiagram';
import { MUSCLE_META, MuscleGroup, orderMuscles, type MuscleEngagementValue } from '@/models/muscle';

// The body artwork is ~20 kB gzipped and sits below the fold, so it arrives on its own rather than
// holding up the guide someone opened this page to read.
const BodyDiagram = lazy(async () => ({ default: (await import('@/components/muscles/BodyDiagram')).BodyDiagram }));

/**
 * What an exercise works: the body map and the same muscles written out under it.
 *
 * The map is shown outright rather than behind a control. It is the faster of the two to read
 * between sets, and a reader who wants it every time should not have to ask for it every time.
 */
export function MuscleTargets({
    muscles,
    onEdit,
    className,
}: {
    muscles: MuscleEngagementValue;
    /** Offered when the exercise has no tags yet and the reader is allowed to add them. */
    onEdit?: () => void;
    className?: string;
}): JSX.Element | null {
    const main = orderMuscles(muscles.primaryMuscles);
    const also = orderMuscles(muscles.secondaryMuscles).filter((muscle) => !main.includes(muscle));

    if (main.length === 0 && also.length === 0) {
        if (onEdit === undefined) return null;

        return (
            <section className={cn('rounded-2xl border border-border bg-card p-5', className)}>
                <h2 className="font-heading text-lg">Muscles worked</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    No muscles tagged yet. Tag them and this exercise will count towards your History totals.
                </p>
                <Button variant="outline" className="mt-3" onClick={onEdit}>
                    Tag muscles
                </Button>
            </section>
        );
    }

    return (
        <section className={cn('rounded-2xl border border-border bg-card p-5', className)} aria-label="Muscles worked">
            <h2 className="font-heading text-lg">Muscles worked</h2>
            {/* Stacked at every width: this card's own column is narrow on a desktop, so a
                breakpoint on the viewport would put two columns inside 21rem and crush both. */}
            <div className="mt-4 space-y-5">
                <Suspense fallback={<div className="h-48" aria-hidden />}>
                    <BodyDiagram
                        shades={shadesFor({ main, also })}
                        labelForPart={(parts) => describePart({ parts, main, also })}
                    />
                </Suspense>
                <div className="space-y-4">
                    <MuscleList label="Main" muscles={main} />
                    <MuscleList label="Also worked" muscles={also} variant="outline" />
                </div>
            </div>
        </section>
    );
}

function MuscleList({
    label,
    muscles,
    variant,
}: {
    label: string;
    muscles: MuscleGroup[];
    variant?: 'outline';
}): JSX.Element | null {
    if (muscles.length === 0) return null;

    return (
        <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <div className="flex flex-wrap gap-2">
                {muscles.map((muscle) => (
                    <Badge key={muscle} variant={variant}>
                        {MUSCLE_META[muscle].label}
                    </Badge>
                ))}
            </div>
        </div>
    );
}

/** Main muscles are shaded fully and the rest faintly, matching the two lists under the map. */
function shadesFor({ main, also }: { main: MuscleGroup[]; also: MuscleGroup[] }): MuscleShades {
    const shades: MuscleShades = {};

    for (const muscle of also) shades[muscle] = 0.35;
    for (const muscle of main) shades[muscle] = 1;

    return shades;
}

/**
 * Names a shape by what this exercise does to it. Where several muscles share a shape only the
 * worked ones are named — listing the untouched heads of a shoulder as "not worked" is noise.
 */
function describePart({
    parts,
    main,
    also,
}: {
    parts: MuscleGroup[];
    main: MuscleGroup[];
    also: MuscleGroup[];
}): string {
    const worked = parts.filter((muscle) => main.includes(muscle) || also.includes(muscle));
    const named = worked.length > 0 ? worked : parts;
    const labels = named.map((muscle) => MUSCLE_META[muscle].label).join(' / ');

    if (worked.length === 0) return labels;

    return `${labels} — ${worked.every((muscle) => main.includes(muscle)) ? 'main' : 'also worked'}`;
}
