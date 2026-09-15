import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { EquipmentPresetSheet } from '@/components/equipment/EquipmentPresetSheet';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDeleteEquipmentPreset, useEquipmentPresets } from '@/hooks/use-equipment-presets';
import { toast } from '@/hooks/use-toast';
import { summarizeEquipment, type EquipmentPreset } from '@/models/equipment';

/** Adds, edits, and deletes the current workspace's equipment presets. */
export function EquipmentSettings(): JSX.Element {
    const { workspaceId } = useWorkspace();
    const { data: presets, isLoading, isError, refetch } = useEquipmentPresets({ workspaceId });
    const remove = useDeleteEquipmentPreset({ workspaceId });
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editing, setEditing] = useState<EquipmentPreset | null>(null);
    const [deleting, setDeleting] = useState<EquipmentPreset | null>(null);

    const openCreate = (): void => {
        setEditing(null);
        setSheetOpen(true);
    };
    const openEdit = (preset: EquipmentPreset): void => {
        setEditing(preset);
        setSheetOpen(true);
    };
    const confirmDelete = (): void => {
        if (!deleting) return;
        remove.mutate(deleting.id, {
            onSuccess: () => toast({ title: 'Preset deleted' }),
            onError: () => toast({ title: 'Couldn’t delete the preset. Try again.' }),
            onSettled: () => setDeleting(null),
        });
    };

    return (
        <Card className="shadow-none">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                    <CardTitle className="text-xl">My equipment</CardTitle>
                    <CardDescription>
                        A preset for each place you train. Pick one on the library to hide exercises you can’t do.
                    </CardDescription>
                </div>
                <Button className="gap-2" onClick={openCreate}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Add preset
                </Button>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <LoadingState label="Loading presets…" />
                ) : isError ? (
                    <EmptyState
                        title="Presets couldn’t load"
                        description="Check your connection and try again."
                        actionLabel="Try again"
                        onAction={() => void refetch()}
                    />
                ) : presets && presets.length > 0 ? (
                    <ul className="divide-y">
                        {presets.map((preset) => (
                            <li key={preset.id} className="flex items-center gap-3 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">{preset.name}</p>
                                    <p className="truncate text-sm text-muted-foreground">
                                        {summarizeEquipment(preset.equipment)}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Edit ${preset.name}`}
                                    onClick={() => openEdit(preset)}
                                >
                                    <Pencil className="h-4 w-4" aria-hidden />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Delete ${preset.name}`}
                                    onClick={() => setDeleting(preset)}
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyState
                        title="No presets yet"
                        description="Add one for your gym, one for home — then switch between them on the library."
                        actionLabel="Add preset"
                        onAction={openCreate}
                    />
                )}
            </CardContent>
            <EquipmentPresetSheet
                workspaceId={workspaceId}
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                preset={editing}
            />
            <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                            If it’s the preset you’re filtering by, the library goes back to showing all equipment.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
                            {remove.isPending ? 'Deleting…' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
