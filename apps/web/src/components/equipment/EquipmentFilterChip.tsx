import { Check, ChevronDown, Settings2, SlidersHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { summarizeEquipment, type EquipmentPreset } from '@/models/equipment';

type EquipmentFilterChipProps = {
    preset: EquipmentPreset | null;
    presets: EquipmentPreset[];
    onSelect: (id: string | null) => void;
    showManageLink?: boolean;
};

/** Shows and switches the equipment preset filtering an exercise list. */
export function EquipmentFilterChip({
    preset,
    presets,
    onSelect,
    showManageLink = false,
}: EquipmentFilterChipProps): JSX.Element | null {
    if (presets.length === 0 && !showManageLink) return null;

    const rows: { id: string | null; label: string; detail?: string }[] = [
        { id: null, label: 'All equipment' },
        ...presets.map((row) => ({ id: row.id, label: row.name, detail: summarizeEquipment(row.equipment) })),
    ];

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant={preset ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-10 gap-2 rounded-full"
                    aria-label="Filter by equipment"
                >
                    <SlidersHorizontal className="h-4 w-4" aria-hidden />
                    <span className="max-w-[10rem] truncate">{preset ? preset.name : 'All equipment'}</span>
                    <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
                <ul role="listbox" aria-label="Equipment preset" className="space-y-1">
                    {rows.map((row) => {
                        const selected = (preset?.id ?? null) === row.id;

                        return (
                            <li key={row.id ?? 'all'}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    onClick={() => onSelect(row.id)}
                                    className={cn(
                                        'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                                        selected ? 'bg-primary/5 font-medium' : 'hover:bg-secondary',
                                    )}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate">{row.label}</span>
                                        {row.detail && (
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {row.detail}
                                            </span>
                                        )}
                                    </span>
                                    {selected && <Check className="h-4 w-4 text-primary" aria-hidden />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
                {showManageLink && (
                    <Link
                        to="/settings?tab=equipment"
                        className="mt-1 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-secondary"
                    >
                        <Settings2 className="h-4 w-4" aria-hidden />
                        Manage equipment
                    </Link>
                )}
            </PopoverContent>
        </Popover>
    );
}
