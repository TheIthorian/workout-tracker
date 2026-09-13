import { useEffect, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { describeTargets, type RoutineExercise } from '@/models/routine';

type RoutineExerciseListProps = {
    slots: RoutineExercise[];
    selectedId: string | null;
    onSelect: (slot: RoutineExercise) => void;
    /** Fired once per drop with the complete new order. */
    onReorder: (orderedIds: string[]) => void;
};

/**
 * The routine's slots, drag-reorderable by the handle. Order is held locally while dragging and
 * committed once on drop, so a slow save does not fight the gesture.
 */
export function RoutineExerciseList({ slots, selectedId, onSelect, onReorder }: RoutineExerciseListProps): JSX.Element {
    const [order, setOrder] = useState<RoutineExercise[]>(slots);
    // `onDragEnd` closes over the render it was created in; the ref always has the latest order.
    const latest = useRef(order);
    latest.current = order;

    useEffect(() => {
        setOrder(slots);
    }, [slots]);

    const commit = (): void => {
        const ids = latest.current.map((slot) => slot.id);
        if (ids.some((id, index) => id !== slots[index]?.id)) onReorder(ids);
    };

    return (
        <Reorder.Group axis='y' values={order} onReorder={setOrder} className='space-y-2'>
            {order.map((slot) => (
                <SlotRow
                    key={slot.id}
                    slot={slot}
                    isSelected={slot.id === selectedId}
                    onSelect={() => onSelect(slot)}
                    onDrop={commit}
                />
            ))}
        </Reorder.Group>
    );
}

type SlotRowProps = {
    slot: RoutineExercise;
    isSelected: boolean;
    onSelect: () => void;
    onDrop: () => void;
};

function SlotRow({ slot, isSelected, onSelect, onDrop }: SlotRowProps): JSX.Element {
    const controls = useDragControls();

    return (
        <Reorder.Item
            value={slot}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDrop}
            className={cn(
                'flex items-center gap-2 rounded-xl border bg-card pr-3 transition-colors',
                isSelected ? 'border-primary' : 'border-border',
            )}
        >
            <button
                type='button'
                aria-label='Drag to reorder'
                onPointerDown={(event) => controls.start(event)}
                className='flex h-14 w-10 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing'
            >
                <GripVertical className='h-5 w-5' aria-hidden />
            </button>
            <button
                type='button'
                onClick={onSelect}
                className='flex min-h-[3.5rem] min-w-0 flex-1 flex-col justify-center py-2 text-left'
            >
                <span className='flex items-center gap-2'>
                    <span className='truncate font-medium'>{slot.exercise.name}</span>
                    {slot.exercise.archivedAt && (
                        <Badge variant='destructive' className='shrink-0'>
                            Archived
                        </Badge>
                    )}
                </span>
                <span className='text-xs text-muted-foreground'>{describeTargets(slot)}</span>
            </button>
        </Reorder.Item>
    );
}
