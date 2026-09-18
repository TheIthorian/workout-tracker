import { cn } from '@/lib/utils';
import { MUSCLE_META, MuscleGroup } from '@/models/muscle';
import {
    BACK_MUSCLES,
    BODY_SILHOUETTE,
    BODY_VIEW_BOX,
    FRONT_MUSCLES,
    type BodyShape,
    type MuscleShape,
} from './body-diagram-shapes';

/** How strongly each muscle is shaded, 0 (untouched) to 1 (the hardest-worked muscle shown). */
export type MuscleShades = Partial<Record<MuscleGroup, number>>;

/**
 * A front and back view of the body with the given muscles shaded.
 *
 * The figure is deliberately schematic rather than anatomical: it is read at a glance on a phone,
 * where an accurate drawing's detail would be smaller than a fingertip. Every muscle keeps its
 * own shape, so the same drawing serves one exercise's targets and a whole month's volume.
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
    /** A tooltip per shaded muscle, e.g. "Chest — 12 sets". */
    describeMuscle?: (muscle: MuscleGroup) => string;
    className?: string;
}): JSX.Element {
    return (
        <div className={cn('flex items-start justify-center gap-4', className)}>
            <BodyView label="Front" muscles={FRONT_MUSCLES} shades={shades} describeMuscle={describeMuscle} />
            <BodyView label="Back" muscles={BACK_MUSCLES} shades={shades} describeMuscle={describeMuscle} />
        </div>
    );
}

function BodyView({
    label,
    muscles,
    shades,
    describeMuscle,
}: {
    label: string;
    muscles: MuscleShape[];
    shades: MuscleShades;
    describeMuscle?: (muscle: MuscleGroup) => string;
}): JSX.Element {
    return (
        <figure className="m-0 min-w-0 flex-1">
            <svg
                viewBox={BODY_VIEW_BOX}
                role="img"
                aria-label={`${label} view of the body with worked muscles shaded`}
                className="mx-auto block h-auto w-full max-w-[180px]"
            >
                <g fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth={0.7}>
                    {BODY_SILHOUETTE.map((shape, index) => renderShape({ shape, key: `body-${index}` }))}
                </g>
                {muscles.map(({ muscle, shapes }) => (
                    <g key={muscle} fill={fillFor(shades[muscle] ?? 0)} stroke="none">
                        <title>{describeMuscle?.(muscle) ?? MUSCLE_META[muscle].label}</title>
                        {shapes.map((shape, index) => renderShape({ shape, key: `${muscle}-${index}` }))}
                    </g>
                ))}
            </svg>
            <figcaption className="mt-1 text-center text-xs text-muted-foreground">{label}</figcaption>
        </figure>
    );
}

/**
 * Turns an intensity into a fill. A shaded muscle starts well above zero opacity, so the least
 * trained muscle on the diagram is still visibly different from one that was not trained at all.
 */
function fillFor(intensity: number): string {
    if (intensity <= 0) return 'hsl(var(--muted-foreground) / 0.16)';

    return `hsl(var(--primary) / ${(0.3 + 0.7 * Math.min(1, intensity)).toFixed(3)})`;
}

function renderShape({ shape, key }: { shape: BodyShape; key: string }): JSX.Element {
    if (shape.kind === 'ellipse') return <ellipse key={key} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />;

    if (shape.kind === 'rect')
        return (
            <rect
                key={key}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                rx={shape.radius}
                ry={shape.radius}
            />
        );

    return <path key={key} d={shape.d} />;
}
