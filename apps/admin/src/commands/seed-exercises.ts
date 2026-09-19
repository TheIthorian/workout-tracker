import type { Db } from '@app/db';
import { createCatalogImageProcessor } from '@app/image';
import { runCatalogSeed, type CatalogSeedReport } from '@app/services';
import type { StorageService } from '@app/storage';

/**
 * How catalog images are published. Guide illustrations are viewed at phone width, so 1200 px on
 * the longest side is already more than the screen shows. Changing either value republishes every
 * image (the settings are part of the storage key), so this is a deliberate, one-off choice.
 * `apps/api`'s startup seed builds the same processor from the same numbers.
 */
const IMAGE_PROCESSOR = createCatalogImageProcessor({ maxDimension: 1200, quality: 80 });

export type SeedReport = CatalogSeedReport;

/**
 * Publishes the content directory into the catalog. The run itself lives in `@app/services` so the
 * API's startup seed and this command cannot drift apart.
 *
 * @throws InvalidFormatError from the loader when an entry is malformed.
 */
export async function seedExercises({
    db,
    storage,
    dir,
}: {
    db: Db;
    storage: StorageService;
    dir: string;
}): Promise<SeedReport> {
    return runCatalogSeed({ db, storage, processor: IMAGE_PROCESSOR, dir });
}

/** One line per exercise, outcome first so a scan down the left edge shows what changed. */
export function formatSeedReport(report: SeedReport): string[] {
    return [
        ...report.results.map(({ slug, outcome }) => `${outcome.padEnd(10)} ${slug}`),
        ...report.archived.map((slug) => `${'archived'.padEnd(10)} ${slug}`),
    ];
}
