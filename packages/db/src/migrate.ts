import { join } from 'node:path';
import { ConfigurationError } from '@app/errors';
import type { Logger } from '@app/logger';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDb } from './client.js';

// NodeNext builds this package as CommonJS, so `import.meta.url` (TS1470) is unavailable.
// `dist/migrate.js` -> packages/db, which is where `drizzle/` sits in both the repo and the
// `pnpm deploy` output an app's image runs from.
const MIGRATIONS_FOLDER = join(__dirname, '..', 'drizzle');

// Any constant works as long as every process picks the same one; this is the low half of a
// 64-bit key chosen once for this repo's schema migrations.
const MIGRATION_LOCK_KEY = 4_027_180_517;

/**
 * Applies the committed `drizzle/` migrations to the database the connection string names, so a
 * deployment brings its own schema up to date instead of waiting for someone with psql.
 *
 * Runs on a connection of its own, under a session-level advisory lock: two replicas booting
 * together would otherwise race on the same `CREATE TABLE`, and the loser would crash-loop.
 *
 * @throws ConfigurationError when the connection string is missing.
 */
export async function runMigrations({
    connectionString,
    migrationsFolder = MIGRATIONS_FOLDER,
    logger,
}: {
    connectionString: string;
    migrationsFolder?: string;
    logger?: Logger;
}): Promise<void> {
    if (!connectionString) {
        throw new ConfigurationError('Database connection string is missing');
    }

    const { db, close } = createDb({ config: { connectionString, maxConnections: 1 }, ...(logger ? { logger } : {}) });

    logger?.info({ migrationsFolder }, 'Applying database migrations');

    try {
        await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);

        try {
            await migrate(db, { migrationsFolder });
        } finally {
            await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
        }
    } finally {
        // The pool is single-use: the app's own pool is built separately and outlives this.
        await close();
    }

    logger?.info('Database migrations applied');
}
