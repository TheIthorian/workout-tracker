import { cn } from '@/lib/utils';
import { TRACKING_TYPE_META, type TrackingType } from '@/models/exercise';

type TrackingTypeIconProps = {
    type: TrackingType;
    /** Sizing and shape of the tile; defaults to the legend's 36px rounded square. */
    className?: string;
    iconClassName?: string;
    /** True where a visible label already names the tracking type, so it is not announced twice. */
    decorative?: boolean;
};

/** The tracking-type tile as the legend draws it, so every surface that shows one matches it. */
export function TrackingTypeIcon({
    type,
    className,
    iconClassName,
    decorative = false,
}: TrackingTypeIconProps): JSX.Element {
    const { icon: Icon, label } = TRACKING_TYPE_META[type];

    return (
        <span
            data-type={type}
            className={cn('exercise-icon h-9 w-9 rounded-lg', className)}
            {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
        >
            <Icon className={cn('h-4 w-4', iconClassName)} aria-hidden />
        </span>
    );
}
