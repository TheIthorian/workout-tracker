// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MuscleTagPicker } from './MuscleTagPicker';
import { MuscleGroup, type MuscleEngagementValue } from '@/models/muscle';

function Harness({ onChange }: { onChange: (next: MuscleEngagementValue) => void }): JSX.Element {
    const [value, setValue] = useState<MuscleEngagementValue>({ primaryMuscles: [], secondaryMuscles: [] });

    return (
        <MuscleTagPicker
            value={value}
            onChange={(next) => {
                setValue(next);
                onChange(next);
            }}
        />
    );
}

describe('MuscleTagPicker', () => {
    it('cycles a muscle from untagged to primary to secondary and back', () => {
        const seen: MuscleEngagementValue[] = [];
        const { container } = render(<Harness onChange={(next) => seen.push(next)} />);
        const chest = within(container).getByRole('button', { name: /^Chest/ });

        fireEvent.click(chest);
        fireEvent.click(chest);
        fireEvent.click(chest);

        expect(seen).toEqual([
            { primaryMuscles: [MuscleGroup.Chest], secondaryMuscles: [] },
            { primaryMuscles: [], secondaryMuscles: [MuscleGroup.Chest] },
            { primaryMuscles: [], secondaryMuscles: [] },
        ]);
    });

    it('leaves other muscles alone while one is being cycled', () => {
        const seen: MuscleEngagementValue[] = [];
        const { container } = render(<Harness onChange={(next) => seen.push(next)} />);
        const picker = within(container);

        fireEvent.click(picker.getByRole('button', { name: /^Chest/ }));
        fireEvent.click(picker.getByRole('button', { name: /^Triceps/ }));
        fireEvent.click(picker.getByRole('button', { name: /^Triceps/ }));

        expect(seen.at(-1)).toEqual({
            primaryMuscles: [MuscleGroup.Chest],
            secondaryMuscles: [MuscleGroup.Triceps],
        });
    });
});
