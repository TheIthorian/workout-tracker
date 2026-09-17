import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ConfigurationError } from '@app/errors';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { createDb, type Db } from '../client.js';

/** A throwaway database and the handle to tear it down. */
export type TestDatabase = { db: Db; connectionString: string; stop(): Promise<void> };

// NodeNext builds this package as CommonJS, so `import.meta.url` (TS1470) is unavailable.
// `__dirname` gives the same directory-of-this-file resolution under CommonJS.
const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');

/**
 * A Postgres already running before the test starts - `docker compose`'s dev server locally, a
 * `postgres` service container in CI - reachable through its always-present `postgres` maintenance
 * database. Never `DATABASE_URL`: that names the `app` database real dev data lives in, and this
 * fixture creates and drops databases on whatever server it's pointed at.
 */
const DEFAULT_TEST_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/postgres';

/**
 * Creates a fresh, randomly-named database on `TEST_DATABASE_URL` (or the default local dev
 * server) and brings it up to the current schema with the committed `drizzle/` migrations, so a
 * test database cannot drift from production.
 *
 * A test-only entry point, like `drizzle.config.ts` - reading the environment directly here does
 * not reopen the door `packages/db`'s production code keeps closed for everything else.
 *
 * @throws ConfigurationError when the target server refuses the connection, so a forgotten
 * `docker compose up -d` fails at the first test rather than confusingly mid-suite.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
    const adminConnectionString = process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;
    const database = `test_${randomUUID().replaceAll('-', '')}`;

    try {
        await withAdmin(adminConnectionString, (admin) => admin.query(`CREATE DATABASE "${database}"`));
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new ConfigurationError(
            `Could not create a test database on ${redactPassword(adminConnectionString)} (${reason}) - is \`docker compose up -d\` running?`,
        );
    }

    const connectionString = connectionStringFor({ adminConnectionString, database });

    // Every spec file in every package now shares one server, so a generous pool multiplied by
    // turbo's concurrency is what would exhaust `max_connections`. A test file runs its cases in
    // sequence and never needs more than a handful.
    const { db, close } = createDb({ config: { connectionString, maxConnections: 3 } });

    try {
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } catch (error) {
        // The database would otherwise leak - the caller has no `stop()` handle yet.
        await close();
        await dropDatabase({ adminConnectionString, database });
        throw error;
    }

    return {
        db,
        connectionString,
        stop: async () => {
            await close();
            await dropDatabase({ adminConnectionString, database });
        },
    };
}

async function dropDatabase({
    adminConnectionString,
    database,
}: {
    adminConnectionString: string;
    database: string;
}): Promise<void> {
    await withAdmin(adminConnectionString, (admin) =>
        admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
    );
}

async function withAdmin(connectionString: string, use: (admin: Client) => Promise<unknown>): Promise<void> {
    const admin = new Client({ connectionString });
    await admin.connect();

    try {
        await use(admin);
    } finally {
        await admin.end();
    }
}

function connectionStringFor({
    adminConnectionString,
    database,
}: {
    adminConnectionString: string;
    database: string;
}): string {
    const url = new URL(adminConnectionString);
    url.pathname = `/${database}`;

    return url.toString();
}

/** Never put a real credential in a thrown error message, even a local-only test one. */
function redactPassword(connectionString: string): string {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';

    return url.toString();
}
