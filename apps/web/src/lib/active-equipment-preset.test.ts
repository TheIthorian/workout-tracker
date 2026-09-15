// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { Equipment, type EquipmentPreset } from '@/models/equipment';
import {
    readActiveEquipmentPresetId,
    resolveActivePreset,
    writeActiveEquipmentPresetId,
} from './active-equipment-preset';

const preset = (id: string): EquipmentPreset => ({
    id,
    name: id,
    equipment: [Equipment.Barbell],
    createdAt: '',
    updatedAt: '',
});

describe('active equipment preset storage', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips an id and clears on null', () => {
        writeActiveEquipmentPresetId('abc');
        expect(readActiveEquipmentPresetId()).toBe('abc');
        writeActiveEquipmentPresetId(null);
        expect(readActiveEquipmentPresetId()).toBeNull();
    });

    it('resolves to the matching preset, or null when missing or stale', () => {
        const presets = [preset('a'), preset('b')];
        expect(resolveActivePreset({ storedId: 'b', presets })?.id).toBe('b');
        expect(resolveActivePreset({ storedId: null, presets })).toBeNull();
        expect(resolveActivePreset({ storedId: 'gone', presets })).toBeNull();
    });
});
