import { describe, expect, it } from 'vitest';
import { BODY_VIEWS, type BodyViewName } from './body-paths';
import { INERT_BODY_PARTS, MUSCLE_BODY_PARTS, musclesOfBodyPart } from './muscle-body-parts';
import { MuscleGroup } from '@/models/muscle';

const drawnParts = new Set(
    (Object.keys(BODY_VIEWS) as BodyViewName[]).flatMap((view) => Object.keys(BODY_VIEWS[view].parts)),
);

describe('the map from muscles to body parts', () => {
    it('names a part that the artwork actually draws', () => {
        const unknown = Object.values(MUSCLE_BODY_PARTS)
            .flat()
            .filter((slug) => !drawnParts.has(slug));

        expect(unknown).toEqual([]);
    });

    it('leaves nothing drawn unaccounted for: every part is a muscle or deliberately inert', () => {
        const unaccounted = [...drawnParts].filter(
            (slug) => !INERT_BODY_PARTS.has(slug) && musclesOfBodyPart(slug).length === 0,
        );

        expect(unaccounted).toEqual([]);
    });

    it('never shades a part that is only scenery', () => {
        for (const slug of INERT_BODY_PARTS) expect(musclesOfBodyPart(slug)).toEqual([]);
    });

    it('draws every muscle the app can tag, bar the one the artwork cannot separate', () => {
        const unmapped = Object.values(MuscleGroup).filter((muscle) => MUSCLE_BODY_PARTS[muscle].length === 0);

        expect(unmapped).toEqual([MuscleGroup.Abductors]);
    });

    it('shares the shoulder between all three deltoid heads and the back wing with the lats', () => {
        expect(musclesOfBodyPart('deltoids')).toEqual([
            MuscleGroup.FrontDelts,
            MuscleGroup.SideDelts,
            MuscleGroup.RearDelts,
        ]);
        expect(musclesOfBodyPart('upper-back')).toEqual([MuscleGroup.Lats, MuscleGroup.UpperBack]);
    });
});
