// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BodyDiagram } from './BodyDiagram';
import { MuscleGroup } from '@/models/muscle';

/** The first path of a named shape, as a pointer would land on it. */
function shape({ container, slug }: { container: HTMLElement; slug: string }): Element {
    const path = container.querySelector(`[data-part="${slug}"] path`);
    if (path === null) throw new Error(`no shape drawn for ${slug}`);

    return path;
}

describe('BodyDiagram', () => {
    it('names the muscle under the pointer, and stops naming it on the way out', () => {
        const { container } = render(<BodyDiagram shades={{ [MuscleGroup.Chest]: 1 }} />);
        const figure = container.querySelector('svg') as SVGSVGElement;

        fireEvent.pointerMove(shape({ container, slug: 'chest' }));
        expect(within(container).getByText('Chest')).toBeDefined();

        fireEvent.pointerLeave(figure);
        expect(within(container).queryByText('Chest')).toBeNull();
    });

    it('names every muscle sharing a shape', () => {
        const { container } = render(<BodyDiagram shades={{}} />);

        fireEvent.pointerMove(shape({ container, slug: 'deltoids' }));

        expect(within(container).getByText('Front delts / Side delts / Rear delts')).toBeDefined();
    });

    it('lets the caller say what a shape is worth', () => {
        const { container } = render(
            <BodyDiagram
                shades={{ [MuscleGroup.Quads]: 1 }}
                labelForPart={(muscles) => `${muscles.length} muscle here`}
            />,
        );

        fireEvent.pointerMove(shape({ container, slug: 'quadriceps' }));

        expect(within(container).getByText('1 muscle here')).toBeDefined();
    });

    it('says nothing about the parts that are only scenery', () => {
        const { container } = render(<BodyDiagram shades={{}} />);

        fireEvent.pointerMove(shape({ container, slug: 'head' }));

        expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it('answers a tap, so the name is reachable without a mouse', () => {
        const { container } = render(<BodyDiagram shades={{}} />);

        fireEvent.pointerDown(shape({ container, slug: 'gluteal' }));

        expect(within(container).getByText('Glutes')).toBeDefined();
    });
});
