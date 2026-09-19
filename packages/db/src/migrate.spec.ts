import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { startTestDatabase, type TestDatabase } from './testing/index.js';

let database: TestDatabase;

beforeAll(async () => {
    database = await startTestDatabase();
});

afterAll(async () => {
    await database?.stop();
});

describe('runMigrations', () => {
    it('is a no-op against a database already at the current schema', async () => {
        await runMigrations({ connectionString: database.connectionString });

        const result = await database.db.execute<{ count: string }>(
            'select count(*)::text as count from drizzle.__drizzle_migrations',
        );

        expect(Number(result.rows[0]?.count)).toBeGreaterThan(0);
    });

    it('releases the advisory lock so a second run is not blocked', async () => {
        await runMigrations({ connectionString: database.connectionString });
        await runMigrations({ connectionString: database.connectionString });

        const result = await database.db.execute<{ count: string }>(
            "select count(*)::text as count from pg_locks where locktype = 'advisory'",
        );

        expect(result.rows[0]?.count).toBe('0');
    });

    it('rejects an empty connection string rather than failing later', async () => {
        await expect(runMigrations({ connectionString: '' })).rejects.toThrowError(/connection string/i);
    });
});
