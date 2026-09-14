import { Equipment, OnboardingStage } from '@app/domain';
import { describe, expect, it } from 'vitest';
import { patchEquipmentPresetRequestSchema, postEquipmentPresetRequestSchema } from './equipment-preset.contract.js';
import { patchOnboardingRequestSchema } from './onboarding.contract.js';

describe('equipment preset contracts', () => {
    it('trims the name, defaults equipment, and rejects an empty name', () => {
        expect(postEquipmentPresetRequestSchema.parse({ name: '  Home ' })).toEqual({ name: 'Home', equipment: [] });
        expect(postEquipmentPresetRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
        expect(postEquipmentPresetRequestSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
    });

    it('rejects repeated or unknown equipment', () => {
        expect(
            postEquipmentPresetRequestSchema.safeParse({
                name: 'Gym',
                equipment: [Equipment.Barbell, Equipment.Barbell],
            }).success,
        ).toBe(false);
        expect(postEquipmentPresetRequestSchema.safeParse({ name: 'Gym', equipment: ['hammer'] }).success).toBe(false);
    });

    it('requires at least one field on patch', () => {
        expect(patchEquipmentPresetRequestSchema.safeParse({}).success).toBe(false);
        expect(patchEquipmentPresetRequestSchema.safeParse({ equipment: [] }).success).toBe(true);
    });
});

describe('onboarding contract', () => {
    it('accepts a known stage only', () => {
        expect(patchOnboardingRequestSchema.parse({ stage: 'complete' }).stage).toBe(OnboardingStage.Complete);
        expect(patchOnboardingRequestSchema.safeParse({ stage: 'done' }).success).toBe(false);
    });
});
