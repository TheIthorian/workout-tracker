import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { LoadedExercise } from '@app/catalog';
import { schema, withTransaction, type Db, type Tx } from '@app/db';
import type { StorageService } from '@app/storage';
import { and, eq, isNull, notInArray } from 'drizzle-orm';

const { exerciseGuideImages, exerciseLinks, exercises } = schema;

/** What one upsert did to the row. */
export enum SeedOutcome {
    Created = 'created',
    Updated = 'updated',
    Unchanged = 'unchanged',
}

/** The object-storage key for a catalog image. Content-addressed, so a changed image is a new URL. */
export function catalogImageKey({
    slug,
    sha256,
    extension,
}: {
    slug: string;
    sha256: string;
    extension: string;
}): string {
    return `catalog/${slug}/${sha256}${extension}`;
}

/**
 * Publishes catalog content into the `exercises` tables. The only writer of catalog rows.
 *
 * Idempotent: rerunning against unchanged content writes nothing and uploads nothing. Objects are
 * keyed by their bytes' hash, so a re-upload is skipped when the key already exists.
 */
export class CatalogSeedService {
    private readonly db: Db;
    private readonly storage: StorageService;

    constructor({ db, storage }: { db: Db; storage: StorageService }) {
        this.db = db;
        this.storage = storage;
    }

    /**
     * Creates or updates one catalog exercise, its links and its images, in one transaction.
     * Images are uploaded before the transaction opens, so a failed write leaves at worst an
     * unreferenced object; stale objects are deleted after it commits.
     */
    async upsertExercise({ exercise }: { exercise: LoadedExercise }): Promise<{ id: string; outcome: SeedOutcome }> {
        const images = await this.stageImages({ exercise });

        const { id, outcome, staleKeys } = await withTransaction(this.db, async (tx) => {
            // Catalog rows have no tenant, so the tenant helpers do not apply: this is the one
            // writer of rows whose workspace_id is null.
            const [existing] = await tx
                .select({ id: exercises.id })
                .from(exercises)
                .where(and(isNull(exercises.workspaceId), eq(exercises.slug, exercise.slug)));

            const desired = {
                workspaceId: null,
                slug: exercise.slug,
                name: exercise.entry.name,
                trackingType: exercise.entry.trackingType,
                notes: exercise.entry.notes,
                guideSetup: exercise.entry.guide.setup,
                guideExecution: exercise.entry.guide.execution,
                guideCues: exercise.entry.guide.cues,
                guideMistakes: exercise.entry.guide.mistakes,
                archivedAt: null,
            };

            if (!existing) {
                const [created] = await tx.insert(exercises).values(desired).returning({ id: exercises.id });
                const links = linkRows({ exerciseId: created.id, exercise });
                if (links.length > 0) await tx.insert(exerciseLinks).values(links);
                if (images.length > 0)
                    await tx.insert(exerciseGuideImages).values(imageRows({ exerciseId: created.id, images }));

                return { id: created.id, outcome: SeedOutcome.Created, staleKeys: [] };
            }

            const changed = await syncRow({ tx, id: existing.id, desired });
            const linksChanged = await syncLinks({ tx, exerciseId: existing.id, exercise });
            const { changed: imagesChanged, staleKeys } = await syncImages({ tx, exerciseId: existing.id, images });

            // syncRow already bumped updatedAt when the row itself changed; a links- or
            // images-only change still needs one, since neither of those touches `exercises`.
            if (!changed && (linksChanged || imagesChanged)) {
                await tx
                    .update(exercises)
                    .set({ updatedAt: new Date().toISOString() })
                    .where(eq(exercises.id, existing.id));
            }

            return {
                id: existing.id,
                outcome: changed || linksChanged || imagesChanged ? SeedOutcome.Updated : SeedOutcome.Unchanged,
                staleKeys,
            };
        });

        for (const key of staleKeys) {
            await this.storage.deleteFile(key);
        }

        return { id, outcome };
    }

    /**
     * Archives every catalog exercise whose slug is not in `presentSlugs`. Never deletes: sessions
     * reference exercises by id.
     *
     * @returns the slugs archived by this call.
     */
    async archiveMissing({ presentSlugs }: { presentSlugs: string[] }): Promise<string[]> {
        const now = new Date().toISOString();
        const rows = await this.db
            .update(exercises)
            .set({ archivedAt: now, updatedAt: now })
            .where(
                and(
                    isNull(exercises.workspaceId),
                    isNull(exercises.archivedAt),
                    presentSlugs.length === 0 ? undefined : notInArray(exercises.slug, presentSlugs),
                ),
            )
            .returning({ slug: exercises.slug });

        return rows.map((row) => row.slug).filter((slug): slug is string => slug !== null);
    }

    /** Hashes and uploads each image that is not already stored. Returns the rows to write. */
    private async stageImages({ exercise }: { exercise: LoadedExercise }): Promise<StagedImage[]> {
        const staged: StagedImage[] = [];

        for (const [position, image] of exercise.images.entries()) {
            const bytes = await readFile(image.path);
            const sha256 = createHash('sha256').update(bytes).digest('hex');
            const storageKey = catalogImageKey({
                slug: exercise.slug,
                sha256,
                extension: extname(image.file).toLowerCase(),
            });

            if (!(await this.storage.fileExists(storageKey))) {
                await this.storage.uploadFileAtKey({
                    fileStream: bytes,
                    key: storageKey,
                    contentType: image.contentType,
                });
            }

            staged.push({ storageKey, contentType: image.contentType, caption: image.caption, position });
        }

        return staged;
    }
}

type StagedImage = { storageKey: string; contentType: string; caption: string | null; position: number };

type DesiredRow = {
    workspaceId: null;
    slug: string;
    name: string;
    trackingType: LoadedExercise['entry']['trackingType'];
    notes: string | null;
    guideSetup: string | null;
    guideExecution: string | null;
    guideCues: string | null;
    guideMistakes: string | null;
    archivedAt: null;
};

async function syncRow({ tx, id, desired }: { tx: Tx; id: string; desired: DesiredRow }): Promise<boolean> {
    const [current] = await tx
        .select({
            name: exercises.name,
            trackingType: exercises.trackingType,
            notes: exercises.notes,
            guideSetup: exercises.guideSetup,
            guideExecution: exercises.guideExecution,
            guideCues: exercises.guideCues,
            guideMistakes: exercises.guideMistakes,
            archivedAt: exercises.archivedAt,
        })
        .from(exercises)
        .where(eq(exercises.id, id));

    const { workspaceId: _workspaceId, slug: _slug, ...comparable } = desired;

    if (JSON.stringify(current) === JSON.stringify(comparable)) return false;

    await tx
        .update(exercises)
        .set({ ...comparable, updatedAt: new Date().toISOString() })
        .where(eq(exercises.id, id));

    return true;
}

function linkRows({ exerciseId, exercise }: { exerciseId: string; exercise: LoadedExercise }): LinkRow[] {
    return exercise.entry.links.map((link, position) => ({
        workspaceId: null,
        exerciseId,
        url: link.url,
        label: link.label,
        position,
    }));
}

type LinkRow = { workspaceId: null; exerciseId: string; url: string; label: string | null; position: number };

async function syncLinks({
    tx,
    exerciseId,
    exercise,
}: {
    tx: Tx;
    exerciseId: string;
    exercise: LoadedExercise;
}): Promise<boolean> {
    const current = await tx
        .select({ url: exerciseLinks.url, label: exerciseLinks.label, position: exerciseLinks.position })
        .from(exerciseLinks)
        .where(eq(exerciseLinks.exerciseId, exerciseId))
        .orderBy(exerciseLinks.position);

    const desired = linkRows({ exerciseId, exercise });
    const comparable = desired.map(({ url, label, position }) => ({ url, label, position }));

    if (JSON.stringify(current) === JSON.stringify(comparable)) return false;

    // Links carry no bytes and no id anyone links to, so replace-all is simpler than a diff.
    await tx.delete(exerciseLinks).where(eq(exerciseLinks.exerciseId, exerciseId));
    if (desired.length > 0) await tx.insert(exerciseLinks).values(desired);

    return true;
}

function imageRows({ exerciseId, images }: { exerciseId: string; images: StagedImage[] }): ImageRow[] {
    return images.map((image) => ({ workspaceId: null, exerciseId, ...image }));
}

type ImageRow = StagedImage & { workspaceId: null; exerciseId: string };

/**
 * Replace-all, the same shape as `syncLinks`: two images can share a storage key (identical
 * bytes), so a diff keyed on `storageKey` cannot address the second row of such a pair, and would
 * either miss it or misattribute another row's update to it.
 */
async function syncImages({
    tx,
    exerciseId,
    images,
}: {
    tx: Tx;
    exerciseId: string;
    images: StagedImage[];
}): Promise<{ changed: boolean; staleKeys: string[] }> {
    const current = await tx
        .select({
            storageKey: exerciseGuideImages.storageKey,
            caption: exerciseGuideImages.caption,
            position: exerciseGuideImages.position,
        })
        .from(exerciseGuideImages)
        .where(eq(exerciseGuideImages.exerciseId, exerciseId))
        .orderBy(exerciseGuideImages.position);

    const desired = imageRows({ exerciseId, images });
    const comparable = desired.map(({ storageKey, caption, position }) => ({ storageKey, caption, position }));

    if (JSON.stringify(current) === JSON.stringify(comparable)) return { changed: false, staleKeys: [] };

    const wantedKeys = new Set(images.map((image) => image.storageKey));
    const staleKeys = [...new Set(current.map((row) => row.storageKey))].filter((key) => !wantedKeys.has(key));

    await tx.delete(exerciseGuideImages).where(eq(exerciseGuideImages.exerciseId, exerciseId));
    if (desired.length > 0) await tx.insert(exerciseGuideImages).values(desired);

    return { changed: true, staleKeys };
}
