import { useCallback, useState } from 'react';
import {
    useMutation,
    useQuery,
    useQueryClient,
    type UseMutationResult,
    type UseQueryResult,
} from '@tanstack/react-query';
import {
    readActiveEquipmentPresetId,
    resolveActivePreset,
    writeActiveEquipmentPresetId,
} from '@/lib/active-equipment-preset';
import { equipmentPresetsApi } from '@/lib/api';
import type { EquipmentPreset, PatchEquipmentPresetRequest, SaveEquipmentPresetRequest } from '@/models/equipment';

const presetsKey = (workspaceId: string): [string, string] => ['equipment-presets', workspaceId];

/** Every preset in the workspace, by name. */
export function useEquipmentPresets({
    workspaceId,
}: {
    workspaceId: string;
}): UseQueryResult<EquipmentPreset[], Error> {
    return useQuery({
        queryKey: presetsKey(workspaceId),
        queryFn: () => equipmentPresetsApi.list(workspaceId),
        enabled: Boolean(workspaceId),
    });
}

/** Resolves this device's stored choice against the workspace's current presets. */
export function useActiveEquipmentPreset({ workspaceId }: { workspaceId: string }): {
    preset: EquipmentPreset | null;
    presets: EquipmentPreset[];
    isLoading: boolean;
    setActive: (id: string | null) => void;
} {
    const { data, isLoading } = useEquipmentPresets({ workspaceId });
    const [storedId, setStoredId] = useState(readActiveEquipmentPresetId);
    const presets = data ?? [];

    const setActive = useCallback((id: string | null): void => {
        writeActiveEquipmentPresetId(id);
        setStoredId(id);
    }, []);

    return { preset: resolveActivePreset({ storedId, presets }), presets, isLoading, setActive };
}

/** Creates a preset and refreshes the list. */
export function useCreateEquipmentPreset({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<EquipmentPreset, Error, SaveEquipmentPresetRequest> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: SaveEquipmentPresetRequest) => equipmentPresetsApi.create(workspaceId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: presetsKey(workspaceId) });
        },
    });
}

/** Updates a preset and refreshes the list. */
export function useUpdateEquipmentPreset({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<EquipmentPreset, Error, { presetId: string; data: PatchEquipmentPresetRequest }> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ presetId, data }) => equipmentPresetsApi.update({ workspaceId, presetId, data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: presetsKey(workspaceId) });
        },
    });
}

/** Deletes a preset, clears it when active on this device, and refreshes the list. */
export function useDeleteEquipmentPreset({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<void, Error, string> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (presetId: string) => equipmentPresetsApi.remove({ workspaceId, presetId }),
        onSuccess: (_result, presetId) => {
            if (readActiveEquipmentPresetId() === presetId) writeActiveEquipmentPresetId(null);
            queryClient.invalidateQueries({ queryKey: presetsKey(workspaceId) });
        },
    });
}
