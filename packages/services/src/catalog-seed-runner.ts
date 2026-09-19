import { loadCatalog } from '@app/catalog';
import type { Db } from '@app/db';
import type { StorageService } from '@app/storage';
import { CatalogSeedService, type ImageProcessor, type SeedOutcome } from './catalog-seed.service.js';

/** What one seed run did, one entry per exercise it touched. */
export type CatalogSeedReport = {
    results: { slug: string; outcome: SeedOutcome }[];
    archived: string[];
};

/**
 * Publishes a content directory into the catalog: every entry is upserted, then any catalog
 * exercise no longer present is archived. The whole directory is loaded and validated before the
 * first write, so one bad file publishes nothing.
 *
 * The image processor is injected rather than imported, so this package still pulls in no image
 * codec - see `ImageProcessor`.
 *
 * @throws InvalidFormatError from the loader when an entry is malformed.
 */
export async function runCatalogSeed({
    db,
    storage,
    processor,
    dir,
}: {
    db: Db;
    storage: StorageService;
    processor: ImageProcessor;
    dir: string;
}): Promise<CatalogSeedReport> {
    const loaded = await loadCatalog({ dir });
    const seed = new CatalogSeedService({ db, storage, processor });
    const results: CatalogSeedReport['results'] = [];

    for (const exercise of loaded) {
        const { outcome } = await seed.upsertExercise({ exercise });
        results.push({ slug: exercise.slug, outcome });
    }

    const archived = await seed.archiveMissing({ presentSlugs: loaded.map((exercise) => exercise.slug) });

    return { results, archived };
}
