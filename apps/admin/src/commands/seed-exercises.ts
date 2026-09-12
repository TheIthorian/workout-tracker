import { loadCatalog } from '@app/catalog';
import type { Db } from '@app/db';
import { CatalogSeedService, type SeedOutcome } from '@app/services';
import type { StorageService } from '@app/storage';

export type SeedReport = {
    results: { slug: string; outcome: SeedOutcome }[];
    archived: string[];
};

/**
 * Publishes the content directory into the catalog: every entry is upserted, then any catalog
 * exercise no longer present is archived. The whole directory is loaded and validated before the
 * first write, so one bad file publishes nothing.
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
    const loaded = await loadCatalog({ dir });
    const seed = new CatalogSeedService({ db, storage });
    const results: SeedReport['results'] = [];

    for (const exercise of loaded) {
        const { outcome } = await seed.upsertExercise({ exercise });
        results.push({ slug: exercise.slug, outcome });
    }

    const archived = await seed.archiveMissing({ presentSlugs: loaded.map((exercise) => exercise.slug) });

    return { results, archived };
}

/** One line per exercise, outcome first so a scan down the left edge shows what changed. */
export function formatSeedReport(report: SeedReport): string[] {
    return [
        ...report.results.map(({ slug, outcome }) => `${outcome.padEnd(10)} ${slug}`),
        ...report.archived.map((slug) => `${'archived'.padEnd(10)} ${slug}`),
    ];
}
