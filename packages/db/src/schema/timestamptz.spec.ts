import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../client.js';
import { startTestDatabase } from '../testing/index.js';
import { workspaces } from './workspaces.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
});

afterAll(async () => {
    await database.stop();
});

describe('timestamptz columns', () => {
    it('reads back as ISO 8601 rather than the Postgres rendering', async () => {
        const [row] = await db.insert(workspaces).values({ name: randomUUID() }).returning();

        expect(row?.createdAt).toMatch(ISO_8601);
    });

    it('round-trips an ISO instant unchanged', async () => {
        const createdAt = '2026-03-29T01:30:00.000Z';

        const [row] = await db.insert(workspaces).values({ name: randomUUID(), createdAt }).returning();

        expect(row?.createdAt).toBe(createdAt);
    });

    // The rendering Postgres picks follows the session's TimeZone, so a deployment whose database
    // is not on UTC would otherwise put a different offset on the wire.
    it('names the same instant whatever timezone the server session carries', async () => {
        const createdAt = '2026-11-01T05:30:00.000Z';
        const name = randomUUID();
        await db.insert(workspaces).values({ name, createdAt });

        const read = async (timeZone: string): Promise<string | undefined> => {
            await db.execute(sql`set time zone ${sql.raw(`'${timeZone}'`)}`);
            const [row] = await db
                .select()
                .from(workspaces)
                .where(sql`${workspaces.name} = ${name}`);

            return row?.createdAt;
        };

        expect(await read('UTC')).toBe(createdAt);
        expect(await read('America/New_York')).toBe(createdAt);
        expect(await read('Asia/Kolkata')).toBe(createdAt);

        await db.execute(sql`set time zone 'UTC'`);
    });
});
