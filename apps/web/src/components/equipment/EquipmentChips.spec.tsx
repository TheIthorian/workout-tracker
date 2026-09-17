// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EquipmentChips } from './EquipmentChips';
import { Equipment } from '@/models/equipment';

describe('EquipmentChips', () => {
    it('renders the equipment in the library display order', () => {
        render(<EquipmentChips equipment={[Equipment.Bench, Equipment.Barbell]} />);

        expect(screen.getAllByText(/barbell|bench/i).map((node) => node.textContent)).toEqual(['Barbell', 'Bench']);
    });

    it('calls an empty set bodyweight', () => {
        render(<EquipmentChips equipment={[]} />);

        expect(screen.getByText('Bodyweight')).toBeDefined();
    });

    it('renders nothing when the server did not send the field', () => {
        const { container } = render(<EquipmentChips equipment={undefined} />);

        expect(container.innerHTML).toBe('');
    });
});
