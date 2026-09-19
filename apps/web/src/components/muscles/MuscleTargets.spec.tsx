// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MuscleTargets } from './MuscleTargets';
import { MuscleGroup } from '@/models/muscle';

describe('MuscleTargets', () => {
    it('splits what the movement is for from what it also works', async () => {
        const { container } = render(
            <MuscleTargets
                muscles={{
                    primaryMuscles: [MuscleGroup.Chest],
                    secondaryMuscles: [MuscleGroup.Triceps, MuscleGroup.FrontDelts],
                }}
            />,
        );
        const scope = within(container);

        expect(scope.getByText('Main')).toBeDefined();
        expect(scope.getByText('Also worked')).toBeDefined();
        expect(await scope.findByLabelText(/Front view/)).toBeDefined();
    });

    it('shows the map without being asked', async () => {
        const { container } = render(
            <MuscleTargets muscles={{ primaryMuscles: [MuscleGroup.Lats], secondaryMuscles: [] }} />,
        );

        expect(await within(container).findByLabelText(/Back view/)).toBeDefined();
        expect(within(container).queryByRole('button', { name: /map/i })).toBeNull();
    });

    it('offers to tag an untagged exercise the reader can edit', () => {
        const onEdit = vi.fn();
        render(<MuscleTargets muscles={{ primaryMuscles: [], secondaryMuscles: [] }} onEdit={onEdit} />);

        screen.getByRole('button', { name: 'Tag muscles' }).click();

        expect(onEdit).toHaveBeenCalledOnce();
    });

    it('stays out of the way on an untagged exercise nobody here can edit', () => {
        const { container } = render(<MuscleTargets muscles={{ primaryMuscles: [], secondaryMuscles: [] }} />);

        expect(container.innerHTML).toBe('');
    });

    it('never counts a muscle as both main and also worked', async () => {
        const { container } = render(
            <MuscleTargets muscles={{ primaryMuscles: [MuscleGroup.Lats], secondaryMuscles: [MuscleGroup.Lats] }} />,
        );

        await within(container).findByLabelText(/Front view/);
        expect(within(container).getAllByText('Lats')).toHaveLength(1);
        expect(within(container).queryByText('Also worked')).toBeNull();
    });
});
