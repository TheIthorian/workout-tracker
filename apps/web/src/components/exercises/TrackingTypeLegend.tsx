import { cn } from '@/lib/utils';
import { TRACKING_TYPE_META, TrackingType } from '@/models/exercise';

type TrackingTypeLegendProps = {
    className?: string;
};

const LEGEND_TITLE = 'A way to track every movement';

/**
 * The legend as a three-column strip of icon over label — short enough to sit above the list on a
 * phone, where the sidebar card would push the exercises themselves off the screen.
 */
export function TrackingTypeLegendStrip({ className }: TrackingTypeLegendProps): JSX.Element {
    return (
        <div className={cn('rounded-2xl border bg-card p-3 shadow-sm', className)}>
            <h2 className="sr-only">{LEGEND_TITLE}</h2>
            <ul className="grid grid-cols-3 gap-2">
                {Object.values(TrackingType).map((type) => {
                    const { icon: Icon, label } = TRACKING_TYPE_META[type];
                    return (
                        <li key={type} className="flex flex-col items-center gap-1.5 text-center">
                            <span data-type={type} className="exercise-icon h-9 w-9 rounded-lg">
                                <Icon className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="text-[11px] leading-tight text-muted-foreground">{label}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/** The legend as a titled card with one row per tracking type, for the desktop sidebar. */
export function TrackingTypeLegendCard({ className }: TrackingTypeLegendProps): JSX.Element {
    return (
        <div className={cn('rounded-2xl border p-5', className)}>
            <h2 className="mb-4 text-sm font-semibold tracking-normal">{LEGEND_TITLE}</h2>
            <ul className="space-y-4">
                {Object.values(TrackingType).map((type) => {
                    const { icon: Icon, label } = TRACKING_TYPE_META[type];
                    return (
                        <li key={type} className="flex items-center gap-3">
                            <span data-type={type} className="exercise-icon h-9 w-9 rounded-lg">
                                <Icon className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="text-xs text-muted-foreground">{label}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
