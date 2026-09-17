import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb } from '../client.js';
import { connectionStringFor, MIGRATIONS_FOLDER, startPostgresServer } from './postgres-server.js';
import type { TestDatabaseTemplate } from './template.js';

/** The migrated database every spec file's own database is cloned from. */
const TEMPLATE_DATABASE = 'app_template';

/**
 * The half of vitest's `TestProject` this file uses. Structural, so the package builds without a
 * type dependency on the test runner that calls it.
 */
type TemplateProvider = { provide(key: 'testDatabaseTemplate', value: TestDatabaseTemplate): void };

let server: StartedPostgreSqlContainer | undefined;

/**
 * Starts the one Postgres a whole vitest run shares and brings a template database up to the
 * current schema, so each spec file clones a migrated database instead of starting a container and
 * applying every migration again.
 */
export async function setup(project: TemplateProvider): Promise<void> {
    server = await startPostgresServer();

    const adminConnectionString = server.getConnectionUri();

    try {
        await createTemplateDatabase(adminConnectionString);
    } catch (error) {
        // The container would otherwise leak - vitest only calls `teardown` once `setup` returns.
        await server.stop();
        server = undefined;

        throw error;
    }

    project.provide('testDatabaseTemplate', { adminConnectionString, templateDatabase: TEMPLATE_DATABASE });
}

/** Stops the shared server once every spec file in the run has finished with it. */
export async function teardown(): Promise<void> {
    await server?.stop();
    server = undefined;
}

async function createTemplateDatabase(adminConnectionString: string): Promise<void> {
    const admin = new Client({ connectionString: adminConnectionString });
    await admin.connect();

    try {
        await admin.query(`CREATE DATABASE "${TEMPLATE_DATABASE}"`);
    } finally {
        await admin.end();
    }

    const { db, close } = createDb({
        config: {
            connectionString: connectionStringFor({ adminConnectionString, database: TEMPLATE_DATABASE }),
            maxConnections: 1,
        },
    });

    try {
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
        // `CREATE DATABASE ... TEMPLATE` refuses to run while anything is connected to the source.
        await close();
    }
}
