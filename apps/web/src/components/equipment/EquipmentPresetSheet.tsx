import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { EquipmentTileGrid } from '@/components/equipment/EquipmentTileGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCreateEquipmentPreset, useUpdateEquipmentPreset } from '@/hooks/use-equipment-presets';
import { toast } from '@/hooks/use-toast';
import type { Equipment, EquipmentPreset } from '@/models/equipment';

type EquipmentPresetSheetProps = {
    workspaceId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preset: EquipmentPreset | null;
};

/** Creates or edits a named equipment preset. */
export function EquipmentPresetSheet({
    workspaceId,
    open,
    onOpenChange,
    preset,
}: EquipmentPresetSheetProps): JSX.Element {
    const [name, setName] = useState('');
    const [equipment, setEquipment] = useState<Equipment[]>([]);
    const create = useCreateEquipmentPreset({ workspaceId });
    const update = useUpdateEquipmentPreset({ workspaceId });

    useEffect(() => {
        if (!open) return;
        setName(preset?.name ?? '');
        setEquipment(preset?.equipment ?? []);
    }, [open, preset]);

    const isPending = create.isPending || update.isPending;

    const handleSubmit = (event: React.FormEvent): void => {
        event.preventDefault();
        const trimmed = name.trim();

        if (!trimmed || isPending) return;

        const onError = (error: Error): void => {
            toast({
                title:
                    isAxiosError(error) && error.response?.status === 409
                        ? 'You already have a preset with that name.'
                        : 'Couldn’t save the preset. Try again.',
            });
        };
        const onSuccess = (): void => {
            toast({ title: preset ? 'Preset updated' : 'Preset added' });
            onOpenChange(false);
        };

        if (preset) {
            update.mutate({ presetId: preset.id, data: { name: trimmed, equipment } }, { onSuccess, onError });
        } else {
            create.mutate({ name: trimmed, equipment }, { onSuccess, onError });
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                className="flex max-h-[90vh] flex-col rounded-t-2xl p-0 md:mx-auto md:max-w-2xl"
            >
                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <SheetHeader className="px-4 pt-4 text-left">
                        <SheetTitle>{preset ? 'Edit preset' : 'New preset'}</SheetTitle>
                        <SheetDescription>Tap everything available in this setup.</SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="preset-name">Name</Label>
                            <Input
                                id="preset-name"
                                value={name}
                                maxLength={60}
                                required
                                placeholder="e.g. Home"
                                onChange={(event) => setName(event.target.value)}
                                className="h-11"
                            />
                        </div>
                        <EquipmentTileGrid value={equipment} onChange={setEquipment} disabled={isPending} />
                    </div>
                    <SheetFooter className="border-t px-4 py-3">
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!name.trim() || isPending}>
                            {isPending ? 'Saving…' : preset ? 'Save changes' : 'Add preset'}
                        </Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
}
