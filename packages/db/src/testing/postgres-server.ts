import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// NodeNext builds this package as CommonJS, so `import.meta.url` (TS1470) is unavailable.
// `__dirname` gives the same directory-of-this-file resolution under CommonJS.
/** The committed `drizzle/` migrations, the same set a deployment applies. */
export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');

/**
 * Starts a throwaway Postgres tuned for a test run: durability is traded away because the whole
 * server dies with the process, and the connection ceiling covers one database per spec file.
 */
export async function startPostgresServer(): Promise<StartedPostgreSqlContainer> {
    return new PostgreSqlContainer('postgres:17')
        .withCommand([
            'postgres',
            '-c',
            'fsync=off',
            '-c',
            'synchronous_commit=off',
            '-c',
            'full_page_writes=off',
            '-c',
            'max_connections=200',
        ])
        .start();
}

/** Rewrites a connection string to point at a different database on the same server. */
export function connectionStringFor({
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
