// Regenerates apps/web/src/components/muscles/body-paths.ts from a MuscleMap checkout.
//
//   node scripts/generate-body-paths.mjs /path/to/musclemap
//
// MuscleMap (https://github.com/melihcolpan/MuscleMap, MIT) ships its body geometry as Swift
// source rather than .svg files, so the artwork cannot be consumed directly. This reads the male
// front and back path tables and writes them out as a TypeScript module; see NOTICE.md.
//
// Sub-group shapes (upper-abs, lower-chest, outer-quad, front-deltoid …) are dropped: they overlap
// the whole-muscle shapes that already cover the same area, and nothing in this app resolves to a
// sub-region.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SUB_GROUP_SLUGS = new Set([
    'front-deltoid',
    'rear-deltoid',
    'hip-flexors',
    'inner-quad',
    'lower-abs',
    'lower-chest',
    'outer-quad',
    'rhomboids',
    'rotator-cuff',
    'serratus',
    'upper-abs',
    'upper-chest',
    'upper-trapezius',
    'lower-trapezius',
]);

const VIEWS = [
    { name: 'front', file: 'MaleFrontPaths.swift', viewBox: '0 95 727 1280' },
    { name: 'back', file: 'MaleBackPaths.swift', viewBox: '718 95 727 1280' },
];

const source = process.argv[2];
if (source === undefined) {
    console.error('usage: node scripts/generate-body-paths.mjs /path/to/musclemap');
    process.exit(1);
}

const output = resolve(process.argv[3] ?? 'apps/web/src/components/muscles/body-paths.ts');
const views = VIEWS.map((view) => ({
    ...view,
    parts: readParts(join(resolve(source), 'Sources/MuscleMap/Data', view.file)),
}));

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, render(views));

console.log(
    `wrote ${output}\n${views.map((view) => `  ${view.name}: ${Object.keys(view.parts).length} parts`).join('\n')}`,
);

/** Pulls every `BodyPartPathData(slug: .x, …)` entry out of one Swift table, keyed by slug. */
function readParts(file) {
    const swift = readFileSync(file, 'utf8');
    const parts = {};

    for (const block of swift.split('BodyPartPathData(').slice(1)) {
        const body = block.slice(0, block.indexOf('\n        ),'));
        const slug = kebab(/slug:\s*\.(\w+)/.exec(body)?.[1] ?? '');
        if (slug === '' || SUB_GROUP_SLUGS.has(slug)) continue;

        // Every quoted string in the entry is one path: common, left and right all render the same.
        const paths = [...body.matchAll(/"([Mm][^"]*)"/g)].map((match) => match[1]);
        if (paths.length > 0) parts[slug] = [...(parts[slug] ?? []), ...paths];
    }

    return parts;
}

/** MuscleMap's Swift cases are camelCase; its own slug strings are kebab-case. */
function kebab(name) {
    return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function render(views) {
    const body = views
        .map(
            (view) =>
                `    ${view.name}: {\n        viewBox: '${view.viewBox}',\n        parts: {\n${Object.entries(view.parts)
                    .map(([slug, paths]) => `            '${slug}': [\n${paths.map((path) => `                '${path}',`).join('\n')}\n            ],`)
                    .join('\n')}\n        },\n    },`,
        )
        .join('\n');

    return `/**
 * Body geometry for the muscle map: two views, each a viewBox and the SVG paths of every part.
 *
 * Converted from MuscleMap by Melih Colpan (MIT), which ships this artwork as Swift source; see
 * NOTICE.md for the licence and \`scripts/generate-body-paths.mjs\` for the conversion.
 *
 * Generated — do not hand-edit.
 */
export const BODY_VIEWS: Record<BodyViewName, BodyView> = {
${body}
};

export type BodyViewName = 'front' | 'back';

/** One drawing of the body: its coordinate space, and the paths of each part keyed by MuscleMap slug. */
export type BodyView = { viewBox: string; parts: Record<string, string[]> };
`;
}
