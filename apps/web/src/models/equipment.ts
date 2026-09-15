import {
    Anchor,
    Armchair,
    Bike,
    Cable,
    CircleDot,
    Dumbbell,
    Footprints,
    Grip,
    Landmark,
    Minus,
    Ship,
    Weight,
    type LucideIcon,
} from 'lucide-react';
import { Equipment, OnboardingStage } from '@app/domain';

export { Equipment, OnboardingStage };

/** Display order for tile grids: free weights, then stations, then cardio. */
export const EQUIPMENT_ORDER: Equipment[] = [
    Equipment.Barbell,
    Equipment.Dumbbell,
    Equipment.Kettlebell,
    Equipment.SquatRack,
    Equipment.Bench,
    Equipment.PullUpBar,
    Equipment.Cable,
    Equipment.Machine,
    Equipment.ResistanceBand,
    Equipment.Treadmill,
    Equipment.StationaryBike,
    Equipment.RowingMachine,
];

/** Label and icon per equipment value. */
export const EQUIPMENT_META: Record<Equipment, { label: string; icon: LucideIcon }> = {
    [Equipment.Barbell]: { label: 'Barbell', icon: Minus },
    [Equipment.Dumbbell]: { label: 'Dumbbells', icon: Dumbbell },
    [Equipment.Kettlebell]: { label: 'Kettlebell', icon: Weight },
    [Equipment.Cable]: { label: 'Cable machine', icon: Cable },
    [Equipment.Machine]: { label: 'Weight machines', icon: Landmark },
    [Equipment.SquatRack]: { label: 'Squat rack', icon: Grip },
    [Equipment.Bench]: { label: 'Bench', icon: Armchair },
    [Equipment.PullUpBar]: { label: 'Pull-up bar', icon: Anchor },
    [Equipment.ResistanceBand]: { label: 'Resistance bands', icon: CircleDot },
    [Equipment.Treadmill]: { label: 'Treadmill', icon: Footprints },
    [Equipment.StationaryBike]: { label: 'Stationary bike', icon: Bike },
    [Equipment.RowingMachine]: { label: 'Rowing machine', icon: Ship },
};

/** A named set of equipment the library can be filtered by. */
export type EquipmentPreset = {
    id: string;
    name: string;
    equipment: Equipment[];
    createdAt: string;
    updatedAt: string;
};

export type SaveEquipmentPresetRequest = { name: string; equipment: Equipment[] };
export type PatchEquipmentPresetRequest = { name?: string; equipment?: Equipment[] };

/** Returns a compact, human-readable summary of a preset's equipment. */
export function summarizeEquipment(equipment: Equipment[]): string {
    if (equipment.length === 0) return 'Bodyweight only';

    const ordered = EQUIPMENT_ORDER.filter((value) => equipment.includes(value));
    const shown = ordered.slice(0, 2).map((value) => EQUIPMENT_META[value].label);
    const rest = ordered.length - shown.length;

    return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}
