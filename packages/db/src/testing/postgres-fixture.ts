import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, type Db } from '../client.js';

/** A throwaway Postgres and the handle to shut it down. */
export type TestDatabase = { db: Db; connectionString: string; stop(): Promise<void> };

/**
 * Starts a throwaway Postgres and brings it up to the current schema by applying the same
 * `drizzle/` migrations a deployment applies, so a test database cannot drift from production.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
    const container = await new PostgreSqlContainer('postgres:17').start();

    try {
        const connectionString = container.getConnectionUri();
        const { db, close } = createDb({ config: { connectionString } });

        // NodeNext builds this package as CommonJS, so `import.meta.url` (TS1470) is unavailable.
        // `__dirname` gives the same directory-of-this-file resolution under CommonJS.
        await migrate(db, { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });

        return {
            db,
            connectionString,
            stop: async () => {
                await close();
                await container.stop();
            },
        };
    } catch (error) {
        // The container would otherwise leak - the caller has no `stop()` handle yet.
        await container.stop();
        throw error;
    }
}
