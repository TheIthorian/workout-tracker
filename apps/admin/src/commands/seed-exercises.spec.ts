import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { InvalidFormatError } from '@app/errors';
import { createLogger } from '@app/logger';
import { SeedOutcome } from '@app/services';
import { StorageService } from '@app/storage';
import { isNull } from 'drizzle-orm';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatSeedReport, seedExercises } from './seed-exercises.js';

const { exercises } = schema;

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let storageContainer: StartedTestContainer;
let storage: StorageService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;

    storageContainer = await new GenericContainer('adobe/s3mock:5.2.2').withExposedPorts(9090).start();

    const endpoint = `http://${storageContainer.getHost()}:${storageContainer.getMappedPort(9090)}`;
    const config = {
        endpoint,
        region: 'us-east-1',
        bucket: 'admin-seed-test',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        forcePathStyle: true,
    };
    const bootstrap = new S3Client({
        endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    await bootstrap.send(new CreateBucketCommand({ Bucket: config.bucket }));
    bootstrap.destroy();

    storage = new StorageService({
        config,
        logger: createLogger({ context: 'admin-seed-test', config: { level: 'error', pretty: false, redact: false } }),
    });
});

afterAll(async () => {
    await database?.stop();
    await storageContainer?.stop();
});

async function writeTree(entries: Record<string, Record<string, unknown>>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'admin-catalog-'));

    for (const [slug, entry] of Object.entries(entries)) {
        await mkdir(join(dir, slug, 'images'), { recursive: true });
        await writeFile(join(dir, slug, 'exercise.json'), JSON.stringify(entry));
    }

    return dir;
}

const entry = (name: string): Record<string, unknown> => ({ name, trackingType: 'weight_reps' });

describe('seedExercises', () => {
    it('creates, then reports unchanged, then archives what disappears', async () => {
        const first = await writeTree({ 'admin-a': entry('A'), 'admin-b': entry('B') });

        const run1 = await seedExercises({ db, storage, dir: first });
        expect(run1.results).toEqual([
            { slug: 'admin-a', outcome: SeedOutcome.Created },
            { slug: 'admin-b', outcome: SeedOutcome.Created },
        ]);

        const run2 = await seedExercises({ db, storage, dir: first });
        expect(run2.results.map((r) => r.outcome)).toEqual([SeedOutcome.Unchanged, SeedOutcome.Unchanged]);
        expect(run2.archived).toEqual([]);

        const second = await writeTree({ 'admin-a': entry('A') });
        const run3 = await seedExercises({ db, storage, dir: second });
        expect(run3.archived).toEqual(['admin-b']);

        const rows = await db
            .select({ slug: exercises.slug, archivedAt: exercises.archivedAt })
            .from(exercises)
            .where(isNull(exercises.workspaceId));
        expect(rows.find((r) => r.slug === 'admin-b')?.archivedAt).not.toBeNull();
        expect(rows.find((r) => r.slug === 'admin-a')?.archivedAt).toBeNull();
    });

    it('writes nothing when any entry fails to load', async () => {
        const dir = await writeTree({
            'admin-good': entry('Good'),
            'admin-bad': { name: 'Bad', trackingType: 'vibes' },
        });

        await expect(seedExercises({ db, storage, dir })).rejects.toBeInstanceOf(InvalidFormatError);

        const rows = await db.select({ slug: exercises.slug }).from(exercises).where(isNull(exercises.workspaceId));
        expect(rows.map((r) => r.slug)).not.toContain('admin-good');
    });
});

describe('formatSeedReport', () => {
    it('prints one line per exercise and one per archived slug', () => {
        expect(
            formatSeedReport({
                results: [{ slug: 'x', outcome: SeedOutcome.Created }],
                archived: ['y'],
            }),
        ).toEqual(['created    x', 'archived   y']);
    });
});
