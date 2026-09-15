import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EQUIPMENT_META, EQUIPMENT_ORDER, type Equipment } from '@/models/equipment';

type EquipmentTileGridProps = {
    value: Equipment[];
    onChange: (next: Equipment[]) => void;
    disabled?: boolean;
    'aria-label'?: string;
};

/** Multi-select tiles with large, one-handed tap targets. */
export function EquipmentTileGrid({
    value,
    onChange,
    disabled,
    'aria-label': ariaLabel,
}: EquipmentTileGridProps): JSX.Element {
    const toggle = (item: Equipment): void => {
        onChange(value.includes(item) ? value.filter((other) => other !== item) : [...value, item]);
    };

    return (
        <div role="group" aria-label={ariaLabel ?? 'Equipment'} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {EQUIPMENT_ORDER.map((item) => {
                const { label, icon: Icon } = EQUIPMENT_META[item];
                const selected = value.includes(item);

                return (
                    <button
                        key={item}
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        disabled={disabled}
                        onClick={() => toggle(item)}
                        className={cn(
                            'relative flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                            selected
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'border-border bg-card hover:bg-secondary',
                        )}
                    >
                        {selected && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" aria-hidden />}
                        <Icon className="h-6 w-6" aria-hidden />
                        <span className="text-center leading-tight">{label}</span>
                    </button>
                );
            })}
        </div>
    );
}
