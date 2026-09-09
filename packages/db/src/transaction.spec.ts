import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import { items } from './schema/items.js';
import { workspaces } from './schema/workspaces.js';
import { startTestDatabase } from './testing/index.js';
import { withTransaction } from './transaction.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
});

afterAll(async () => {
    await database?.stop();
});

describe('withTransaction', () => {
    it('commits when work resolves', async () => {
        const id = randomUUID();

        await withTransaction(db, async (tx) => {
            await tx.insert(workspaces).values({ id, name: 'Committed' });
        });

        expect(await db.select().from(workspaces).where(eq(workspaces.id, id))).toHaveLength(1);
    });

    it('rolls back and propagates the original error when work throws', async () => {
        const id = randomUUID();
        const originalError = new Error('deliberate failure from test');

        await expect(
            withTransaction(db, async (tx) => {
                await tx.insert(workspaces).values({ id, name: 'Rolled back' });
                throw originalError;
            }),
        ).rejects.toBe(originalError);

        expect(await db.select().from(workspaces).where(eq(workspaces.id, id))).toHaveLength(0);
    });

    it('rolls back both inserts when the second violates a foreign key', async () => {
        const workspaceId = randomUUID();
        const itemId = randomUUID();

        await expect(
            withTransaction(db, async (tx) => {
                await tx.insert(workspaces).values({ id: workspaceId, name: 'Doomed' });
                // A workspace that does not exist, so the FK rejects this insert.
                await tx.insert(items).values({ id: itemId, workspaceId: randomUUID(), name: 'Orphan' });
            }),
        ).rejects.toThrow();

        expect(await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))).toHaveLength(0);
        expect(await db.select().from(items).where(eq(items.id, itemId))).toHaveLength(0);
    });

    it('participates in the outer transaction rather than opening a nested one', async () => {
        const outerId = randomUUID();
        const innerId = randomUUID();

        await expect(
            withTransaction(db, async (tx) => {
                await tx.insert(workspaces).values({ id: outerId, name: 'Outer' });

                await withTransaction(tx, async (innerTx) => {
                    await innerTx.insert(workspaces).values({ id: innerId, name: 'Inner' });
                });

                throw new Error('force outer rollback');
            }),
        ).rejects.toThrow('force outer rollback');

        expect(await db.select().from(workspaces).where(eq(workspaces.id, outerId))).toHaveLength(0);
        expect(await db.select().from(workspaces).where(eq(workspaces.id, innerId))).toHaveLength(0);
    });
});
