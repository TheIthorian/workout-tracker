import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { InvalidFormatError } from '@app/errors';
import { CATALOG_SLUG_PATTERN, exerciseEntrySchema, type ExerciseEntry } from './exercise-entry.js';

/** An image referenced by an entry, resolved to a path on disk. */
export type LoadedImage = {
    file: string;
    caption: string | null;
    path: string;
    contentType: string;
};

/** One catalog directory, validated and ready to publish. */
export type LoadedExercise = {
    slug: string;
    directory: string;
    entry: ExerciseEntry;
    images: LoadedImage[];
};

const IMAGE_CONTENT_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};

/**
 * Reads every `<dir>/<slug>/exercise.json`, validates it, and confirms each referenced image exists.
 * Fails on the first bad entry so a typo in one file publishes nothing.
 *
 * @throws InvalidFormatError naming the slug and the problem.
 */
export async function loadCatalog({ dir }: { dir: string }): Promise<LoadedExercise[]> {
    let names: string[];

    try {
        names = (await readdir(dir, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        throw new InvalidFormatError(`Catalog directory not found: ${dir}`);
    }

    const loaded: LoadedExercise[] = [];

    for (const slug of names) {
        loaded.push(await loadEntry({ dir, slug }));
    }

    return loaded;
}

async function loadEntry({ dir, slug }: { dir: string; slug: string }): Promise<LoadedExercise> {
    if (!CATALOG_SLUG_PATTERN.test(slug)) {
        throw new InvalidFormatError(`Catalog directory "${slug}" is not a valid slug (lowercase, digits, hyphens)`);
    }

    const directory = join(dir, slug);
    const entryPath = join(directory, 'exercise.json');

    let raw: unknown;

    try {
        raw = JSON.parse(await readFile(entryPath, 'utf8'));
    } catch (error) {
        throw new InvalidFormatError(`${slug}: cannot read ${entryPath}: ${describe(error)}`);
    }

    const parsed = exerciseEntrySchema.safeParse(raw);

    if (!parsed.success) {
        throw new InvalidFormatError(`${slug}: invalid exercise.json: ${parsed.error.message}`);
    }

    const images: LoadedImage[] = [];

    for (const image of parsed.data.images) {
        const contentType = IMAGE_CONTENT_TYPES[extname(image.file).toLowerCase()];

        if (!contentType) {
            throw new InvalidFormatError(`${slug}: image "${image.file}" must be .png, .jpg, .jpeg or .webp`);
        }

        const path = join(directory, 'images', image.file);

        try {
            await access(path);
        } catch {
            throw new InvalidFormatError(`${slug}: image "${image.file}" not found at ${path}`);
        }

        images.push({ file: image.file, caption: image.caption, path, contentType });
    }

    return { slug, directory, entry: parsed.data, images };
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
