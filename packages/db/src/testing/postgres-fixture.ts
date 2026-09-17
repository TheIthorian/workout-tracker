import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { createDb, type Db } from '../client.js';
import { connectionStringFor, MIGRATIONS_FOLDER, startPostgresServer } from './postgres-server.js';
import { testDatabaseTemplate, type TestDatabaseTemplate } from './template.js';

/** A throwaway Postgres and the handle to shut it down. */
export type TestDatabase = { db: Db; connectionString: string; stop(): Promise<void> };

/** Serialises `CREATE DATABASE` across workers sharing one server. Any constant will do. */
const CLONE_LOCK_KEY = 4_820_193;

/**
 * Gives the caller its own empty database at the current schema.
 *
 * Clones the run's migrated template when `global-setup.ts` is wired into the vitest config, which
 * costs a `CREATE DATABASE` rather than a container start and a full migration. Without it - a
 * config that has not opted in - it falls back to a server of its own, so the fixture works either
 * way.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
    const template = testDatabaseTemplate();

    return template ? cloneTemplate(template) : startOwnServer();
}

async function cloneTemplate(template: TestDatabaseTemplate): Promise<TestDatabase> {
    const { adminConnectionString } = template;
    const database = `test_${randomUUID().replaceAll('-', '')}`;

    await withAdmin(adminConnectionString, async (admin) => {
        // Postgres refuses two clones of one template at once, and spec files run in parallel.
        await admin.query('SELECT pg_advisory_lock($1::bigint)', [CLONE_LOCK_KEY]);

        try {
            await admin.query(`CREATE DATABASE "${database}" TEMPLATE "${template.templateDatabase}"`);
        } finally {
            await admin.query('SELECT pg_advisory_unlock($1::bigint)', [CLONE_LOCK_KEY]);
        }
    });

    const connectionString = connectionStringFor({ adminConnectionString, database });
    const { db, close } = createDb({ config: { connectionString, maxConnections: 5 } });

    return {
        db,
        connectionString,
        stop: async () => {
            await close();
            await withAdmin(adminConnectionString, (admin) =>
                admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
            );
        },
    };
}

async function startOwnServer(): Promise<TestDatabase> {
    const container = await startPostgresServer();

    try {
        const connectionString = container.getConnectionUri();
        const { db, close } = createDb({ config: { connectionString, maxConnections: 5 } });

        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

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

async function withAdmin(connectionString: string, use: (admin: Client) => Promise<unknown>): Promise<void> {
    const admin = new Client({ connectionString });
    await admin.connect();

    try {
        await use(admin);
    } finally {
        await admin.end();
    }
}
