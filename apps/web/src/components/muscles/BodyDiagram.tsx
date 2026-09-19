import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { MUSCLE_META, MuscleGroup } from '@/models/muscle';
import { BODY_VIEWS, type BodyView, type BodyViewName } from './body-paths';
import { INERT_BODY_PARTS, musclesOfBodyPart } from './muscle-body-parts';

/** How strongly each muscle is shaded, 0 (untouched) to 1 (the hardest-worked muscle shown). */
export type MuscleShades = Partial<Record<MuscleGroup, number>>;

/** Where the pointer is over a figure, and what it is over. */
type Hover = { label: string; x: number; y: number };

const VIEW_LABELS: Record<BodyViewName, string> = { front: 'Front', back: 'Back' };

/**
 * A front and back view of the body with the given muscles shaded, naming each muscle on hover.
 *
 * The shading and the tooltip are both pointer affordances, and neither is the only way to the
 * information: callers pair this with the labelled list naming the same muscles, which is what a
 * screen reader and a colour-blind reader actually get. Regions are deliberately not focusable —
 * nineteen tab stops to read a picture that is already written out alongside it is a worse deal
 * than none.
 */
export function BodyDiagram({
    shades,
    labelForPart,
    className,
}: {
    shades: MuscleShades;
    /** Names one shape, given the muscles sharing it — e.g. "Chest — 12 sets". */
    labelForPart?: (muscles: MuscleGroup[]) => string;
    className?: string;
}): JSX.Element {
    return (
        <div className={cn('flex items-start justify-center gap-2 sm:gap-4', className)}>
            {(Object.keys(BODY_VIEWS) as BodyViewName[]).map((name) => (
                <BodyFigure
                    key={name}
                    name={name}
                    view={BODY_VIEWS[name]}
                    shades={shades}
                    labelForPart={labelForPart ?? defaultLabel}
                />
            ))}
        </div>
    );
}

function BodyFigure({
    name,
    view,
    shades,
    labelForPart,
}: {
    name: BodyViewName;
    view: BodyView;
    shades: MuscleShades;
    labelForPart: (muscles: MuscleGroup[]) => string;
}): JSX.Element {
    const [hover, setHover] = useState<Hover | null>(null);

    // One handler on the figure rather than one per shape: the event's target is the path, and its
    // owning group carries the slug. A touch tap raises pointerdown and pointermove alike, so the
    // same path serves both without a separate touch branch.
    const track = (event: ReactPointerEvent<SVGSVGElement>): void => {
        const group = (event.target as Element).closest<SVGGElement>('[data-part]');
        const slug = group?.dataset['part'];
        const muscles = slug === undefined ? [] : musclesOfBodyPart(slug);

        if (muscles.length === 0) {
            setHover(null);
            return;
        }

        const bounds = event.currentTarget.getBoundingClientRect();

        setHover({
            label: labelForPart(muscles),
            x: clamp({ value: event.clientX - bounds.left, max: bounds.width }),
            y: event.clientY - bounds.top,
        });
    };

    return (
        <figure className="relative m-0 min-w-0 flex-1">
            <svg
                viewBox={view.viewBox}
                role="img"
                aria-label={`${VIEW_LABELS[name]} view of the body with worked muscles shaded`}
                className="mx-auto block h-auto w-full max-w-[260px] touch-manipulation"
                onPointerMove={track}
                onPointerDown={track}
                onPointerLeave={() => setHover(null)}
            >
                {Object.entries(view.parts).map(([slug, paths]) => (
                    <g
                        key={slug}
                        data-part={slug}
                        fill={fillFor({ slug, shades })}
                        stroke="hsl(var(--border))"
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                    >
                        {paths.map((path, index) => (
                            <path key={`${slug}-${index}`} d={path} />
                        ))}
                    </g>
                ))}
            </svg>
            {hover && (
                <span
                    role="status"
                    style={{ left: hover.x, top: hover.y }}
                    className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+0.75rem)] whitespace-nowrap rounded-lg bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-border"
                >
                    {hover.label}
                </span>
            )}
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

function defaultLabel(muscles: MuscleGroup[]): string {
    return muscles.map((muscle) => MUSCLE_META[muscle].label).join(' / ');
}

function clamp({ value, max }: { value: number; max: number }): number {
    return Math.min(Math.max(value, 0), max);
}
