import { Suspense, lazy, useState } from 'react';
import { ChevronDown, PersonStanding } from 'lucide-react';
import { cn } from '@/lib/utils';
import { readShowMuscleDiagram, writeShowMuscleDiagram } from '@/lib/muscle-diagram-preference';
import { Badge } from '@/components/ui/badge';
import type { MuscleShades } from '@/components/muscles/BodyDiagram';

// The body artwork is ~20 kB gzipped and this diagram starts hidden, so it is fetched when the
// reader first asks for it rather than with every exercise page.
const BodyDiagram = lazy(async () => ({ default: (await import('@/components/muscles/BodyDiagram')).BodyDiagram }));
import { MUSCLE_META, MuscleGroup, orderMuscles, type MuscleEngagementValue } from '@/models/muscle';

/**
 * What an exercise works: the muscles as labelled badges, and the body diagram behind a toggle.
 *
 * The diagram is opt-in and the choice is remembered per device: it is a welcome orientation the
 * first time someone meets a movement and pure scrolling once they know it.
 */
export function MuscleTargets({
    muscles,
    className,
}: {
    muscles: MuscleEngagementValue;
    className?: string;
}): JSX.Element | null {
    const [showDiagram, setShowDiagram] = useState(readShowMuscleDiagram);
    const primary = orderMuscles(muscles.primaryMuscles);
    const secondary = orderMuscles(muscles.secondaryMuscles).filter((muscle) => !primary.includes(muscle));

    const toggleDiagram = (): void => {
        const next = !showDiagram;
        setShowDiagram(next);
        writeShowMuscleDiagram(next);
    };

    if (primary.length === 0 && secondary.length === 0) return null;

    return (
        <section className={cn('rounded-2xl border border-border bg-card p-5', className)} aria-label="Muscles worked">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-lg">Muscles worked</h2>
                <button
                    type="button"
                    onClick={toggleDiagram}
                    aria-expanded={showDiagram}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <PersonStanding className="h-4 w-4 text-primary" aria-hidden />
                    {showDiagram ? 'Hide muscle map' : 'Show muscle map'}
                    <ChevronDown
                        className={cn('h-4 w-4 transition-transform', showDiagram && 'rotate-180')}
                        aria-hidden
                    />
                </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                {primary.map((muscle) => (
                    <Badge key={muscle}>{MUSCLE_META[muscle].label}</Badge>
                ))}
                {secondary.map((muscle) => (
                    <Badge key={muscle} variant="outline">
                        {MUSCLE_META[muscle].label}
                    </Badge>
                ))}
            </div>
            {(primary.length > 0 || secondary.length > 0) && (
                <p className="mt-2 text-xs text-muted-foreground">
                    Filled badges are what the movement is for; outlined ones are what it also works.
                </p>
            )}
            {showDiagram && (
                <Suspense fallback={<p className="mt-5 text-center text-sm text-muted-foreground">Drawing…</p>}>
                    <BodyDiagram
                        className="mt-5"
                        shades={shadesFor({ primary, secondary })}
                        describeMuscle={(muscle) => describeEngagement({ muscle, primary, secondary })}
                    />
                </Suspense>
            )}
        </section>
    );
}

/** Primary muscles are shaded fully and secondary ones faintly, matching the badges above them. */
function shadesFor({ primary, secondary }: { primary: MuscleGroup[]; secondary: MuscleGroup[] }): MuscleShades {
    const shades: MuscleShades = {};

    for (const muscle of secondary) shades[muscle] = 0.35;
    for (const muscle of primary) shades[muscle] = 1;

    return shades;
}

function describeEngagement({
    muscle,
    primary,
    secondary,
}: {
    muscle: MuscleGroup;
    primary: MuscleGroup[];
    secondary: MuscleGroup[];
}): string {
    const { label } = MUSCLE_META[muscle];
    if (primary.includes(muscle)) return `${label} — primary target`;
    if (secondary.includes(muscle)) return `${label} — also worked`;

    return `${label} — not worked`;
}
