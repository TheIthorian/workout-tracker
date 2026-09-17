import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { startTestDatabase, type TestDatabase } from './testing/index.js';

let database: TestDatabase;

beforeAll(async () => {
    database = await startTestDatabase();
});

afterAll(async () => {
    await database?.stop();
});

describe('createDb', () => {
    it('opens a usable connection and closes it', async () => {
        const { db, close } = createDb({ config: { connectionString: database.connectionString } });

        const result = await db.execute('select 1 as one');

        expect(result.rows[0]).toEqual({ one: 1 });

        await close();
    });

    it('rejects an empty connection string rather than failing later', () => {
        expect(() => createDb({ config: { connectionString: '' } })).toThrowError(/connection string/i);
    });
});
