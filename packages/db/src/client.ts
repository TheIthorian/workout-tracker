import { ConfigurationError } from '@app/errors';
import type { Logger } from '@app/logger';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

/**
 * Everything the database client needs. Always supplied by the caller: this package never reads
 * `process.env`, so the app that owns the environment owns validating it.
 */
export type DbConfig = {
    connectionString: string;
    maxConnections?: number;
    ssl?: boolean;
};

/** The Drizzle handle, exported so consumers type against it without importing drizzle directly. */
export type Db = NodePgDatabase<typeof schema>;

/**
 * Builds a pooled Drizzle client.
 *
 * @throws ConfigurationError when the connection string is missing, so a misconfigured app fails
 * at startup rather than on its first query.
 */
export function createDb({ config, logger }: { config: DbConfig; logger?: Logger }): {
    db: Db;
    close(): Promise<void>;
} {
    if (!config.connectionString) {
        throw new ConfigurationError('Database connection string is missing');
    }

    const pool = new Pool({
        connectionString: config.connectionString,
        max: config.maxConnections ?? 10,
        ...(config.ssl === undefined ? {} : { ssl: config.ssl }),
    });

    pool.on('error', (error) => logger?.error({ err: error }, 'Idle database client errored'));

    return {
        db: drizzle(pool, { schema }),
        close: () => pool.end(),
    };
}
