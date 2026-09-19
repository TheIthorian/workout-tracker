import { resolve } from 'node:path';
import type { Db } from '@app/db';
import { createCatalogImageProcessor } from '@app/image';
import type { Logger } from '@app/logger';
import { runCatalogSeed } from '@app/services';
import type { StorageService } from '@app/storage';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadEnv } from '../config/load-env.js';
import { APP_LOGGER, DB, STORAGE_SERVICE } from '../providers.js';

/**
 * Must match `apps/admin seed-exercises`: the settings are part of every image's storage key, so a
 * different pair here would republish the whole catalog on the next boot.
 */
const IMAGE_PROCESSOR = createCatalogImageProcessor({ maxDimension: 1200, quality: 80 });

// `dist/startup/seed-catalog.js` -> the app root, where the image's `COPY content` lands it.
// Outside a container there is no `content/` beside `dist/`, so a dev sets CATALOG_CONTENT_DIR.
const DEFAULT_CONTENT_DIR = resolve(__dirname, '..', '..', 'content', 'exercises');

/**
 * Publishes `content/exercises` into the shared catalog, after the server is already listening.
 *
 * Deliberately not awaited by the bootstrap and deliberately not fatal: the app serves correctly
 * against an unseeded or half-seeded catalog, and the alternative - a deploy that fails its
 * readiness probe because object storage was briefly unhappy - is worse than a stale catalog. It
 * runs in-process rather than from CI so the database is only ever reached over the private
 * network.
 */
export async function seedCatalogOnStartup({ app }: { app: NestFastifyApplication }): Promise<void> {
    const env = loadEnv();
    const logger = app.get<Logger>(APP_LOGGER);

    if (env['CATALOG_SEED_ON_STARTUP'] !== true) {
        logger.info('Catalog seed on startup is disabled');

        return;
    }

    const contentDir = String(env['CATALOG_CONTENT_DIR'] ?? '') || DEFAULT_CONTENT_DIR;

    logger.info({ contentDir }, 'Seeding the exercise catalog');

    const report = await runCatalogSeed({
        db: app.get<Db>(DB),
        storage: app.get<StorageService>(STORAGE_SERVICE),
        processor: IMAGE_PROCESSOR,
        dir: contentDir,
    });

    const counts = report.results.reduce<Record<string, number>>(
        (totals, { outcome }) => ({ ...totals, [outcome]: (totals[outcome] ?? 0) + 1 }),
        {},
    );

    logger.info({ ...counts, archived: report.archived.length }, 'Exercise catalog seeded');
}
