import type { EquipmentPreset } from '@/models/equipment';

const STORAGE_KEY = 'active-equipment-preset';

/** The preset id this device filters by, or null for all equipment. */
export function readActiveEquipmentPresetId(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

/** Remembers the device's active preset; null turns the filter off. */
export function writeActiveEquipmentPresetId(id: string | null): void {
    try {
        if (id === null) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, id);
    } catch {
        // A device that cannot remember the choice can still use the current page.
    }
}

/** The stored preset if it still exists; a deleted or foreign id means no filter. */
export function resolveActivePreset({
    storedId,
    presets,
}: {
    storedId: string | null;
    presets: EquipmentPreset[];
}): EquipmentPreset | null {
    if (storedId === null) return null;

    return presets.find((preset) => preset.id === storedId) ?? null;
}
