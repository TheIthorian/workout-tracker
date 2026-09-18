/**
 * The closed set of muscles an exercise can target. Chosen to match what a body diagram can show
 * as a distinct region, so every value has somewhere to light up.
 */
export enum MuscleGroup {
    Chest = 'chest',
    FrontDelts = 'front_delts',
    SideDelts = 'side_delts',
    RearDelts = 'rear_delts',
    Biceps = 'biceps',
    Triceps = 'triceps',
    Forearms = 'forearms',
    Abs = 'abs',
    Obliques = 'obliques',
    Lats = 'lats',
    UpperBack = 'upper_back',
    Traps = 'traps',
    LowerBack = 'lower_back',
    Glutes = 'glutes',
    Quads = 'quads',
    Hamstrings = 'hamstrings',
    Calves = 'calves',
    Adductors = 'adductors',
    Abductors = 'abductors',
}

/** How hard an exercise works a muscle: the movers, or what assists and stabilises. */
export enum MuscleEngagement {
    Primary = 'primary',
    Secondary = 'secondary',
}

/**
 * What one set counts for against a muscle, by engagement. A secondary muscle takes half a set's
 * credit: it shares in the work without being what the set was for, and counting it in full would
 * make every compound lift read as a session for its assisting muscles too.
 */
export const MUSCLE_ENGAGEMENT_WEIGHT: Record<MuscleEngagement, number> = {
    [MuscleEngagement.Primary]: 1,
    [MuscleEngagement.Secondary]: 0.5,
};

/** One exercise's appearance in history: the muscles it tags, and how many sets were recorded. */
export type MuscleVolumeContribution = {
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
    sets: number;
};

/** What a muscle accumulated over the period being summarised. */
export type MuscleVolumeTotal = {
    muscle: MuscleGroup;
    /** Sets whose exercise names this muscle at all, primary or secondary. */
    sets: number;
    /** Sets weighted by engagement — what the heatmap shades by. */
    weightedSets: number;
    /** `weightedSets` as a share of the hardest-worked muscle's, 0 to 1. */
    intensity: number;
};

/**
 * Totals sets per muscle across a period's exercise appearances, weighted by engagement.
 *
 * Muscles nothing worked are omitted rather than returned as zero: the caller renders every muscle
 * anyway and an absent entry and a zero one mean the same thing to it.
 *
 * @returns one entry per worked muscle, hardest-worked first, then by muscle for a stable order.
 */
export function summariseMuscleVolume({
    contributions,
}: {
    contributions: MuscleVolumeContribution[];
}): MuscleVolumeTotal[] {
    const totals = new Map<MuscleGroup, { sets: number; weightedSets: number }>();

    for (const contribution of contributions) {
        addEngagement({ totals, contribution, engagement: MuscleEngagement.Primary });
        addEngagement({ totals, contribution, engagement: MuscleEngagement.Secondary });
    }

    const peak = Math.max(0, ...[...totals.values()].map((total) => total.weightedSets));

    return [...totals.entries()]
        .map(([muscle, total]) => ({
            muscle,
            sets: total.sets,
            weightedSets: total.weightedSets,
            intensity: peak === 0 ? 0 : total.weightedSets / peak,
        }))
        .sort((a, b) => b.weightedSets - a.weightedSets || a.muscle.localeCompare(b.muscle));
}

/**
 * Credits one contribution's sets to each muscle at the given engagement.
 *
 * A muscle listed as both primary and secondary on the same exercise is counted once, at primary:
 * the tag set is a data-entry slip rather than twice the work.
 */
function addEngagement({
    totals,
    contribution,
    engagement,
}: {
    totals: Map<MuscleGroup, { sets: number; weightedSets: number }>;
    contribution: MuscleVolumeContribution;
    engagement: MuscleEngagement;
}): void {
    const muscles =
        engagement === MuscleEngagement.Primary
            ? contribution.primaryMuscles
            : contribution.secondaryMuscles.filter((muscle) => !contribution.primaryMuscles.includes(muscle));

    for (const muscle of new Set(muscles)) {
        const current = totals.get(muscle) ?? { sets: 0, weightedSets: 0 };

        totals.set(muscle, {
            sets: current.sets + contribution.sets,
            weightedSets: current.weightedSets + contribution.sets * MUSCLE_ENGAGEMENT_WEIGHT[engagement],
        });
    }
}
