import { MuscleGroup } from '@/models/muscle';

/** A piece of the drawing. Ellipses and rounded rectangles keep the figure readable at phone size. */
export type BodyShape =
    | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
    | { kind: 'rect'; x: number; y: number; width: number; height: number; radius: number }
    | { kind: 'path'; d: string };

/** One muscle's outline in a view, drawn over the figure beneath it. */
export type MuscleShape = { muscle: MuscleGroup; shapes: BodyShape[] };

/** Both views share this drawing box, so front and back line up side by side. */
export const BODY_VIEW_BOX = '0 0 100 215';

/**
 * The plain figure both views are drawn on: head, limbs and trunk, with no muscle detail. Left and
 * right are mirrored about x = 50, which is what lets every muscle below be written once per side.
 */
export const BODY_SILHOUETTE: BodyShape[] = [
    { kind: 'ellipse', cx: 50, cy: 16, rx: 10.5, ry: 12 },
    { kind: 'rect', x: 45, y: 25, width: 10, height: 10, radius: 3 },
    { kind: 'path', d: 'M33 33 H67 L74 49 L64 78 L62 106 H38 L36 78 L26 49 Z' },
    { kind: 'ellipse', cx: 24, cy: 58, rx: 6.5, ry: 16 },
    { kind: 'ellipse', cx: 76, cy: 58, rx: 6.5, ry: 16 },
    { kind: 'ellipse', cx: 18, cy: 88, rx: 5.5, ry: 16 },
    { kind: 'ellipse', cx: 82, cy: 88, rx: 5.5, ry: 16 },
    { kind: 'ellipse', cx: 15, cy: 107, rx: 4, ry: 5.5 },
    { kind: 'ellipse', cx: 85, cy: 107, rx: 4, ry: 5.5 },
    { kind: 'path', d: 'M38 103 H62 L60 121 H40 Z' },
    { kind: 'ellipse', cx: 43, cy: 133, rx: 10, ry: 26 },
    { kind: 'ellipse', cx: 57, cy: 133, rx: 10, ry: 26 },
    { kind: 'ellipse', cx: 42, cy: 178, rx: 7, ry: 24 },
    { kind: 'ellipse', cx: 58, cy: 178, rx: 7, ry: 24 },
    { kind: 'ellipse', cx: 41, cy: 204, rx: 6, ry: 4 },
    { kind: 'ellipse', cx: 59, cy: 204, rx: 6, ry: 4 },
];

/** What the front of the body shows. */
export const FRONT_MUSCLES: MuscleShape[] = [
    {
        muscle: MuscleGroup.Traps,
        shapes: [
            { kind: 'path', d: 'M45 31 L36 36 L34 42 L45 38 Z' },
            { kind: 'path', d: 'M55 31 L64 36 L66 42 L55 38 Z' },
        ],
    },
    {
        muscle: MuscleGroup.FrontDelts,
        shapes: [
            { kind: 'ellipse', cx: 33, cy: 42, rx: 8, ry: 8 },
            { kind: 'ellipse', cx: 67, cy: 42, rx: 8, ry: 8 },
        ],
    },
    {
        muscle: MuscleGroup.SideDelts,
        shapes: [
            { kind: 'ellipse', cx: 27, cy: 46, rx: 6, ry: 9 },
            { kind: 'ellipse', cx: 73, cy: 46, rx: 6, ry: 9 },
        ],
    },
    {
        muscle: MuscleGroup.Chest,
        shapes: [
            { kind: 'ellipse', cx: 41.5, cy: 53, rx: 9.5, ry: 8 },
            { kind: 'ellipse', cx: 58.5, cy: 53, rx: 9.5, ry: 8 },
        ],
    },
    {
        muscle: MuscleGroup.Biceps,
        shapes: [
            { kind: 'ellipse', cx: 24, cy: 60, rx: 5.5, ry: 12 },
            { kind: 'ellipse', cx: 76, cy: 60, rx: 5.5, ry: 12 },
        ],
    },
    {
        muscle: MuscleGroup.Forearms,
        shapes: [
            { kind: 'ellipse', cx: 18, cy: 88, rx: 4.5, ry: 14 },
            { kind: 'ellipse', cx: 82, cy: 88, rx: 4.5, ry: 14 },
        ],
    },
    { muscle: MuscleGroup.Abs, shapes: [{ kind: 'rect', x: 43, y: 63, width: 14, height: 37, radius: 6 }] },
    {
        muscle: MuscleGroup.Obliques,
        shapes: [
            { kind: 'ellipse', cx: 38, cy: 80, rx: 4, ry: 13 },
            { kind: 'ellipse', cx: 62, cy: 80, rx: 4, ry: 13 },
        ],
    },
    {
        muscle: MuscleGroup.Abductors,
        shapes: [
            { kind: 'ellipse', cx: 35.5, cy: 114, rx: 5, ry: 9 },
            { kind: 'ellipse', cx: 64.5, cy: 114, rx: 5, ry: 9 },
        ],
    },
    {
        muscle: MuscleGroup.Quads,
        shapes: [
            { kind: 'ellipse', cx: 41, cy: 131, rx: 7.5, ry: 21 },
            { kind: 'ellipse', cx: 59, cy: 131, rx: 7.5, ry: 21 },
        ],
    },
    {
        muscle: MuscleGroup.Adductors,
        shapes: [
            { kind: 'ellipse', cx: 47.5, cy: 129, rx: 3.5, ry: 16 },
            { kind: 'ellipse', cx: 52.5, cy: 129, rx: 3.5, ry: 16 },
        ],
    },
];

/** What the back of the body shows. */
export const BACK_MUSCLES: MuscleShape[] = [
    { muscle: MuscleGroup.Traps, shapes: [{ kind: 'path', d: 'M50 30 L64 42 L58 64 L42 64 L36 42 Z' }] },
    {
        muscle: MuscleGroup.RearDelts,
        shapes: [
            { kind: 'ellipse', cx: 30, cy: 44, rx: 7, ry: 8 },
            { kind: 'ellipse', cx: 70, cy: 44, rx: 7, ry: 8 },
        ],
    },
    {
        muscle: MuscleGroup.Lats,
        shapes: [
            { kind: 'path', d: 'M38 58 C29 64 28 82 36 96 L46 96 L46 60 Z' },
            { kind: 'path', d: 'M62 58 C71 64 72 82 64 96 L54 96 L54 60 Z' },
        ],
    },
    {
        muscle: MuscleGroup.UpperBack,
        shapes: [
            { kind: 'ellipse', cx: 42, cy: 52, rx: 6, ry: 7 },
            { kind: 'ellipse', cx: 58, cy: 52, rx: 6, ry: 7 },
        ],
    },
    {
        muscle: MuscleGroup.Triceps,
        shapes: [
            { kind: 'ellipse', cx: 24, cy: 60, rx: 5.5, ry: 12 },
            { kind: 'ellipse', cx: 76, cy: 60, rx: 5.5, ry: 12 },
        ],
    },
    {
        muscle: MuscleGroup.Forearms,
        shapes: [
            { kind: 'ellipse', cx: 18, cy: 88, rx: 4.5, ry: 14 },
            { kind: 'ellipse', cx: 82, cy: 88, rx: 4.5, ry: 14 },
        ],
    },
    { muscle: MuscleGroup.LowerBack, shapes: [{ kind: 'rect', x: 42, y: 92, width: 16, height: 13, radius: 5 }] },
    {
        muscle: MuscleGroup.Glutes,
        shapes: [
            { kind: 'ellipse', cx: 43, cy: 115, rx: 9, ry: 9.5 },
            { kind: 'ellipse', cx: 57, cy: 115, rx: 9, ry: 9.5 },
        ],
    },
    {
        muscle: MuscleGroup.Hamstrings,
        shapes: [
            { kind: 'ellipse', cx: 43, cy: 142, rx: 8, ry: 21 },
            { kind: 'ellipse', cx: 57, cy: 142, rx: 8, ry: 21 },
        ],
    },
    {
        muscle: MuscleGroup.Calves,
        shapes: [
            { kind: 'ellipse', cx: 42, cy: 176, rx: 6.5, ry: 17 },
            { kind: 'ellipse', cx: 58, cy: 176, rx: 6.5, ry: 17 },
        ],
    },
];
