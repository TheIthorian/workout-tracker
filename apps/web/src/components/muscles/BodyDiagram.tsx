import { cn } from '@/lib/utils';
import { MUSCLE_META, MuscleGroup } from '@/models/muscle';
import { BODY_VIEWS, type BodyView, type BodyViewName } from './body-paths';
import { INERT_BODY_PARTS, musclesOfBodyPart } from './muscle-body-parts';

/** How strongly each muscle is shaded, 0 (untouched) to 1 (the hardest-worked muscle shown). */
export type MuscleShades = Partial<Record<MuscleGroup, number>>;

const VIEW_LABELS: Record<BodyViewName, string> = { front: 'Front', back: 'Back' };

/**
 * A front and back view of the body with the given muscles shaded.
 *
 * The shading is decorative on its own — callers pair it with the labelled list that names the
 * same muscles, which is what a screen reader and a colour-blind reader actually get.
 */
export function BodyDiagram({
    shades,
    describeMuscle,
    className,
}: {
    shades: MuscleShades;
    /** A tooltip per muscle, e.g. "Chest — 12 sets"; a shared shape names each of its muscles. */
    describeMuscle?: (muscle: MuscleGroup) => string;
    className?: string;
}): JSX.Element {
    return (
        <div className={cn('flex items-start justify-center gap-2 sm:gap-6', className)}>
            {(Object.keys(BODY_VIEWS) as BodyViewName[]).map((name) => (
                <BodyFigure
                    key={name}
                    name={name}
                    view={BODY_VIEWS[name]}
                    shades={shades}
                    describeMuscle={describeMuscle}
                />
            ))}
        </div>
    );
}

function BodyFigure({
    name,
    view,
    shades,
    describeMuscle,
}: {
    name: BodyViewName;
    view: BodyView;
    shades: MuscleShades;
    describeMuscle?: (muscle: MuscleGroup) => string;
}): JSX.Element {
    return (
        <figure className="m-0 min-w-0 flex-1">
            <svg
                viewBox={view.viewBox}
                role="img"
                aria-label={`${VIEW_LABELS[name]} view of the body with worked muscles shaded`}
                className="mx-auto block h-auto w-full max-w-[260px]"
            >
                {Object.entries(view.parts).map(([slug, paths]) => (
                    <g
                        key={slug}
                        fill={fillFor({ slug, shades })}
                        stroke="hsl(var(--border))"
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                    >
                        {titleFor({ slug, describeMuscle })}
                        {paths.map((path, index) => (
                            <path key={`${slug}-${index}`} d={path} />
                        ))}
                    </g>
                ))}
            </svg>
            <figcaption className="mt-1 text-center text-xs text-muted-foreground">{VIEW_LABELS[name]}</figcaption>
        </figure>
    );
}

/**
 * A shape takes the warmest shade of the muscles sharing it. A shaded muscle starts well above zero
 * opacity, so the least trained muscle on the map is still visibly different from an untrained one.
 */
function fillFor({ slug, shades }: { slug: string; shades: MuscleShades }): string {
    if (INERT_BODY_PARTS.has(slug)) return 'hsl(var(--muted))';

    const intensity = Math.max(0, ...musclesOfBodyPart(slug).map((muscle) => shades[muscle] ?? 0));
    if (intensity <= 0) return 'hsl(var(--muted-foreground) / 0.16)';

    return `hsl(var(--primary) / ${(0.3 + 0.7 * Math.min(1, intensity)).toFixed(3)})`;
}

function titleFor({
    slug,
    describeMuscle,
}: {
    slug: string;
    describeMuscle?: (muscle: MuscleGroup) => string;
}): JSX.Element | null {
    const muscles = musclesOfBodyPart(slug);
    if (muscles.length === 0) return null;

    return <title>{muscles.map((muscle) => describeMuscle?.(muscle) ?? MUSCLE_META[muscle].label).join(' · ')}</title>;
}
