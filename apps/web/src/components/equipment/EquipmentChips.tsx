import { cn } from '@/lib/utils';
import { EQUIPMENT_META, EQUIPMENT_ORDER, type Equipment } from '@/models/equipment';

const CHIP_CLASS =
    'inline-flex max-w-full items-center gap-1 truncate rounded-full bg-secondary px-2 py-0.5 text-[11px] leading-5 text-muted-foreground';

type EquipmentChipsProps = {
    equipment: Equipment[];
    /** Shows at most this many chips and collapses the rest into a "+N", to keep a phone row readable. */
    max?: number;
    className?: string;
};

/**
 * A set of equipment as icon-and-label chips, in the library's display order. An empty set is
 * bodyweight and says so, rather than leaving a gap a reader cannot tell from missing data.
 */
export function EquipmentChips({ equipment, max, className }: EquipmentChipsProps): JSX.Element {
    const ordered = EQUIPMENT_ORDER.filter((item) => equipment.includes(item));
    const shown = max === undefined ? ordered : ordered.slice(0, max);
    const hidden = ordered.slice(shown.length);

    return (
        <span className={cn('flex flex-wrap items-center gap-1', className)}>
            {ordered.length === 0 ? (
                <span className={CHIP_CLASS}>Bodyweight</span>
            ) : (
                shown.map((item) => {
                    const { label, icon: Icon } = EQUIPMENT_META[item];

                    return (
                        <span key={item} className={CHIP_CLASS}>
                            <Icon className="h-3 w-3 shrink-0" aria-hidden />
                            {label}
                        </span>
                    );
                })
            )}
            {hidden.length > 0 && (
                <span className={CHIP_CLASS} title={hidden.map((item) => EQUIPMENT_META[item].label).join(', ')}>
                    +{hidden.length}
                </span>
            )}
        </span>
    );
}
