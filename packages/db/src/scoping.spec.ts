import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import { items } from './schema/items.js';
import { workspaces } from './schema/workspaces.js';
import { scopedToWorkspace } from './scoping.js';
import { startTestDatabase } from './testing/index.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let workspaceId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;

    [workspaceId, otherWorkspaceId] = await Promise.all([insertWorkspace('Ours'), insertWorkspace('Theirs')]);

    await db.insert(items).values([
        { workspaceId, name: 'ours-a' },
        { workspaceId, name: 'ours-b' },
        { workspaceId: otherWorkspaceId, name: 'theirs' },
    ]);
});

afterAll(async () => {
    await database?.stop();
});

describe('scopedToWorkspace', () => {
    it('returns only the named workspace rows', async () => {
        const rows = await db.select().from(items).where(scopedToWorkspace(items, workspaceId));

        expect(rows.map((row) => row.name).sort()).toEqual(['ours-a', 'ours-b']);
    });

    it('ANDs further filters onto the tenant filter rather than replacing it', async () => {
        // The extra filter matches a row in the OTHER workspace too - if the tenant filter were
        // dropped or overwritten, this would return it.
        const rows = await db
            .select()
            .from(items)
            .where(scopedToWorkspace(items, workspaceId, eq(items.name, 'theirs')));

        expect(rows).toEqual([]);
    });

    it('ignores undefined filters, so a conditional filter can be inlined', async () => {
        const rows = await db
            .select()
            .from(items)
            .where(scopedToWorkspace(items, workspaceId, undefined));

        expect(rows).toHaveLength(2);
    });

    it('scopes a delete as well as a select', async () => {
        const doomedWorkspaceId = await insertWorkspace('Doomed');
        await db.insert(items).values({ workspaceId: doomedWorkspaceId, name: 'doomed' });

        await db.delete(items).where(scopedToWorkspace(items, doomedWorkspaceId));

        expect(await db.select().from(items).where(scopedToWorkspace(items, workspaceId))).toHaveLength(2);
    });
});

async function insertWorkspace(name: string): Promise<string> {
    const [row] = await db.insert(workspaces).values({ id: randomUUID(), name }).returning({ id: workspaces.id });
    return row.id;
}
