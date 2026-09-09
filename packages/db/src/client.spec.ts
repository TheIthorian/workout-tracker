import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17').start();
});

afterAll(async () => {
    await container.stop();
});

describe('createDb', () => {
    it('opens a usable connection and closes it', async () => {
        const { db, close } = createDb({ config: { connectionString: container.getConnectionUri() } });

        const result = await db.execute('select 1 as one');

        expect(result.rows[0]).toEqual({ one: 1 });

        await close();
    });

    it('rejects an empty connection string rather than failing later', () => {
        expect(() => createDb({ config: { connectionString: '' } })).toThrowError(/connection string/i);
    });
});
