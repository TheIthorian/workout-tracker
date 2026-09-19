import { MuscleGroup } from '@/models/muscle';

/**
 * Which shapes on the body map each muscle lights up, by the artwork's own part slugs.
 *
 * The drawing is less specific than the vocabulary in a few places, and the mapping absorbs that
 * rather than the domain model giving ground: the three deltoid heads share one shoulder shape, and
 * the lats share the back's big wing with the rest of the upper back. Where several muscles share a
 * shape the hottest of them wins, so a shared shape is never cooler than the work done on it.
 *
 * `Abductors` has no shape at all — the artwork does not separate the outer hip. It still appears
 * in the ranked list beside the map, which is where the numbers live.
 */
export const MUSCLE_BODY_PARTS: Record<MuscleGroup, string[]> = {
    [MuscleGroup.Chest]: ['chest'],
    [MuscleGroup.FrontDelts]: ['deltoids'],
    [MuscleGroup.SideDelts]: ['deltoids'],
    [MuscleGroup.RearDelts]: ['deltoids'],
    [MuscleGroup.Biceps]: ['biceps'],
    [MuscleGroup.Triceps]: ['triceps'],
    [MuscleGroup.Forearms]: ['forearm'],
    [MuscleGroup.Abs]: ['abs'],
    [MuscleGroup.Obliques]: ['obliques'],
    [MuscleGroup.Lats]: ['upper-back'],
    [MuscleGroup.UpperBack]: ['upper-back'],
    [MuscleGroup.Traps]: ['trapezius'],
    [MuscleGroup.LowerBack]: ['lower-back'],
    [MuscleGroup.Glutes]: ['gluteal'],
    [MuscleGroup.Quads]: ['quadriceps'],
    [MuscleGroup.Hamstrings]: ['hamstring'],
    [MuscleGroup.Calves]: ['calves'],
    [MuscleGroup.Adductors]: ['adductors'],
    [MuscleGroup.Abductors]: [],
};

/**
 * Parts that are drawn but never shaded: the body they hang off, plus the muscles this app has no
 * vocabulary for. Shading those as "untrained" would read as neglect rather than as silence.
 */
export const INERT_BODY_PARTS: ReadonlySet<string> = new Set([
    'head',
    'hair',
    'neck',
    'hands',
    'feet',
    'knees',
    'ankles',
    'tibialis',
]);

/** The muscles that share one shape on the map, in the vocabulary's own order. */
export function musclesOfBodyPart(slug: string): MuscleGroup[] {
    return MUSCLE_ORDERED.filter((muscle) => MUSCLE_BODY_PARTS[muscle].includes(slug));
}

const MUSCLE_ORDERED = Object.values(MuscleGroup);
