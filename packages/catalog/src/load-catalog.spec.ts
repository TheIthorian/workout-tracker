import { join } from 'node:path';
import { TrackingType } from '@app/domain';
import { InvalidFormatError } from '@app/errors';
import { describe, expect, it } from 'vitest';
import { exerciseEntrySchema } from './exercise-entry.js';
import { loadCatalog } from './load-catalog.js';

const fixtures = join(__dirname, '..', 'fixtures');

describe('loadCatalog', () => {
    it('loads every entry, sorted by slug, resolving image paths and content types', async () => {
        const loaded = await loadCatalog({ dir: join(fixtures, 'valid') });

        expect(loaded.map((entry) => entry.slug)).toEqual(['barbell-back-squat', 'plank']);

        const squat = loaded[0];
        expect(squat.entry).toMatchObject({
            name: 'Barbell back squat',
            trackingType: TrackingType.WeightReps,
            guide: { setup: expect.stringContaining('Bar on the upper back') },
            links: [{ url: 'https://example.com/squat', label: 'Form video' }],
        });
        expect(squat.images).toEqual([
            {
                file: '01-setup.png',
                caption: 'Bar position',
                path: join(fixtures, 'valid', 'barbell-back-squat', 'images', '01-setup.png'),
                contentType: 'image/png',
            },
        ]);

        const plank = loaded[1];
        expect(plank.entry.guide).toEqual({
            setup: 'Forearms down, elbows under shoulders.',
            execution: null,
            cues: null,
            mistakes: null,
        });
        expect(plank.images).toEqual([]);
    });

    it('rejects an unknown tracking type, naming the slug', async () => {
        await expect(loadCatalog({ dir: join(fixtures, 'bad-tracking-type') })).rejects.toThrow(InvalidFormatError);
        await expect(loadCatalog({ dir: join(fixtures, 'bad-tracking-type') })).rejects.toThrow(/wobble/);
    });

    it('rejects an image the file references but the directory lacks', async () => {
        await expect(loadCatalog({ dir: join(fixtures, 'missing-image') })).rejects.toThrow(/nope\.png/);
    });

    it('rejects a directory name that is not a slug', async () => {
        await expect(loadCatalog({ dir: join(fixtures, 'bad-slug') })).rejects.toThrow(/Not_A_Slug/);
    });

    it('rejects a directory that does not exist', async () => {
        await expect(loadCatalog({ dir: join(fixtures, 'nowhere') })).rejects.toThrow(InvalidFormatError);
    });

    it('defaults equipment to none and rejects an unknown value', () => {
        expect(exerciseEntrySchema.parse({ name: 'Plank', trackingType: 'duration' }).equipment).toEqual([]);
        expect(
            exerciseEntrySchema.safeParse({ name: 'X', trackingType: 'duration', equipment: ['laser'] }).success,
        ).toBe(false);
    });
});
