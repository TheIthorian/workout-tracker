import { MuscleGroup } from '@app/domain';

export { MuscleGroup };

/** Which muscles an exercise works, and how hard. */
export type MuscleEngagementValue = {
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
};

/** Broad areas of the body, used to group the tag picker into scannable sections. */
export enum BodyRegion {
    Chest = 'chest',
    Back = 'back',
    Shoulders = 'shoulders',
    Arms = 'arms',
    Core = 'core',
    Legs = 'legs',
}

export const BODY_REGION_LABEL: Record<BodyRegion, string> = {
    [BodyRegion.Chest]: 'Chest',
    [BodyRegion.Back]: 'Back',
    [BodyRegion.Shoulders]: 'Shoulders',
    [BodyRegion.Arms]: 'Arms',
    [BodyRegion.Core]: 'Core',
    [BodyRegion.Legs]: 'Legs',
};

/** Short label per muscle, used on badges, the picker, and the diagram's legend. */
export const MUSCLE_META: Record<MuscleGroup, { label: string; region: BodyRegion }> = {
    [MuscleGroup.Chest]: { label: 'Chest', region: BodyRegion.Chest },
    [MuscleGroup.Lats]: { label: 'Lats', region: BodyRegion.Back },
    [MuscleGroup.UpperBack]: { label: 'Upper back', region: BodyRegion.Back },
    [MuscleGroup.Traps]: { label: 'Traps', region: BodyRegion.Back },
    [MuscleGroup.LowerBack]: { label: 'Lower back', region: BodyRegion.Back },
    [MuscleGroup.FrontDelts]: { label: 'Front delts', region: BodyRegion.Shoulders },
    [MuscleGroup.SideDelts]: { label: 'Side delts', region: BodyRegion.Shoulders },
    [MuscleGroup.RearDelts]: { label: 'Rear delts', region: BodyRegion.Shoulders },
    [MuscleGroup.Biceps]: { label: 'Biceps', region: BodyRegion.Arms },
    [MuscleGroup.Triceps]: { label: 'Triceps', region: BodyRegion.Arms },
    [MuscleGroup.Forearms]: { label: 'Forearms', region: BodyRegion.Arms },
    [MuscleGroup.Abs]: { label: 'Abs', region: BodyRegion.Core },
    [MuscleGroup.Obliques]: { label: 'Obliques', region: BodyRegion.Core },
    [MuscleGroup.Glutes]: { label: 'Glutes', region: BodyRegion.Legs },
    [MuscleGroup.Quads]: { label: 'Quads', region: BodyRegion.Legs },
    [MuscleGroup.Hamstrings]: { label: 'Hamstrings', region: BodyRegion.Legs },
    [MuscleGroup.Calves]: { label: 'Calves', region: BodyRegion.Legs },
    [MuscleGroup.Adductors]: { label: 'Inner thigh', region: BodyRegion.Legs },
    [MuscleGroup.Abductors]: { label: 'Outer hip', region: BodyRegion.Legs },
};

/** Display order for badges and pickers: head to toe, so a list reads down the body. */
export const MUSCLE_ORDER: MuscleGroup[] = [
    MuscleGroup.Chest,
    MuscleGroup.FrontDelts,
    MuscleGroup.SideDelts,
    MuscleGroup.RearDelts,
    MuscleGroup.Traps,
    MuscleGroup.UpperBack,
    MuscleGroup.Lats,
    MuscleGroup.LowerBack,
    MuscleGroup.Biceps,
    MuscleGroup.Triceps,
    MuscleGroup.Forearms,
    MuscleGroup.Abs,
    MuscleGroup.Obliques,
    MuscleGroup.Glutes,
    MuscleGroup.Quads,
    MuscleGroup.Hamstrings,
    MuscleGroup.Adductors,
    MuscleGroup.Abductors,
    MuscleGroup.Calves,
];

/** The picker's sections, each already in display order. */
export const MUSCLE_REGIONS: { region: BodyRegion; muscles: MuscleGroup[] }[] = Object.values(BodyRegion).map(
    (region) => ({ region, muscles: MUSCLE_ORDER.filter((muscle) => MUSCLE_META[muscle].region === region) }),
);

/** Sorts a muscle list head to toe, so two exercises tagging the same muscles read the same. */
export function orderMuscles(muscles: MuscleGroup[]): MuscleGroup[] {
    return MUSCLE_ORDER.filter((muscle) => muscles.includes(muscle));
}

/** A short "Chest, triceps +1" line for a library row, where a badge per muscle would not fit. */
export function summarizeMuscles({ muscles, max = 2 }: { muscles: MuscleGroup[]; max?: number }): string {
    const ordered = orderMuscles(muscles);
    if (ordered.length === 0) return '';

    const shown = ordered.slice(0, max).map((muscle, index) => {
        const { label } = MUSCLE_META[muscle];
        return index === 0 ? label : label.toLowerCase();
    });

    return ordered.length > max ? `${shown.join(', ')} +${ordered.length - max}` : shown.join(', ');
}

/** One muscle's share of a period's training volume. */
export type MuscleVolumeEntry = {
    muscle: MuscleGroup;
    sets: number;
    weightedSets: number;
    /** `weightedSets` as a share of the hardest-worked muscle's, 0 to 1 — what shades the diagram. */
    intensity: number;
};

/** One exercise's contribution to the period, for the list under the heatmap. */
export type MuscleVolumeExercise = {
    exerciseId: string;
    name: string;
    sets: number;
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
};

export type MuscleVolumeResponse = {
    days: number;
    since: string;
    sessionCount: number;
    totalSets: number;
    untaggedSets: number;
    muscles: MuscleVolumeEntry[];
    exercises: MuscleVolumeExercise[];
};
