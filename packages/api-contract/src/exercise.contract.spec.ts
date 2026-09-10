import { TrackingType } from '@app/domain';
import { describe, expect, it } from 'vitest';
import {
    patchExerciseRequestSchema,
    postExerciseLinkRequestSchema,
    postExerciseRequestSchema,
} from './exercise.contract.js';

describe('postExerciseRequestSchema', () => {
    it('accepts a name and a tracking type', () => {
        const parsed = postExerciseRequestSchema.parse({ name: 'Bench Press', trackingType: 'weight_reps' });

        expect(parsed.trackingType).toBe(TrackingType.WeightReps);
    });

    it('rejects an unknown tracking type', () => {
        expect(() => postExerciseRequestSchema.parse({ name: 'Bench Press', trackingType: 'vibes' })).toThrow();
    });

    it('rejects an empty name', () => {
        expect(() => postExerciseRequestSchema.parse({ name: '', trackingType: 'duration' })).toThrow();
    });

    it('accepts the guide fields', () => {
        const parsed = postExerciseRequestSchema.parse({
            name: 'Plank',
            trackingType: 'duration',
            guideSetup: 'Forearms under shoulders.',
            guideCues: 'Ribs down, glutes on.',
        });

        expect(parsed.guideSetup).toBe('Forearms under shoulders.');
    });
});

describe('patchExerciseRequestSchema', () => {
    it('rejects an empty body', () => {
        expect(() => patchExerciseRequestSchema.parse({})).toThrow();
    });

    it('accepts a single field', () => {
        expect(patchExerciseRequestSchema.parse({ guideCues: 'Elbows at 45 degrees.' })).toMatchObject({
            guideCues: 'Elbows at 45 degrees.',
        });
    });
});

describe('postExerciseLinkRequestSchema', () => {
    it('accepts an https url with a label', () => {
        expect(
            postExerciseLinkRequestSchema.parse({ url: 'https://example.com/bench', label: 'Form check' }),
        ).toMatchObject({ url: 'https://example.com/bench' });
    });

    it('rejects a non-url', () => {
        expect(() => postExerciseLinkRequestSchema.parse({ url: 'not a url' })).toThrow();
    });
});
