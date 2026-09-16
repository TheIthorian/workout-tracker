import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { loadCatalog } from '@app/catalog';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { Equipment, TrackingType } from '@app/domain';
import { createLogger } from '@app/logger';
import { StorageService } from '@app/storage';
import { eq } from 'drizzle-orm';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogSeedService, SeedOutcome } from './catalog-seed.service.js';
import { seedUser, seedWorkspace } from './testing.js';

const { exerciseGuideImages, exerciseLinks, exercises } = schema;

const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let storageContainer: StartedTestContainer;
let storage: StorageService;
let seed: CatalogSeedService;
const tempDirs: string[] = [];

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;

    storageContainer = await new GenericContainer('adobe/s3mock:5.2.2').withExposedPorts(9090).start();

    const endpoint = `http://${storageContainer.getHost()}:${storageContainer.getMappedPort(9090)}`;
    const config = {
        endpoint,
        region: 'us-east-1',
        bucket: 'catalog-seed-test',
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
        logger: createLogger({ context: 'seed-test', config: { level: 'error', pretty: false, redact: false } }),
    });
    seed = new CatalogSeedService({ db, storage });
});

afterAll(async () => {
    await database?.stop();
    await storageContainer?.stop();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

// `storage` is shared across every test in this file (built once in beforeAll), so a spy left on
// it by one test would otherwise still be recording calls when the next test creates its own.
afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Writes a one-exercise content tree to a temp dir and loads it. `imageBytes` writes a single
 * `a.png`; `images` writes any number of named files, e.g. two files with identical bytes to
 * exercise the shared-storage-key path.
 */
async function writeEntry({
    slug,
    entry,
    imageBytes,
    images,
}: {
    slug: string;
    entry: Record<string, unknown>;
    imageBytes?: Buffer;
    images?: { file: string; bytes: Buffer }[];
}): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'catalog-'));
    tempDirs.push(dir);
    await mkdir(join(dir, slug, 'images'), { recursive: true });
    await writeFile(join(dir, slug, 'exercise.json'), JSON.stringify(entry));

    if (imageBytes) await writeFile(join(dir, slug, 'images', 'a.png'), imageBytes);
    for (const image of images ?? []) {
        await writeFile(join(dir, slug, 'images', image.file), image.bytes);
    }

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

    it('writes and updates equipment', async () => {
        const dir = await writeEntry({
            slug: 'seed-equipment',
            entry: squat({ equipment: [Equipment.Barbell], images: [] }),
        });
        const [loaded] = await loadCatalog({ dir });
        const { id } = await seed.upsertExercise({ exercise: loaded });
        expect(await readEquipment(id)).toEqual([Equipment.Barbell]);

        const dir2 = await writeEntry({
            slug: 'seed-equipment',
            entry: squat({ equipment: [Equipment.Barbell, Equipment.Bench], images: [] }),
        });
        const [changedLoaded] = await loadCatalog({ dir: dir2 });
        const changed = await seed.upsertExercise({ exercise: changedLoaded });

        expect(changed.outcome).toBe(SeedOutcome.Updated);
        expect(await readEquipment(id)).toEqual([Equipment.Barbell, Equipment.Bench]);
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

    it('keeps two rows sharing one storage key when two images have identical bytes', async () => {
        const dir = await writeEntry({
            slug: 'squat-dup',
            entry: squat({
                images: [
                    { file: 'a.png', caption: 'Setup' },
                    { file: 'b.png', caption: 'Setup, again' },
                ],
            }),
            images: [
                { file: 'a.png', bytes: PNG_BYTES },
                { file: 'b.png', bytes: PNG_BYTES },
            ],
        });
        const [loaded] = await loadCatalog({ dir });
        const sha = createHash('sha256').update(PNG_BYTES).digest('hex');
        const key = `catalog/squat-dup/${sha}.png`;

        // One spy for the whole test: vi.spyOn returns the same mock on a method that's already
        // spied, so a second vi.spyOn call here would carry over the first call's count instead
        // of starting fresh - mockClear() between assertions is the correct reset, not a new spy.
        const upload = vi.spyOn(storage, 'uploadFileAtKey');
        const created = await seed.upsertExercise({ exercise: loaded });

        expect(created.outcome).toBe(SeedOutcome.Created);
        expect(upload).toHaveBeenCalledTimes(1);

        const createdImages = await db
            .select()
            .from(exerciseGuideImages)
            .where(eq(exerciseGuideImages.exerciseId, created.id));
        expect(createdImages).toHaveLength(2);
        expect(createdImages.every((image) => image.storageKey === key)).toBe(true);

        upload.mockClear();
        const second = await seed.upsertExercise({ exercise: loaded });

        expect(second.outcome).toBe(SeedOutcome.Unchanged);
        expect(upload).not.toHaveBeenCalled();

        const dir2 = await writeEntry({
            slug: 'squat-dup',
            entry: squat({ images: [{ file: 'a.png', caption: 'Setup' }] }),
            images: [{ file: 'a.png', bytes: PNG_BYTES }],
        });
        const [dropped] = await loadCatalog({ dir: dir2 });
        const third = await seed.upsertExercise({ exercise: dropped });

        expect(third.outcome).toBe(SeedOutcome.Updated);
        const remainingImages = await db
            .select()
            .from(exerciseGuideImages)
            .where(eq(exerciseGuideImages.exerciseId, created.id));
        expect(remainingImages).toHaveLength(1);
        expect(await storage.fileExists(key)).toBe(true);
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

        const userId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, userId);
        const [custom] = await db
            .insert(exercises)
            .values({
                workspaceId,
                slug: null,
                name: 'Custom lunge',
                trackingType: TrackingType.WeightReps,
            })
            .returning({ id: exercises.id });

        const archived = await seed.archiveMissing({ presentSlugs: ['keep-me'] });

        expect(archived).toContain('drop-me');
        expect(archived).not.toContain('keep-me');

        const [droppedRow] = await db.select().from(exercises).where(eq(exercises.id, dropped.id));
        expect(droppedRow.archivedAt).not.toBeNull();

        // A workspace-owned exercise is not a catalog row: archiveMissing must not touch it.
        const [customRow] = await db.select().from(exercises).where(eq(exercises.id, custom.id));
        expect(customRow.archivedAt).toBeNull();
    });
});

async function readEquipment(id: string): Promise<Equipment[]> {
    const [row] = await db
        .select({ equipment: schema.exercises.equipment })
        .from(schema.exercises)
        .where(eq(schema.exercises.id, id));
    return row?.equipment ?? [];
}
