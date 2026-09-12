import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { loadCatalog } from '@app/catalog';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { createLogger } from '@app/logger';
import { StorageService } from '@app/storage';
import { asc, eq, isNull } from 'drizzle-orm';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogSeedService, SeedOutcome } from './catalog-seed.service.js';

const { exerciseGuideImages, exerciseLinks, exercises } = schema;

const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let minio: StartedTestContainer;
let storage: StorageService;
let seed: CatalogSeedService;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;

    minio = await new GenericContainer('minio/minio:RELEASE.2025-09-07T16-13-09Z')
        .withEntrypoint(['bash'])
        .withCommand([
            '-c',
            'mkdir -p /data/drive/test && /usr/bin/minio server /data/drive/test --console-address ":9001"',
        ])
        .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
        .withExposedPorts(9000)
        .start();

    const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    const config = {
        endpoint,
        region: 'us-east-1',
        bucket: 'catalog-seed-test',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
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
        logger: createLogger({ context: 'seed-test', config: { level: 'error', pretty: false, redact: false } }),
    });
    seed = new CatalogSeedService({ db, storage });
});

afterAll(async () => {
    await database?.stop();
    await minio?.stop();
});

// `storage` is shared across every test in this file (built once in beforeAll), so a spy left on
// it by one test would otherwise still be recording calls when the next test creates its own.
afterEach(() => {
    vi.restoreAllMocks();
});

/** Writes a one-exercise content tree to a temp dir and loads it. */
async function writeEntry({
    slug,
    entry,
    imageBytes,
}: {
    slug: string;
    entry: Record<string, unknown>;
    imageBytes?: Buffer;
}): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'catalog-'));
    await mkdir(join(dir, slug, 'images'), { recursive: true });
    await writeFile(join(dir, slug, 'exercise.json'), JSON.stringify(entry));

    if (imageBytes) await writeFile(join(dir, slug, 'images', 'a.png'), imageBytes);

    return dir;
}

const squat = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'Back squat',
    trackingType: 'weight_reps',
    guide: { setup: 'Bar high.', cues: 'Brace.' },
    links: [{ url: 'https://example.com/a', label: 'A' }],
    images: [{ file: 'a.png', caption: 'Setup' }],
    ...overrides,
});

describe('upsertExercise', () => {
    it('creates a catalog row with its links and images, uploading the image at a content-addressed key', async () => {
        const dir = await writeEntry({ slug: 'squat-create', entry: squat(), imageBytes: PNG_BYTES });
        const [loaded] = await loadCatalog({ dir });

        const result = await seed.upsertExercise({ exercise: loaded });

        expect(result.outcome).toBe(SeedOutcome.Created);

        const [row] = await db.select().from(exercises).where(eq(exercises.id, result.id));
        expect(row).toMatchObject({
            workspaceId: null,
            slug: 'squat-create',
            name: 'Back squat',
            guideSetup: 'Bar high.',
            guideCues: 'Brace.',
            archivedAt: null,
        });

        const links = await db.select().from(exerciseLinks).where(eq(exerciseLinks.exerciseId, result.id));
        expect(links).toEqual([
            expect.objectContaining({ workspaceId: null, url: 'https://example.com/a', position: 0 }),
        ]);

        const sha = createHash('sha256').update(PNG_BYTES).digest('hex');
        const images = await db.select().from(exerciseGuideImages).where(eq(exerciseGuideImages.exerciseId, result.id));
        expect(images).toEqual([
            expect.objectContaining({
                workspaceId: null,
                storageKey: `catalog/squat-create/${sha}.png`,
                contentType: 'image/png',
                caption: 'Setup',
                position: 0,
            }),
        ]);
        expect(await storage.fileExists(`catalog/squat-create/${sha}.png`)).toBe(true);
    });

    it('is idempotent: a second run reports unchanged and uploads nothing', async () => {
        const dir = await writeEntry({ slug: 'squat-idem', entry: squat(), imageBytes: PNG_BYTES });
        const [loaded] = await loadCatalog({ dir });
        await seed.upsertExercise({ exercise: loaded });

        const upload = vi.spyOn(storage, 'uploadFileAtKey');
        const second = await seed.upsertExercise({ exercise: loaded });

        expect(second.outcome).toBe(SeedOutcome.Unchanged);
        expect(upload).not.toHaveBeenCalled();

        const images = await db.select().from(exerciseGuideImages).where(eq(exerciseGuideImages.exerciseId, second.id));
        expect(images).toHaveLength(1);
    });

    it('updates text and a caption without re-uploading unchanged bytes', async () => {
        const dir = await writeEntry({ slug: 'squat-update', entry: squat(), imageBytes: PNG_BYTES });
        const [first] = await loadCatalog({ dir });
        const created = await seed.upsertExercise({ exercise: first });

        const dir2 = await writeEntry({
            slug: 'squat-update',
            entry: squat({ name: 'Low-bar squat', images: [{ file: 'a.png', caption: 'New caption' }] }),
            imageBytes: PNG_BYTES,
        });
        const [second] = await loadCatalog({ dir: dir2 });
        const upload = vi.spyOn(storage, 'uploadFileAtKey');
        const updated = await seed.upsertExercise({ exercise: second });

        expect(updated).toEqual({ id: created.id, outcome: SeedOutcome.Updated });
        expect(upload).not.toHaveBeenCalled();

        const [row] = await db.select().from(exercises).where(eq(exercises.id, created.id));
        expect(row.name).toBe('Low-bar squat');

        const images = await db
            .select()
            .from(exerciseGuideImages)
            .where(eq(exerciseGuideImages.exerciseId, created.id));
        expect(images.map((image) => image.caption)).toEqual(['New caption']);
    });

    it('removes an image dropped from the file, and its object', async () => {
        const dir = await writeEntry({ slug: 'squat-drop', entry: squat(), imageBytes: PNG_BYTES });
        const [first] = await loadCatalog({ dir });
        await seed.upsertExercise({ exercise: first });
        const sha = createHash('sha256').update(PNG_BYTES).digest('hex');

        const dir2 = await writeEntry({ slug: 'squat-drop', entry: squat({ images: [] }) });
        const [second] = await loadCatalog({ dir: dir2 });
        const result = await seed.upsertExercise({ exercise: second });

        expect(result.outcome).toBe(SeedOutcome.Updated);
        const images = await db.select().from(exerciseGuideImages).where(eq(exerciseGuideImages.exerciseId, result.id));
        expect(images).toEqual([]);
        expect(await storage.fileExists(`catalog/squat-drop/${sha}.png`)).toBe(false);
    });

    it('un-archives an exercise that reappears in the content', async () => {
        const dir = await writeEntry({ slug: 'squat-back', entry: squat({ images: [] }) });
        const [loaded] = await loadCatalog({ dir });
        const created = await seed.upsertExercise({ exercise: loaded });
        await seed.archiveMissing({ presentSlugs: [] });

        const result = await seed.upsertExercise({ exercise: loaded });

        expect(result.outcome).toBe(SeedOutcome.Updated);
        const [row] = await db.select().from(exercises).where(eq(exercises.id, created.id));
        expect(row.archivedAt).toBeNull();
    });
});

describe('archiveMissing', () => {
    it('archives catalog rows whose slug is absent and leaves custom and present rows alone', async () => {
        const dirA = await writeEntry({ slug: 'keep-me', entry: squat({ images: [] }) });
        const dirB = await writeEntry({ slug: 'drop-me', entry: squat({ images: [] }) });
        const [keep] = await loadCatalog({ dir: dirA });
        const [drop] = await loadCatalog({ dir: dirB });
        await seed.upsertExercise({ exercise: keep });
        const dropped = await seed.upsertExercise({ exercise: drop });

        const archived = await seed.archiveMissing({ presentSlugs: ['keep-me'] });

        expect(archived).toContain('drop-me');
        expect(archived).not.toContain('keep-me');

        const [row] = await db.select().from(exercises).where(eq(exercises.id, dropped.id));
        expect(row.archivedAt).not.toBeNull();

        // Every archived row is still a catalog row: nothing with a workspace was touched.
        const archivedRows = await db
            .select({ workspaceId: exercises.workspaceId })
            .from(exercises)
            .where(isNull(exercises.workspaceId))
            .orderBy(asc(exercises.slug));
        expect(archivedRows.every((r) => r.workspaceId === null)).toBe(true);
    });
});
