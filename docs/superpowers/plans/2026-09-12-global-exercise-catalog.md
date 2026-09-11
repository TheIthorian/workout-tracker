# Global Exercise Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make exercises first-party catalog content shared by every workspace — read by all, written only by a repository-seeded command — while keeping workspace-private custom exercises alongside.

**Architecture:** One `exercises` table where `workspace_id IS NULL` marks a catalog row. Reads go through a new read-only `scopedToWorkspaceOrGlobal` helper; every write keeps the strict `scopedToWorkspace`, so a workspace route can never touch a catalog row. Catalog content lives as JSON + images under `content/exercises/`, validated by a new `packages/catalog` loader and published by `apps/admin seed-exercises` through a `CatalogSeedService`. Catalog images are uploaded to object storage under content-addressed keys and served by a CDN (MinIO anonymous prefix locally) from a `CATALOG_IMAGE_BASE_URL`; the API never streams them. The exercise-guide image upload routes are removed; the service and storage code behind them stays.

**Tech Stack:** TypeScript, NestJS + Fastify, Drizzle + Postgres, Zod, vitest + testcontainers (Postgres, MinIO), commander, React + Vite + Tailwind + shadcn/ui, S3/MinIO via `@app/storage`.

**Spec:** `docs/superpowers/specs/2026-09-12-global-exercise-catalog-design.md` (supersedes the exercise-library sections of `docs/superpowers/specs/2026-09-10-workout-tracker-phase-1-design.md`).

## Global Constraints

- **Never use `any`** — not in source, not in tests, no `oxlint-disable` for it. Where a cast is unavoidable use `as unknown as X`.
- **`type` over `interface`** unless a class implements it.
- **`enum` for closed sets of values** — a TypeScript enum, read by Zod via `z.enum(MyEnum)`.
- **Explicit return type on every function and method.**
- **Object arguments** when a function takes two or more parameters.
- **JSDoc on every public method and exported function.** Concise.
- **Comments explain why, never what**, and never describe the change being made.
- **Helpers are declared after their caller.**
- **Never `throw new Error(...)`** — always a typed error from `@app/errors`.
- **Every workspace-scoped WRITE uses `scopedToWorkspace(table, workspaceId, ...filters)`.** Reads that must include catalog rows use `scopedToWorkspaceOrGlobal`. Never a hand-written `eq(table.workspaceId, id)` alongside other filters.
- **Every service method calls `membership.require({ userId, workspaceId })` before its query.**
- **A caller who may not see a workspace gets `EntityNotFoundError` (404), never 403.** A write aimed at a catalog id through a workspace route is also a 404.
- **Libraries never read `process.env`.** `packages/catalog` reads the filesystem, never the environment.
- **Exact dependency versions** — `pnpm add --save-exact` inside the workspace that needs it.
- **Formatting:** 4-space indent, single quotes, 120 cols, trailing commas. Run `pnpm format` before each commit.
- **Blank line before and after every log statement, and after a closing scope brace.**
- **Migrations:** `pnpm --filter @app/db db:generate` after any schema change; read the SQL before committing; never a `DROP TABLE` / `DROP COLUMN` here.
- **Commits:** Conventional Commits, ending with the attribution lines the session provides.

## Ordering note

Tasks 1–7 are additive and leave every existing test green. Task 8 changes the wire contract and the API together (removing the image routes and `exerciseImageContentPath`); Tasks 9–10 bring web and MCP to the new contract; Task 11 is infrastructure, content and docs. Run `pnpm typecheck` at the end of every task — `tsc -b` covers every project reference, so a contract change that breaks a consumer shows up there.

---

### Task 1: Schema + `scopedToWorkspaceOrGlobal`

**Files:**
- Modify: `packages/db/src/schema/exercises.ts`
- Create: `packages/db/drizzle/0003_<generated>.sql` (generated)
- Modify: `packages/db/drizzle/meta/*` (generated)
- Modify: `packages/db/src/scoping.ts`
- Modify: `packages/db/src/scoping.spec.ts`
- Modify: `CLAUDE.md` (Multi-tenancy section)

**Interfaces:**
- Produces: `exercises.workspaceId: uuid | null`, `exercises.slug: text | null`, `exerciseGuideImages.workspaceId: uuid | null`, `exerciseLinks.workspaceId: uuid | null`.
- Produces: `scopedToWorkspaceOrGlobal<T extends SharedOrWorkspaceOwnedTable>(table: T, workspaceId: string, ...filters: Array<SQL | undefined>): SQL` and `type SharedOrWorkspaceOwnedTable = { workspaceId: PgColumn }`, both exported from `@app/db`.

The schema and the helper land together because the helper's test needs a table that can hold a null `workspace_id`, and `pnpm typecheck` covers spec files.

- [ ] **Step 1: Edit the schema**

In `packages/db/src/schema/exercises.ts`:

Add `check` and `uniqueIndex` to the `drizzle-orm/pg-core` import.

Replace the `exercises` table's doc comment and column block with:

```ts
/**
 * The exercise library: catalog exercises shared by every workspace, and each workspace's own
 * custom ones. `workspace_id IS NULL` marks a catalog row; `slug` is the seed's stable key for it.
 *
 * The `guide_*` fields sit here rather than in a one-to-one child table: they are a fixed, short
 * set read at a glance mid-workout, and a separate table would buy nothing but a join.
 *
 * Exercises are archived rather than deleted, because past sessions reference them and history
 * must not lose the name of what was trained.
 */
export const exercises = pgTable(
    'exercises',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id'),
        slug: text('slug'),
        createdByUserId: uuid('created_by_user_id'),
        name: text('name').notNull(),
        trackingType: trackingTypeEnum('tracking_type').notNull(),
        notes: text('notes'),
        guideSetup: text('guide_setup'),
        guideExecution: text('guide_execution'),
        guideCues: text('guide_cues'),
        guideMistakes: text('guide_mistakes'),
        archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('exercises_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        uniqueIndex('exercises_catalog_slug_uidx')
            .on(table.slug)
            .where(sql`${table.workspaceId} is null`),
        // A catalog row always has a slug and a custom row never does, so the two kinds cannot blur.
        check('exercises_catalog_slug_check', sql`(${table.workspaceId} is null) = (${table.slug} is not null)`),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'exercises_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.createdByUserId],
            foreignColumns: [user.id],
            name: 'exercises_created_by_user_id_user_id_fk',
        }).onDelete('set null'),
    ],
);
```

In `exerciseGuideImages` and `exerciseLinks`, change `workspaceId: uuid('workspace_id').notNull(),` to `workspaceId: uuid('workspace_id'),`. Update each table's doc comment to say `workspace_id` is null on a catalog exercise's rows and always matches the parent exercise's; e.g. for images:

```ts
/**
 * An image belonging to an exercise's guide. The bytes live in object storage under `storage_key`.
 * `workspace_id` mirrors the parent exercise's, null included, so the same scoping helper reads both.
 */
```

- [ ] **Step 2: Generate the migration and read it**

Run: `pnpm --filter @app/db db:generate`

Open the new `packages/db/drizzle/0003_*.sql`. It must contain only:

- `ALTER TABLE "exercises" ALTER COLUMN "workspace_id" DROP NOT NULL;`
- `ALTER TABLE "exercise_guide_images" ALTER COLUMN "workspace_id" DROP NOT NULL;`
- `ALTER TABLE "exercise_links" ALTER COLUMN "workspace_id" DROP NOT NULL;`
- `ALTER TABLE "exercises" ADD COLUMN "slug" text;`
- `CREATE UNIQUE INDEX "exercises_catalog_slug_uidx" ON "exercises" USING btree ("slug") WHERE "exercises"."workspace_id" is null;`
- `ALTER TABLE "exercises" ADD CONSTRAINT "exercises_catalog_slug_check" CHECK (...)`

If there is any `DROP TABLE`, `DROP COLUMN`, or `DROP CONSTRAINT` on a foreign key, stop and fix the schema edit rather than the SQL.

- [ ] **Step 3: Write the failing tests**

`scoping.spec.ts` seeds `items`, which has a `NOT NULL` `workspace_id`, so it cannot hold a shared row. Add a second describe that uses `exercises`, now nullable. Append to `packages/db/src/scoping.spec.ts`:

```ts
import { exercises } from './schema/exercises.js';
import { scopedToWorkspaceOrGlobal } from './scoping.js';

describe('scopedToWorkspaceOrGlobal', () => {
    beforeAll(async () => {
        await db.insert(exercises).values([
            { workspaceId, name: 'ours', trackingType: 'weight_reps' },
            { workspaceId: otherWorkspaceId, name: 'theirs', trackingType: 'weight_reps' },
            { workspaceId: null, slug: 'shared-row', name: 'shared', trackingType: 'weight_reps' },
        ]);
    });

    it("returns the named workspace's rows and the shared rows, never another workspace's", async () => {
        const rows = await db.select().from(exercises).where(scopedToWorkspaceOrGlobal(exercises, workspaceId));

        expect(rows.map((row) => row.name).sort()).toEqual(['ours', 'shared']);
    });

    it('ANDs further filters onto the tenant-or-shared filter rather than replacing it', async () => {
        const rows = await db
            .select()
            .from(exercises)
            .where(scopedToWorkspaceOrGlobal(exercises, workspaceId, eq(exercises.name, 'theirs')));

        expect(rows).toEqual([]);
    });

    it('ignores undefined filters', async () => {
        const rows = await db
            .select()
            .from(exercises)
            .where(scopedToWorkspaceOrGlobal(exercises, workspaceId, undefined, eq(exercises.name, 'shared')));

        expect(rows.map((row) => row.name)).toEqual(['shared']);
    });
});
```

Merge the new imports into the existing import lines at the top of the file (`eq` is already imported; add `exercises` and `scopedToWorkspaceOrGlobal`).

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @app/db test -- scoping`
Expected: FAIL — `scopedToWorkspaceOrGlobal` is not exported.

- [ ] **Step 5: Implement the helper**

Append to `packages/db/src/scoping.ts` (add `isNull` and `or` to the `drizzle-orm` import):

```ts
/**
 * A table whose rows are either owned by one workspace or shared with every workspace. The shape is
 * the same as `WorkspaceOwnedTable`; the name records that `workspaceId` may be null.
 */
export type SharedOrWorkspaceOwnedTable = { workspaceId: PgColumn };

/**
 * READ-ONLY counterpart of `scopedToWorkspace`: admits rows shared with every workspace
 * (`workspace_id IS NULL`) alongside the caller's own.
 *
 * Never pass this to an `update` or `delete`. A shared row is content every tenant reads and no
 * tenant may change; a write scoped with this helper would let any workspace member alter it.
 * Writes keep `scopedToWorkspace`, so a shared row's id through a workspace route finds nothing and
 * yields the same not-found as a row in another workspace.
 */
export function scopedToWorkspaceOrGlobal<T extends SharedOrWorkspaceOwnedTable>(
    table: T,
    workspaceId: string,
    ...filters: Array<SQL | undefined>
): SQL {
    return and(or(eq(table.workspaceId, workspaceId), isNull(table.workspaceId)), ...filters)!;
}
```

- [ ] **Step 6: Run the db tests**

Run: `pnpm --filter @app/db test`
Expected: PASS (the fixture applies the committed migrations, so the null insert succeeds).

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. `ExercisesService` and `ExerciseGuideService` still insert `workspaceId: string`, which is assignable to the now-nullable column.

- [ ] **Step 8: Document the rule**

In `CLAUDE.md`, under "Multi-tenancy — read this before writing any query", after the paragraph beginning "**Never write `eq(table.workspaceId, id)` by hand**", add:

```markdown
**Catalog rows are shared, read-only content.** A row whose `workspace_id` is `NULL` (today: the
exercise catalog) is visible to every workspace. Read it with `scopedToWorkspaceOrGlobal`, which
admits those rows alongside the caller's own. **Never use that helper on a write.** Every
`update`/`delete` keeps `scopedToWorkspace`, so a catalog id through a workspace route finds no row
and returns the same 404 as another tenant's row. Only the seed command (`apps/admin
seed-exercises`) writes catalog rows.
```

- [ ] **Step 9: Commit**

```bash
pnpm format
git add packages/db CLAUDE.md
git commit -m "feat(db): allow shared catalog exercises and add the read-only scopedToWorkspaceOrGlobal helper"
```

---

### Task 2: `StorageService.fileExists`

**Files:**
- Modify: `packages/storage/src/s3-storage.ts`
- Modify: `packages/storage/src/s3-storage.spec.ts`

**Interfaces:**
- Produces: `StorageService.fileExists(key: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Add to the `describe('StorageService', …)` block in `packages/storage/src/s3-storage.spec.ts`:

```ts
    it('fileExists is true for an uploaded key and false for a missing one', async () => {
        const key = `exists-${randomBytes(4).toString('hex')}.txt`;
        await service.uploadFileAtKey({ fileStream: Buffer.from('hi'), key, contentType: 'text/plain' });

        expect(await service.fileExists(key)).toBe(true);
        expect(await service.fileExists(`missing-${key}`)).toBe(false);
    });

    it('fileExists throws (not false) when the bucket itself does not exist', async () => {
        await expect(wrongBucketService.fileExists('anything')).rejects.toThrow();
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @app/storage test`
Expected: FAIL — `service.fileExists is not a function`.

- [ ] **Step 3: Implement**

Add `HeadObjectCommand` to the `@aws-sdk/client-s3` import in `s3-storage.ts`. Insert after `tryDownloadFile`:

```ts
    /**
     * Whether an object exists at the key, without fetching its bytes. A missing bucket still
     * throws, for the same reason `tryDownloadFile` does not swallow it.
     */
    async fileExists(key: string): Promise<boolean> {
        try {
            await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return true;
        } catch (error) {
            if (isNotFoundError(error)) {
                return false;
            }
            throw error;
        }
    }
```

Check `isNotFoundError` at the bottom of the file: `HeadObject` answers a missing key with a bare 404 whose `name` is `NotFound` rather than `NoSuchKey`. If `isNotFoundError` only matches `NoSuchKey`, extend it to also return `true` when `error instanceof Error && error.name === 'NotFound'` — keep the bucket-missing distinction it already draws (read its doc comment before editing).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @app/storage test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/storage
git commit -m "feat(storage): add fileExists"
```

---

### Task 3: `ExercisesService` reads catalog rows, writes stay strict

**Files:**
- Modify: `packages/services/src/exercises.service.ts`
- Modify: `packages/services/src/exercises.service.spec.ts`
- Modify: `packages/services/src/testing.ts`

**Interfaces:**
- Consumes: `scopedToWorkspaceOrGlobal` (Task 1).
- Produces: `ExerciseSummary` gains `isCatalog: boolean` and `slug: string | null`; `seedCatalogExercise(db, { slug, name?, trackingType? }): Promise<string>` in `testing.ts`.

- [ ] **Step 1: Add the test seed helper**

Append to `packages/services/src/testing.ts` (add `exercises` to the destructured `schema` and import `TrackingType` from `@app/domain`):

```ts
/** Inserts a catalog exercise (no workspace) directly. Returns its id. */
export async function seedCatalogExercise(
    db: Db,
    params: { slug: string; name?: string; trackingType?: TrackingType },
): Promise<string> {
    const [row] = await db
        .insert(exercises)
        .values({
            workspaceId: null,
            slug: params.slug,
            name: params.name ?? params.slug,
            trackingType: params.trackingType ?? TrackingType.WeightReps,
        })
        .returning({ id: exercises.id });

    return row.id;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/services/src/exercises.service.spec.ts` (add `seedCatalogExercise` to the `./testing.js` import, and `schema` + `eq` imports: `import { schema, type Db } from '@app/db'; import { eq } from 'drizzle-orm';`):

```ts
describe('catalog exercises', () => {
    it('lists and reads a catalog exercise from any workspace, marked as catalog', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}`, name: 'Catalog Squat' });

        const listed = await exercises.list({ userId, workspaceId, ...page });
        expect(listed.data.find((row) => row.id === catalogId)).toMatchObject({
            name: 'Catalog Squat',
            isCatalog: true,
        });

        const detail = await exercises.get({ userId, workspaceId, exerciseId: catalogId });
        expect(detail).toMatchObject({ id: catalogId, isCatalog: true, images: [], links: [] });
        expect(detail.slug).toMatch(/^catalog-/);
    });

    it('marks a custom exercise as not catalog', async () => {
        const custom = await exercises.create({
            userId,
            workspaceId,
            name: 'My Machine',
            trackingType: TrackingType.WeightReps,
        });

        expect(custom).toMatchObject({ isCatalog: false, slug: null });
    });

    it('refuses to update or archive a catalog exercise through a workspace, and leaves it unchanged', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}`, name: 'Untouchable' });

        await expect(
            exercises.update({ userId, workspaceId, exerciseId: catalogId, name: 'Vandalised' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            exercises.update({ userId, workspaceId, exerciseId: catalogId, archived: true }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        const [row] = await db
            .select({ name: schema.exercises.name, archivedAt: schema.exercises.archivedAt })
            .from(schema.exercises)
            .where(eq(schema.exercises.id, catalogId));
        expect(row).toEqual({ name: 'Untouchable', archivedAt: null });
    });

    it('still refuses a workspace the caller does not belong to, even for a catalog id', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });

        await expect(
            exercises.get({ userId, workspaceId: otherWorkspaceId, exerciseId: catalogId }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});
```

The bare `eq(schema.exercises.id, …)` in the assertion is a test reading a row by primary key to prove it was not written — it is not a tenant-scoped query and does not need the helper.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @app/services test -- exercises.service`
Expected: FAIL — `isCatalog` is undefined on the summary, and `get` on a catalog id throws not-found.

- [ ] **Step 4: Implement**

In `packages/services/src/exercises.service.ts`:

Import: `import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, type Db } from '@app/db';` and add `sql` to the `drizzle-orm` import.

Extend `ExerciseSummary`:

```ts
export type ExerciseSummary = {
    id: string;
    name: string;
    slug: string | null;
    isCatalog: boolean;
    trackingType: TrackingType;
    notes: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};
```

Replace the class doc comment:

```ts
/**
 * The exercise library a workspace sees: the shared catalog plus its own custom exercises.
 *
 * Reads admit catalog rows; writes are scoped strictly to the workspace, so a catalog id through
 * `update` is a not-found rather than an edit of shared content.
 *
 * Images are returned as storage keys rather than URLs: turning a key into a URL needs
 * deployment configuration, which belongs to the app, not to a package.
 */
```

In `list`, change `scopedToWorkspace(` to `scopedToWorkspaceOrGlobal(` and the order to `.orderBy(asc(exercises.name), desc(exercises.createdAt))`. Update the `list` doc's first line to "A page of the exercises the workspace can see — catalog and custom — by name."

In `loadDetail`, change all three `scopedToWorkspace(` calls to `scopedToWorkspaceOrGlobal(`. `update` keeps `scopedToWorkspace`.

Replace the column constants:

```ts
const EXERCISE_SUMMARY_COLUMNS = {
    id: exercises.id,
    name: exercises.name,
    slug: exercises.slug,
    isCatalog: sql<boolean>`${exercises.workspaceId} is null`,
    trackingType: exercises.trackingType,
    notes: exercises.notes,
    archivedAt: exercises.archivedAt,
    createdAt: exercises.createdAt,
    updatedAt: exercises.updatedAt,
};
```

`EXERCISE_DETAIL_COLUMNS` is unchanged (it spreads the summary).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @app/services test -- exercises.service`
Expected: PASS. If the existing `list` test named "returns only this workspace's exercises, newest first" fails on ordering, update its expectation to name order and rename it "returns this workspace's exercises by name" — it seeds `first`/`second`, so `['first', 'second']` is now the expected order.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck` — PASS (the API's `toDetailResponse` spreads the service type, so the extra fields flow through; the contract catches up in Task 8).

```bash
pnpm format
git add packages/services
git commit -m "feat(services): exercises read the shared catalog, writes stay workspace-scoped"
```

---

### Task 4: `ExerciseGuideService` — catalog is read-only, image methods unrouted

**Files:**
- Modify: `packages/services/src/exercise-guide.service.ts`
- Modify: `packages/services/src/exercise-guide.service.spec.ts`

**Interfaces:**
- No signature changes. `addLink`, `updateLink`, `removeLink`, `addImage`, `removeImage`, `getImage` all keep strict scoping and throw `EntityNotFoundError` for a catalog exercise id.

- [ ] **Step 1: Write the failing tests**

Open `packages/services/src/exercise-guide.service.spec.ts`, note the names of its `ExerciseGuideService` instance (call it `guides` below; use whatever the file names it), and its `userId`/`workspaceId` fixtures. Add `seedCatalogExercise` to the `./testing.js` import and `randomUUID` from `node:crypto` if not already imported. Append:

```ts
describe('catalog exercises are read-only', () => {
    it('refuses to attach a link or image to a catalog exercise', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });

        await expect(
            guides.addLink({ userId, workspaceId, exerciseId: catalogId, url: 'https://example.com' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            guides.addImage({
                userId,
                workspaceId,
                exerciseId: catalogId,
                storageKey: 'never-written.png',
                contentType: 'image/png',
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses to remove a catalog link through a workspace', async () => {
        const catalogId = await seedCatalogExercise(db, { slug: `catalog-${randomUUID()}` });
        const [link] = await db
            .insert(schema.exerciseLinks)
            .values({ workspaceId: null, exerciseId: catalogId, url: 'https://example.com/keep', position: 0 })
            .returning({ id: schema.exerciseLinks.id });

        await expect(
            guides.removeLink({ userId, workspaceId, exerciseId: catalogId, linkId: link.id }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});
```

- [ ] **Step 2: Run to verify the second test fails**

Run: `pnpm --filter @app/services test -- exercise-guide.service`
Expected: the first test already passes (strict `requireExercise`), the second passes too. That is correct — the strict helper already does the job, and this test pins it so a later "helpful" switch to the OrGlobal helper fails loudly. Confirm both PASS.

- [ ] **Step 3: Mark the unrouted image methods**

In `exercise-guide.service.ts`, add one line to the doc comment of each of `addImage`, `getImage`, `removeImage`:

```ts
     * Not reachable from any route: exercise guide images are catalog content served from a CDN.
     * Kept for the next image-bearing feature.
```

Update the class doc's first line to: "Writes to a custom exercise's guide attachments — its external links and its image records. Catalog exercises are never written here; their slug-keyed rows come from `CatalogSeedService`."

- [ ] **Step 4: Run tests, commit**

Run: `pnpm --filter @app/services test -- exercise-guide.service` — PASS.

```bash
pnpm format
git add packages/services
git commit -m "test(services): pin catalog exercises as read-only through the guide service"
```

---

### Task 5: `packages/catalog` — file format schema and loader

**Files:**
- Create: `packages/catalog/package.json`
- Create: `packages/catalog/tsconfig.json`
- Create: `packages/catalog/tsconfig.build.json`
- Create: `packages/catalog/vitest.config.ts`
- Create: `packages/catalog/src/index.ts`
- Create: `packages/catalog/src/exercise-entry.ts`
- Create: `packages/catalog/src/load-catalog.ts`
- Create: `packages/catalog/src/load-catalog.spec.ts`
- Create: `packages/catalog/src/no-env-access.spec.ts`
- Create: `packages/catalog/fixtures/valid/barbell-back-squat/exercise.json`
- Create: `packages/catalog/fixtures/valid/barbell-back-squat/images/01-setup.png`
- Create: `packages/catalog/fixtures/valid/plank/exercise.json`
- Create: `packages/catalog/fixtures/bad-tracking-type/wobble/exercise.json`
- Create: `packages/catalog/fixtures/missing-image/ghost/exercise.json`
- Create: `packages/catalog/fixtures/bad-slug/Not_A_Slug/exercise.json`
- Modify: `tsconfig.json` (root; add reference)

**Interfaces:**
- Produces:
  - `exerciseEntrySchema` (Zod) and `type ExerciseEntry = { name: string; trackingType: TrackingType; notes: string | null; guide: { setup: string | null; execution: string | null; cues: string | null; mistakes: string | null }; links: { url: string; label: string | null }[]; images: { file: string; caption: string | null }[] }`
  - `type LoadedExercise = { slug: string; directory: string; entry: ExerciseEntry; images: { file: string; caption: string | null; path: string; contentType: string }[] }`
  - `loadCatalog({ dir }: { dir: string }): Promise<LoadedExercise[]>` — sorted by slug; throws `RequestValidationError` on the first invalid entry.
  - `CATALOG_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/`

- [ ] **Step 1: Scaffold the package**

`packages/catalog/package.json`:

```json
{
    "name": "@app/catalog",
    "version": "0.0.1",
    "private": true,
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "scripts": {
        "build": "tsc -p tsconfig.build.json",
        "dev": "tsc -p tsconfig.build.json --watch",
        "test": "vitest run",
        "lint": "oxlint .",
        "format": "oxfmt --config ../../.oxfmtrc.json ."
    },
    "dependencies": {
        "@app/domain": "workspace:*",
        "@app/errors": "workspace:*",
        "zod": "<copy the exact version packages/api-contract pins>"
    },
    "devDependencies": {
        "@app/tsconfig": "workspace:*",
        "@types/node": "26.2.0",
        "typescript": "6.0.3",
        "vitest": "4.1.10"
    }
}
```

Read `packages/api-contract/package.json` and copy its exact `zod` version into the placeholder.

`packages/catalog/tsconfig.json`:

```json
{
    "extends": "@app/tsconfig/base.json",
    "compilerOptions": {
        "outDir": "dist",
        "rootDir": "src",
        "types": ["node"],
        "composite": true
    },
    "include": ["src"],
    "references": [{ "path": "../domain" }, { "path": "../errors" }]
}
```

`packages/catalog/tsconfig.build.json`: `{ "extends": "./tsconfig.json", "exclude": ["src/**/*.spec.ts"] }`

`packages/catalog/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.spec.ts'],
    },
});
```

Add `{ "path": "./packages/catalog" }` to the root `tsconfig.json` `references` after `./packages/domain`.

Run `pnpm install` from the repo root (the lockfile gains the new workspace package; no external versions change).

- [ ] **Step 2: Create the fixtures**

`packages/catalog/fixtures/valid/barbell-back-squat/exercise.json`:

```json
{
    "name": "Barbell back squat",
    "trackingType": "weight_reps",
    "notes": null,
    "guide": {
        "setup": "Bar on the upper back, hands just outside the shoulders.",
        "execution": "Sit down between the hips, drive up through the whole foot.",
        "cues": "Big breath, brace, knees out.",
        "mistakes": "Heels rising; chest collapsing at the bottom."
    },
    "links": [{ "url": "https://example.com/squat", "label": "Form video" }],
    "images": [{ "file": "01-setup.png", "caption": "Bar position" }]
}
```

`packages/catalog/fixtures/valid/barbell-back-squat/images/01-setup.png` — write the one-pixel PNG. From the repo root:

```bash
mkdir -p packages/catalog/fixtures/valid/barbell-back-squat/images
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > packages/catalog/fixtures/valid/barbell-back-squat/images/01-setup.png
```

`packages/catalog/fixtures/valid/plank/exercise.json`:

```json
{
    "name": "Plank",
    "trackingType": "duration",
    "notes": "Bodyweight hold.",
    "guide": { "setup": "Forearms down, elbows under shoulders.", "execution": null, "cues": null, "mistakes": null },
    "links": [],
    "images": []
}
```

`packages/catalog/fixtures/bad-tracking-type/wobble/exercise.json`:

```json
{ "name": "Wobble", "trackingType": "vibes", "notes": null, "guide": {}, "links": [], "images": [] }
```

`packages/catalog/fixtures/missing-image/ghost/exercise.json`:

```json
{
    "name": "Ghost",
    "trackingType": "weight_reps",
    "notes": null,
    "guide": {},
    "links": [],
    "images": [{ "file": "nope.png", "caption": null }]
}
```

`packages/catalog/fixtures/bad-slug/Not_A_Slug/exercise.json`:

```json
{ "name": "Bad dir", "trackingType": "weight_reps", "notes": null, "guide": {}, "links": [], "images": [] }
```

- [ ] **Step 3: Write the failing tests**

`packages/catalog/src/load-catalog.spec.ts`:

```ts
import { join } from 'node:path';
import { TrackingType } from '@app/domain';
import { RequestValidationError } from '@app/errors';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from './load-catalog.js';

const fixtures = join(__dirname, '..', 'fixtures');

describe('loadCatalog', () => {
    it('loads every entry, sorted by slug, resolving image paths and content types', async () => {
        const loaded = await loadCatalog({ dir: join(fixtures, 'valid') });

        expect(loaded.map((entry) => entry.slug)).toEqual(['barbell-back-squat', 'plank']);

        const squat = loaded[0];
        expect(squat.entry).toMatchObject({
            name: 'Barbell back squat',
            trackingType: TrackingType.WeightReps,
            guide: { setup: expect.stringContaining('Bar on the upper back') },
            links: [{ url: 'https://example.com/squat', label: 'Form video' }],
        });
        expect(squat.images).toEqual([
            {
                file: '01-setup.png',
                caption: 'Bar position',
                path: join(fixtures, 'valid', 'barbell-back-squat', 'images', '01-setup.png'),
                contentType: 'image/png',
            },
        ]);

        const plank = loaded[1];
        expect(plank.entry.guide).toEqual({
            setup: 'Forearms down, elbows under shoulders.',
            execution: null,
            cues: null,
            mistakes: null,
        });
        expect(plank.images).toEqual([]);
    });

    it('rejects an unknown tracking type, naming the slug', async () => {
        await expect(loadCatalog({ dir: join(fixtures, 'bad-tracking-type') })).rejects.toThrow(
            RequestValidationError,
        );
        await expect(loadCatalog({ dir: join(fixtures, 'bad-tracking-type') })).rejects.toThrow(/wobble/);
    });

    it('rejects an image the file references but the directory lacks', async () => {
        await expect(loadCatalog({ dir: join(fixtures, 'missing-image') })).rejects.toThrow(/nope\.png/);
    });

    it('rejects a directory name that is not a slug', async () => {
        await expect(loadCatalog({ dir: join(fixtures, 'bad-slug') })).rejects.toThrow(/Not_A_Slug/);
    });

    it('rejects a directory that does not exist', async () => {
        await expect(loadCatalog({ dir: join(fixtures, 'nowhere') })).rejects.toThrow(RequestValidationError);
    });
});
```

`packages/catalog/src/no-env-access.spec.ts` — copy `packages/logger/src/no-env-access.spec.ts` verbatim and adjust only the directory it scans if that file hard-codes one (read it first).

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm --filter @app/catalog test`
Expected: FAIL — `./load-catalog.js` does not exist.

- [ ] **Step 5: Implement the schema**

`packages/catalog/src/exercise-entry.ts`:

```ts
import { TrackingType } from '@app/domain';
import { z } from 'zod';

/** The directory name of a catalog entry. Doubles as the row's slug, so it must be URL-safe. */
export const CATALOG_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const guideField = z.string().max(4000).nullable().default(null);

/** One `exercise.json`. Mirrors the limits `postExerciseRequestSchema` enforces on custom exercises. */
export const exerciseEntrySchema = z.object({
    name: z.string().min(1).max(200),
    trackingType: z.enum(TrackingType),
    notes: z.string().max(2000).nullable().default(null),
    guide: z
        .object({
            setup: guideField,
            execution: guideField,
            cues: guideField,
            mistakes: guideField,
        })
        .default({ setup: null, execution: null, cues: null, mistakes: null }),
    links: z
        .array(
            z.object({
                url: z.url().max(2000),
                label: z.string().max(200).nullable().default(null),
            }),
        )
        .default([]),
    images: z
        .array(
            z.object({
                file: z.string().min(1),
                caption: z.string().max(200).nullable().default(null),
            }),
        )
        .default([]),
});

export type ExerciseEntry = z.infer<typeof exerciseEntrySchema>;
```

- [ ] **Step 6: Implement the loader**

`packages/catalog/src/load-catalog.ts`:

```ts
import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { RequestValidationError } from '@app/errors';
import { CATALOG_SLUG_PATTERN, exerciseEntrySchema, type ExerciseEntry } from './exercise-entry.js';

/** An image referenced by an entry, resolved to a path on disk. */
export type LoadedImage = {
    file: string;
    caption: string | null;
    path: string;
    contentType: string;
};

/** One catalog directory, validated and ready to publish. */
export type LoadedExercise = {
    slug: string;
    directory: string;
    entry: ExerciseEntry;
    images: LoadedImage[];
};

const IMAGE_CONTENT_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};

/**
 * Reads every `<dir>/<slug>/exercise.json`, validates it, and confirms each referenced image exists.
 * Fails on the first bad entry so a typo in one file publishes nothing.
 *
 * @throws RequestValidationError naming the slug and the problem.
 */
export async function loadCatalog({ dir }: { dir: string }): Promise<LoadedExercise[]> {
    let names: string[];

    try {
        names = (await readdir(dir, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        throw new RequestValidationError(`Catalog directory not found: ${dir}`);
    }

    const loaded: LoadedExercise[] = [];

    for (const slug of names) {
        loaded.push(await loadEntry({ dir, slug }));
    }

    return loaded;
}

async function loadEntry({ dir, slug }: { dir: string; slug: string }): Promise<LoadedExercise> {
    if (!CATALOG_SLUG_PATTERN.test(slug)) {
        throw new RequestValidationError(`Catalog directory "${slug}" is not a valid slug (lowercase, digits, hyphens)`);
    }

    const directory = join(dir, slug);
    const entryPath = join(directory, 'exercise.json');

    let raw: unknown;

    try {
        raw = JSON.parse(await readFile(entryPath, 'utf8'));
    } catch (error) {
        throw new RequestValidationError(`${slug}: cannot read ${entryPath}: ${describe(error)}`);
    }

    const parsed = exerciseEntrySchema.safeParse(raw);

    if (!parsed.success) {
        throw new RequestValidationError(`${slug}: invalid exercise.json: ${parsed.error.message}`);
    }

    const images: LoadedImage[] = [];

    for (const image of parsed.data.images) {
        const contentType = IMAGE_CONTENT_TYPES[extname(image.file).toLowerCase()];

        if (!contentType) {
            throw new RequestValidationError(`${slug}: image "${image.file}" must be .png, .jpg, .jpeg or .webp`);
        }

        const path = join(directory, 'images', image.file);

        try {
            await access(path);
        } catch {
            throw new RequestValidationError(`${slug}: image "${image.file}" not found at ${path}`);
        }

        images.push({ file: image.file, caption: image.caption, path, contentType });
    }

    return { slug, directory, entry: parsed.data, images };
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
```

Check `RequestValidationError`'s constructor signature in `packages/errors/src` before relying on a single-string call; adapt if it takes an object.

`packages/catalog/src/index.ts`:

```ts
export { CATALOG_SLUG_PATTERN, exerciseEntrySchema, type ExerciseEntry } from './exercise-entry.js';
export { loadCatalog, type LoadedExercise, type LoadedImage } from './load-catalog.js';
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @app/catalog test`
Expected: PASS.

- [ ] **Step 8: Build, typecheck, commit**

Run: `pnpm --filter @app/catalog build && pnpm typecheck` — PASS.

```bash
pnpm format
git add packages/catalog tsconfig.json pnpm-lock.yaml
git commit -m "feat(catalog): add the exercise content file format and loader"
```

---

### Task 6: `CatalogSeedService`

**Files:**
- Create: `packages/services/src/catalog-seed.service.ts`
- Create: `packages/services/src/catalog-seed.service.spec.ts`
- Modify: `packages/services/src/index.ts`
- Modify: `packages/services/package.json` (add `@app/catalog`, `@app/storage` dependencies)
- Modify: `packages/services/tsconfig.json` (add references)

**Interfaces:**
- Consumes: `LoadedExercise` (Task 5), `StorageService.fileExists/uploadFileAtKey/deleteFile` (Task 2), `withTransaction` from `@app/db`.
- Produces:
  - `type SeedOutcome = 'created' | 'updated' | 'unchanged'` — as an enum `SeedOutcome { Created = 'created', Updated = 'updated', Unchanged = 'unchanged' }`.
  - `CatalogSeedService.upsertExercise({ exercise: LoadedExercise }): Promise<{ id: string; outcome: SeedOutcome }>`
  - `CatalogSeedService.archiveMissing({ presentSlugs: string[] }): Promise<string[]>` — returns the slugs archived.
  - `catalogImageKey({ slug, sha256, extension }): string` → `catalog/<slug>/<sha256><extension>`.

- [ ] **Step 1: Wire the dependencies**

```bash
cd packages/services
pnpm add --save-exact @app/catalog@workspace:* @app/storage@workspace:*
```

If `pnpm add` refuses the `workspace:*` form, edit `package.json` by hand: add `"@app/catalog": "workspace:*"` and `"@app/storage": "workspace:*"` under `dependencies`, and remove `@app/logger` from `devDependencies` only if it is now pulled in transitively — otherwise leave it. Run `pnpm install` at the root.

In `packages/services/tsconfig.json` add `{ "path": "../catalog" }` and `{ "path": "../storage" }` to `references`.

- [ ] **Step 2: Write the failing tests**

`packages/services/src/catalog-seed.service.spec.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
    const { mkdir } = await import('node:fs/promises');
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
        expect(links).toEqual([expect.objectContaining({ workspaceId: null, url: 'https://example.com/a', position: 0 })]);

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

        const images = await db.select().from(exerciseGuideImages).where(eq(exerciseGuideImages.exerciseId, created.id));
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
```

`mkdtemp` and `writeFile` come from `node:fs/promises`; import `mkdir` in the same import line rather than the dynamic import shown (write it as a normal import: `import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';` and delete the `await import` line).

Add `testcontainers` and `@aws-sdk/client-s3` to `packages/services` `devDependencies` if they are not already there (`testcontainers` is; check `@aws-sdk/client-s3` — copy the exact version from `packages/storage/package.json`).

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @app/services test -- catalog-seed`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`packages/services/src/catalog-seed.service.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { LoadedExercise } from '@app/catalog';
import { schema, withTransaction, type Db, type Tx } from '@app/db';
import type { StorageService } from '@app/storage';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';

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
                if (images.length > 0) await tx.insert(exerciseGuideImages).values(imageRows({ exerciseId: created.id, images }));

                return { id: created.id, outcome: SeedOutcome.Created, staleKeys: [] };
            }

            const changed = await syncRow({ tx, id: existing.id, desired });
            const linksChanged = await syncLinks({ tx, exerciseId: existing.id, exercise });
            const { changed: imagesChanged, staleKeys } = await syncImages({ tx, exerciseId: existing.id, images });

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
        const rows = await this.db
            .update(exercises)
            .set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
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
                await this.storage.uploadFileAtKey({ fileStream: bytes, key: storageKey, contentType: image.contentType });
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
 * Diffs by storage key: a row whose key is still wanted is updated in place (caption, position),
 * a row whose key is gone is deleted and its key reported so the object can be removed after
 * commit, and a new key is inserted.
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
            id: exerciseGuideImages.id,
            storageKey: exerciseGuideImages.storageKey,
            caption: exerciseGuideImages.caption,
            position: exerciseGuideImages.position,
        })
        .from(exerciseGuideImages)
        .where(eq(exerciseGuideImages.exerciseId, exerciseId));

    const wantedKeys = new Set(images.map((image) => image.storageKey));
    const stale = current.filter((row) => !wantedKeys.has(row.storageKey));
    let changed = false;

    if (stale.length > 0) {
        await tx.delete(exerciseGuideImages).where(
            inArray(
                exerciseGuideImages.id,
                stale.map((row) => row.id),
            ),
        );
        changed = true;
    }

    for (const image of images) {
        const existing = current.find((row) => row.storageKey === image.storageKey);

        if (!existing) {
            await tx.insert(exerciseGuideImages).values(imageRows({ exerciseId, images: [image] }));
            changed = true;
            continue;
        }

        if (existing.caption !== image.caption || existing.position !== image.position) {
            await tx
                .update(exerciseGuideImages)
                .set({ caption: image.caption, position: image.position })
                .where(eq(exerciseGuideImages.id, existing.id));
            changed = true;
        }
    }

    // A key still wanted by another row of this exercise is not stale (two entries, same bytes).
    const staleKeys = stale.map((row) => row.storageKey).filter((key) => !wantedKeys.has(key));

    return { changed, staleKeys };
}
```

These queries use bare `eq`/`isNull` on `workspace_id` deliberately: this class is the catalog writer and has no tenant. Add this one-line comment above the first such query in `upsertExercise`:

```ts
            // Catalog rows have no tenant, so the tenant helpers do not apply: this is the one writer of rows whose workspace_id is null.
```

Export from `packages/services/src/index.ts`:

```ts
export { CatalogSeedService, SeedOutcome, catalogImageKey } from './catalog-seed.service.js';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @app/services test -- catalog-seed`
Expected: PASS. If `syncRow`'s JSON comparison fails on key order, build `current` and `comparable` with the same key order (they are written in the same order above; keep it that way).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck` — PASS.

```bash
pnpm format
git add packages/services pnpm-lock.yaml
git commit -m "feat(services): add CatalogSeedService for publishing catalog exercises"
```

---

### Task 7: `apps/admin seed-exercises`

**Files:**
- Create: `apps/admin/src/commands/seed-exercises.ts`
- Create: `apps/admin/src/commands/seed-exercises.spec.ts`
- Modify: `apps/admin/src/env.ts`
- Modify: `apps/admin/src/main.ts`
- Modify: `apps/admin/package.json` (add `@app/catalog`, `@app/services`, `@app/storage`, `@app/logger`)
- Modify: `apps/admin/tsconfig.json` (references)
- Modify: `apps/admin/.env.example` (if present; else `apps/admin/README.md` env table — check which exists)

**Interfaces:**
- Consumes: `loadCatalog` (Task 5), `CatalogSeedService`, `SeedOutcome` (Task 6), `StorageService`.
- Produces: `seedExercises({ db, storage, dir }): Promise<SeedReport>` where `type SeedReport = { results: { slug: string; outcome: SeedOutcome }[]; archived: string[] }`; `formatSeedReport(report): string[]`; `getStorageConfig(): StorageServiceConfig` in `env.ts`.

- [ ] **Step 1: Wire dependencies**

Edit `apps/admin/package.json` `dependencies` to add `"@app/catalog": "workspace:*"`, `"@app/logger": "workspace:*"`, `"@app/services": "workspace:*"`, `"@app/storage": "workspace:*"`. Add references `../../packages/catalog`, `../../packages/logger`, `../../packages/services`, `../../packages/storage` to `apps/admin/tsconfig.json`. Add `"@aws-sdk/client-s3"` (exact version from `packages/storage/package.json`) to `devDependencies`. Run `pnpm install`.

- [ ] **Step 2: Env — storage config**

In `apps/admin/src/env.ts`, extend the Joi schema:

```ts
    // Optional at the schema level for the same reason as AUTH_SECRET: only `seed-exercises`
    // needs object storage. `getStorageConfig` is what makes that one command refuse.
    S3_ENDPOINT: Joi.string().optional(),
    S3_REGION: Joi.string().default('us-east-1'),
    S3_BUCKET: Joi.string().optional(),
    S3_ACCESS_KEY_ID: Joi.string().optional(),
    S3_SECRET_ACCESS_KEY: Joi.string().optional(),
    S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
```

Append:

```ts
/**
 * The bucket `seed-exercises` uploads catalog images to. Must be the same bucket `apps/api`'s
 * `S3_BUCKET` names, or the URLs the API hands out point at objects that were never written.
 *
 * @throws ConfigurationError when the bucket or its credentials are missing.
 */
export function getStorageConfig(): StorageServiceConfig {
    const env = envLoader.loadEnv();
    const bucket = env['S3_BUCKET'];
    const accessKeyId = env['S3_ACCESS_KEY_ID'];
    const secretAccessKey = env['S3_SECRET_ACCESS_KEY'];

    if (typeof bucket !== 'string' || typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
        throw new ConfigurationError('S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required.');
    }

    const endpoint = env['S3_ENDPOINT'];

    return {
        ...(typeof endpoint === 'string' && endpoint.length > 0 ? { endpoint } : {}),
        region: String(env['S3_REGION']),
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle: Boolean(env['S3_FORCE_PATH_STYLE']),
    };
}
```

Import `type StorageServiceConfig` from `@app/storage`.

- [ ] **Step 3: Write the failing test**

`apps/admin/src/commands/seed-exercises.spec.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { RequestValidationError } from '@app/errors';
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
let minio: StartedTestContainer;
let storage: StorageService;

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
        bucket: 'admin-seed-test',
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
        logger: createLogger({ context: 'admin-seed-test', config: { level: 'error', pretty: false, redact: false } }),
    });
});

afterAll(async () => {
    await database?.stop();
    await minio?.stop();
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
        const dir = await writeTree({ 'admin-good': entry('Good'), 'admin-bad': { name: 'Bad', trackingType: 'vibes' } });

        await expect(seedExercises({ db, storage, dir })).rejects.toBeInstanceOf(RequestValidationError);

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
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @app/admin test -- seed-exercises`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the command**

`apps/admin/src/commands/seed-exercises.ts`:

```ts
import { loadCatalog } from '@app/catalog';
import type { Db } from '@app/db';
import { CatalogSeedService, type SeedOutcome } from '@app/services';
import type { StorageService } from '@app/storage';

export type SeedReport = {
    results: { slug: string; outcome: SeedOutcome }[];
    archived: string[];
};

/**
 * Publishes the content directory into the catalog: every entry is upserted, then any catalog
 * exercise no longer present is archived. The whole directory is loaded and validated before the
 * first write, so one bad file publishes nothing.
 *
 * @throws RequestValidationError from the loader when an entry is malformed.
 */
export async function seedExercises({
    db,
    storage,
    dir,
}: {
    db: Db;
    storage: StorageService;
    dir: string;
}): Promise<SeedReport> {
    const loaded = await loadCatalog({ dir });
    const seed = new CatalogSeedService({ db, storage });
    const results: SeedReport['results'] = [];

    for (const exercise of loaded) {
        const { outcome } = await seed.upsertExercise({ exercise });
        results.push({ slug: exercise.slug, outcome });
    }

    const archived = await seed.archiveMissing({ presentSlugs: loaded.map((exercise) => exercise.slug) });

    return { results, archived };
}

/** One line per exercise, outcome first so a scan down the left edge shows what changed. */
export function formatSeedReport(report: SeedReport): string[] {
    return [
        ...report.results.map(({ slug, outcome }) => `${outcome.padEnd(10)} ${slug}`),
        ...report.archived.map((slug) => `${'archived'.padEnd(10)} ${slug}`),
    ];
}
```

In `apps/admin/src/main.ts`:

```ts
import { createLogger } from '@app/logger';
import { StorageService } from '@app/storage';
import { formatSeedReport, seedExercises } from './commands/seed-exercises.js';
import { getAuthConfig, getDatabaseUrl, getStorageConfig } from './env.js';

type SeedExercisesOptions = { dir: string };
```

Add the command after `create-user`:

```ts
    program
        .command('seed-exercises')
        .description('Publish content/exercises into the shared catalog. Requires the S3_* variables.')
        .option('--dir <path>', 'Content directory', 'content/exercises')
        .action(async (options: SeedExercisesOptions) => {
            await runSeedExercises(options);
        });
```

And the runner (after `runCreateUser`):

```ts
async function runSeedExercises(options: SeedExercisesOptions): Promise<void> {
    const storageConfig = getStorageConfig();
    const storage = new StorageService({
        config: storageConfig,
        logger: createLogger({ context: 'admin', config: { level: 'warn', pretty: true, redact: true } }),
    });

    const { db, close } = createDb({ config: { connectionString: getDatabaseUrl() } });
    try {
        console.log(formatSeedReport(await seedExercises({ db, storage, dir: options.dir })).join('\n'));
    } finally {
        await close();
    }
}
```

Check `createLogger`'s config type in `packages/logger` and match it exactly.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @app/admin test`
Expected: PASS (both the new spec and `main.spec.ts`).

- [ ] **Step 7: Document the env**

If `apps/admin/.env.example` exists, add the `S3_*` block copied from `apps/api/.env.example` with the comment "Only `seed-exercises` needs these; they must match `apps/api`'s." If instead `apps/admin/README.md` lists variables, add the same rows there.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck` — PASS.

```bash
pnpm format
git add apps/admin pnpm-lock.yaml
git commit -m "feat(admin): add seed-exercises command"
```

---

### Task 8: Contract + API — `isCatalog`, absolute image URLs, image routes removed

**Files:**
- Modify: `packages/api-contract/src/exercise.contract.ts`
- Modify: `packages/api-contract/src/resource-paths.ts`
- Modify: `packages/api-contract/src/exercise.contract.spec.ts`
- Delete: `apps/api/src/exercises/exercise-guide-images.controller.ts`
- Modify: `apps/api/src/exercises/exercises.module.ts`
- Modify: `apps/api/src/exercises/exercises.controller.ts`
- Modify: `apps/api/src/exercises/exercises.providers.ts`
- Modify: `apps/api/src/config/load-env.ts`
- Modify: `apps/api/src/config/load-env.spec.ts`
- Modify: `apps/api/src/providers.ts`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/test/harness.ts`
- Modify: `apps/api/test/exercise-guide.e2e.spec.ts`
- Modify: `apps/api/test/exercises.e2e.spec.ts`
- Modify: `.railway/railway.ts`

**Interfaces:**
- Produces: `exerciseResponseSchema` + `isCatalog: boolean`, `slug: string | null`. `exerciseGuideImageResponseSchema.url` is absolute. `CATALOG_IMAGE_BASE_URL` env (required). `CATALOG_IMAGE_BASE_URL` DI token in `apps/api/src/providers.ts`.
- Removes: `exerciseImageContentPath`, `exerciseImageCaptionSchema`, the three image routes.

- [ ] **Step 1: Contract**

In `packages/api-contract/src/exercise.contract.ts`:

- Delete `exerciseImageCaptionSchema` and its doc comment.
- Change `exerciseGuideImageResponseSchema.url` to `url: z.url()` with the doc comment `/** Absolute; served by the CDN in front of object storage, never by this API. */` on the `url` line.
- Extend `exerciseResponseSchema` after `name`:

```ts
    /** Set on catalog exercises; the seed's stable key. Null on a workspace's own exercise. */
    slug: z.string().nullable(),
    /** True for shared catalog content, which no workspace route may write. */
    isCatalog: z.boolean(),
```

In `packages/api-contract/src/resource-paths.ts`, delete `exerciseImageContentPath` and its doc comment.

In `exercise.contract.spec.ts`, add `isCatalog: false, slug: null` to any fixture that must satisfy `exerciseResponseSchema`, and a case:

```ts
    it('requires isCatalog and slug on a response', () => {
        const result = exerciseResponseSchema.safeParse({
            id: '11111111-1111-4111-8111-111111111111',
            name: 'x',
            trackingType: 'weight_reps',
            notes: null,
            archivedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        expect(result.success).toBe(false);
    });
```

Run `pnpm --filter @app/api-contract test` — PASS.

- [ ] **Step 2: Env and DI**

`apps/api/src/config/load-env.ts`, after `MCP_BASE_URL`:

```ts
    // Origin catalog image URLs are built from: `${CATALOG_IMAGE_BASE_URL}/${storage_key}`. In
    // production a CDN in front of the bucket; locally MinIO's anonymous-read `catalog/` prefix.
    // Required: a missing value produces image URLs that look right and 404.
    CATALOG_IMAGE_BASE_URL: Joi.string().uri().required(),
```

`apps/api/src/config/load-env.spec.ts`: add `CATALOG_IMAGE_BASE_URL: 'http://localhost:9000/wt-app'` to the valid fixture and `'CATALOG_IMAGE_BASE_URL'` to the required-keys list (read the file to place both where the other required keys are).

`apps/api/src/providers.ts`: add

```ts
/** DI token for the origin catalog image URLs are built from. */
export const CATALOG_IMAGE_BASE_URL = Symbol('CATALOG_IMAGE_BASE_URL');
```

and a provider in `infrastructureProviders`:

```ts
    {
        provide: CATALOG_IMAGE_BASE_URL,
        useFactory: (): string => String(loadEnv()['CATALOG_IMAGE_BASE_URL']).replace(/\/+$/, ''),
    },
```

`apps/api/.env.example`, after the `S3_*` block:

```
# Where catalog exercise images are read from, by the browser, without a session. Locally this is
# MinIO's anonymous-read `catalog/` prefix (see docker-compose `minio-init`); in production a CDN
# in front of the bucket.
CATALOG_IMAGE_BASE_URL=http://localhost:9000/wt-app
```

Rewrite the `S3_*` comment in that file: "The bucket and its credentials are REQUIRED — catalog exercise images are published into this bucket by `apps/admin seed-exercises` and the API refuses to boot without a storage configuration."

`.railway/railway.ts`: add `CATALOG_IMAGE_BASE_URL: preserve(),` to the api service's `env` (alphabetical position, after `AUTH_TRUSTED_ORIGINS`).

`apps/api/test/harness.ts`: after the `MCP_BASE_URL` line add

```ts
    process.env['CATALOG_IMAGE_BASE_URL'] ??= TEST_CATALOG_IMAGE_BASE_URL;
```

and export near the other constants:

```ts
/** Origin the test app builds catalog image urls from. */
export const TEST_CATALOG_IMAGE_BASE_URL = 'https://cdn.test';
```

- [ ] **Step 3: Remove the image controller, rewrite `toDetailResponse`**

Delete `apps/api/src/exercises/exercise-guide-images.controller.ts`.

`exercises.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ExerciseGuideController } from './exercise-guide.controller.js';
import { ExercisesController } from './exercises.controller.js';
import { exerciseServiceProviders } from './exercises.providers.js';

/** Wires the workspace-scoped `/api/v1/workspaces/:workspaceId/exercises` routes. */
@Module({
    controllers: [ExercisesController, ExerciseGuideController],
    providers: [...exerciseServiceProviders],
})
export class ExercisesModule {}
```

`exercises.controller.ts`:

- Remove `exerciseImageContentPath` from the `@app/api-contract` import.
- Import `CATALOG_IMAGE_BASE_URL` from `'../providers.js'`.
- Constructor gains `@Inject(CATALOG_IMAGE_BASE_URL) private readonly catalogImageBaseUrl: string,`.
- Every `toDetailResponse({ exercise, workspaceId, urls: this.urls })` call becomes `toDetailResponse({ exercise, imageBaseUrl: this.catalogImageBaseUrl })`.
- Update the class doc: `/** The exercise library a workspace sees: the shared catalog and its own custom exercises. */`
- Replace the helper:

```ts
/**
 * Storage keys become absolute CDN urls here, and only here: the service returns keys because the
 * base origin is deployment configuration, which belongs to the app.
 */
function toDetailResponse({
    exercise,
    imageBaseUrl,
}: {
    exercise: ExerciseDetail;
    imageBaseUrl: string;
}): ExerciseDetailResponse {
    return {
        ...exercise,
        images: exercise.images.map((image) => ({
            id: image.id,
            caption: image.caption,
            position: image.position,
            url: `${imageBaseUrl}/${image.storageKey}`,
        })),
    };
}
```

Remove the now-unused `RESOURCE_URL_GENERATOR`/`ResourceUrlGenerator` from the constructor only if nothing else in the class uses `this.urls` — `getExercise` still builds `webUrl` from it, so keep it.

Check `exercise-guide.controller.ts` for any import of the deleted symbols; it should have none.

- [ ] **Step 4: Rewrite the guide e2e spec, extend the exercises e2e spec**

`apps/api/test/exercise-guide.e2e.spec.ts`: delete the whole `describe('guide image routes', …)` block, the `postImage`/`postImageCaptionAfterFile`/`contentPath` helpers, `PNG_BYTES`, `MAX_IMAGE_BYTES`, the MinIO container (`minio`, `s3`, `storage`, the `GenericContainer` start in `beforeAll`, the `minio.stop()` in `afterAll`), the `STORAGE_SERVICE` override passed to `createTestApp`, and the now-unused imports (`@aws-sdk/client-s3`, `@app/logger`, `@app/storage`, `testcontainers`, `STORAGE_SERVICE`, `TEST_API_BASE_URL`, `vi`). What remains is the link routes suite booting the plain harness. Rename the top-level describe if it mentions images.

`apps/api/test/exercises.e2e.spec.ts`: add `import { schema } from '@app/db';` and `TEST_CATALOG_IMAGE_BASE_URL` to the harness import, then append:

```ts
describe('catalog exercises', () => {
    async function seedCatalog(): Promise<{ id: string; imageKey: string }> {
        const imageKey = `catalog/e2e-squat/${randomUUID()}.png`;
        const [row] = await app.db
            .insert(schema.exercises)
            .values({ workspaceId: null, slug: `e2e-squat-${randomUUID()}`, name: 'E2E Squat', trackingType: 'weight_reps' })
            .returning({ id: schema.exercises.id });
        await app.db.insert(schema.exerciseGuideImages).values({
            workspaceId: null,
            exerciseId: row.id,
            storageKey: imageKey,
            contentType: 'image/png',
            position: 0,
        });

        return { id: row.id, imageKey };
    }

    it('lists and reads a catalog exercise for any signed-in member, with an absolute CDN image url', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const { id, imageKey } = await seedCatalog();

        const list = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises?pageSize=100`,
            headers: { cookie },
        });
        const listed = (JSON.parse(list.body) as { data: { id: string; isCatalog: boolean }[] }).data;
        expect(listed.find((row) => row.id === id)).toMatchObject({ isCatalog: true });

        const detail = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${id}`,
            headers: { cookie },
        });
        expect(detail.statusCode).toBe(200);
        expect(JSON.parse(detail.body)).toMatchObject({
            isCatalog: true,
            images: [{ url: `${TEST_CATALOG_IMAGE_BASE_URL}/${imageKey}` }],
        });
    });

    it('answers 404 to a PATCH on a catalog exercise through a workspace', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const { id } = await seedCatalog();

        const response = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${id}`,
            headers: { cookie },
            payload: { name: 'Vandalised' },
        });

        expect(response.statusCode).toBe(404);
    });

    it('marks a created exercise as not catalog', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const created = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
            payload: { name: 'Mine', trackingType: 'weight_reps' },
        });

        expect(JSON.parse(created.body)).toMatchObject({ isCatalog: false, slug: null });
    });
});
```

Check `TestApp` in `harness.ts` exposes the `Db` (look for a `db` property on the returned object). If it does not, add `db: Db` to `TestApp` and return it from `buildApp` — the value already exists there.

- [ ] **Step 5: Run the API suites**

Run: `pnpm --filter @app/api test`
Expected: PASS, including `route-guard-coverage.e2e.spec.ts` with no allowlist change — the deleted routes simply no longer exist. If any test references `exerciseImageContentPath`, it is one you missed in Step 4.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: FAIL only in `apps/web` and `apps/mcp` if they import removed symbols — `apps/web` does not import the contract, and `apps/mcp` imports only tool-arg schemas, so expect PASS. If `apps/mcp` fails, note the symbol and fix it in Task 10 rather than here only if the failure is confined to a doc comment; a real import must be fixed now.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/api-contract apps/api .railway/railway.ts
git commit -m "feat(api): serve the shared catalog with CDN image urls and drop the image upload routes"
```

---

### Task 9: Web — catalog badge, read-only catalog, image section removed

**Files:**
- Modify: `apps/web/src/models/exercise.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/hooks/use-exercises.ts`
- Modify: `apps/web/src/components/exercises/ExerciseGuide.tsx`
- Modify: `apps/web/src/components/exercises/ExerciseGuideEditor.tsx`
- Modify: `apps/web/src/pages/exercises/ExerciseDetailPage.tsx`
- Modify: `apps/web/src/pages/exercises/ExercisesListPage.tsx`

**Interfaces:**
- Consumes: `isCatalog`, `slug`, absolute `image.url` from Task 8.

- [ ] **Step 1: Model**

`apps/web/src/models/exercise.ts` — extend `Exercise`:

```ts
export type Exercise = {
    id: string;
    name: string;
    /** Set on catalog exercises; null on the workspace's own. */
    slug: string | null;
    /** Shared, read-only content: no edit, archive, or link controls apply. */
    isCatalog: boolean;
    trackingType: TrackingType;
    notes: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};
```

Update the `ExerciseGuideImage.url` doc to `/** Absolute CDN url; needs no session. */`.

- [ ] **Step 2: API layer and hooks**

`apps/web/src/lib/api.ts`: delete `exerciseImageContentUrl` and its doc comment, and the `uploadImage` and `removeImage` entries from `exercisesApi`. Remove `ExerciseGuideImage` from the models import if nothing else in the file uses it.

`apps/web/src/hooks/use-exercises.ts`: delete `useUploadExerciseImage` and `useRemoveExerciseImage` and the `ExerciseGuideImage` import if unused.

- [ ] **Step 3: `ExerciseGuide` renders `image.url`**

In `ExerciseGuide.tsx`: remove the `exerciseImageContentUrl` import. Replace the `const src = exerciseImageContentUrl({ … });` with `const src = image.url;`. The `workspaceId` prop is now unused inside this component — remove it from the props type and signature, and from the two call sites (`ExerciseDetailPage.tsx`, `ExerciseGuideEditor.tsx` preview).

- [ ] **Step 4: Strip images from the editor**

In `ExerciseGuideEditor.tsx`:

- Imports: drop `type ChangeEvent`, `useRemoveExerciseImage`, `useUploadExerciseImage`, `exerciseImageContentUrl`.
- Delete `MAX_IMAGE_BYTES`, `ALLOWED_IMAGE_TYPES` and their comment.
- Delete the `uploadImage` and `removeImage` hook calls, the `imageCaption` state, `handleFileChange`, `handleRemoveImage`.
- In `hasUnsavedSubFormDraft`, delete the `imageCaption.trim().length > 0` clause and the trailing `||` before it; in the comment above it, delete "or a caption typed before a file was chosen".
- In `handleDiscardDraftsAndClose`, delete `setImageCaption('');`.
- Delete the whole `<section …><h3>Images</h3>…</section>` block.
- Update the class doc: "Edits a custom exercise's guide: the four text fields and its links." and delete "or an unfinished link/image draft" → "or an unfinished link draft".
- In the alert dialog, change the title to "Finish or discard your unsaved link?" and the description to "You have text in the link form that hasn't been added yet. Closing now will discard it — your saved guide text and links are not affected."
- In the "Seeded once per exercise" comment, change "an image or link mutation" to "a link mutation".
- Update the `finishEditing` doc: "if a link form still holds a draft".

- [ ] **Step 5: Detail page — no edit control on catalog**

`ExerciseDetailPage.tsx`: after the tracking-type badge, render a catalog badge, and guard the edit button:

```tsx
                    <div className='mt-2 flex flex-wrap gap-2'>
                        <Badge variant='secondary' className='gap-1'>
                            <Icon className='h-3 w-3' aria-hidden />
                            {label}
                        </Badge>
                        {exercise.isCatalog && <Badge variant='outline'>Catalog</Badge>}
                    </div>
```

and

```tsx
                {!isEditing && !exercise.isCatalog && (
```

Add a sentence to the component doc: "Catalog exercises are read-only here: the edit control is not rendered rather than disabled, because there is nothing a member could do to make it work."

- [ ] **Step 6: List row badge**

In `ExercisesListPage.tsx`'s `ExerciseRow`, before the tracking-type badge:

```tsx
                {exercise.isCatalog && (
                    <Badge variant='outline' className='shrink-0'>
                        Catalog
                    </Badge>
                )}
```

Search the list page for any archive control: the current page has none (archive is via the detail editor's PATCH), so nothing else to hide.

- [ ] **Step 7: Typecheck, lint, build**

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web lint && pnpm --filter @app/web build` (use the script names the package defines; check `apps/web/package.json`).
Expected: PASS with no unused-import warnings.

- [ ] **Step 8: Smoke it**

With `docker compose up -d` and `pnpm dev`, seed one exercise (`pnpm --filter @app/admin start seed-exercises --dir content/exercises` after Task 11's content exists — or skip this step until Task 11 and run it then). Confirm: catalog badge in list, no "Edit guide" on the catalog detail, custom exercise still editable with links but no image section.

- [ ] **Step 9: Commit**

```bash
pnpm format
git add apps/web
git commit -m "feat(web): show catalog exercises read-only and drop guide image upload"
```

---

### Task 10: MCP tool descriptions

**Files:**
- Modify: `apps/mcp/src/mcp/tools/exercise.tools.ts`
- Modify: `apps/mcp/src/mcp/tools/*.spec.ts` (whichever spec asserts on the exercise tool descriptions, if any)

- [ ] **Step 1: Update descriptions and the file doc**

In `exercise.tools.ts`:

- File doc: replace the sentence beginning "Image upload is deliberately not a tool here" with: "Catalog exercises (`isCatalog: true`) are shared, read-only content; the write tools answer 404 for a catalog id, the same as for an exercise in another workspace. Guide images are catalog content served from a CDN — there is no image tool."
- `ListExercises` description: replace "Lists exercises in the token's workspace, newest first," with "Lists the exercises the token's workspace can see — the shared catalog plus its own custom exercises — by name." and append "isCatalog marks shared catalog exercises, which cannot be edited."
- `GetExercise` description: append " Catalog exercises (isCatalog true) are read-only."
- `UpdateExercise` and `AddExerciseLink` descriptions: append " Not applicable to catalog exercises, which answer not-found."

- [ ] **Step 2: Run MCP tests and typecheck**

Run: `pnpm --filter @app/mcp test && pnpm typecheck`
Expected: PASS. If a snapshot or assertion pins a description string, update it to the new text.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add apps/mcp
git commit -m "docs(mcp): describe catalog exercises as read-only in the exercise tools"
```

---

### Task 11: Local CDN stand-in, starter content, docs

**Files:**
- Modify: `docker-compose.yml`
- Create: `content/exercises/README.md`
- Create: `content/exercises/barbell-back-squat/exercise.json`
- Create: `content/exercises/plank/exercise.json`
- Modify: `docs/superpowers/specs/2026-09-10-workout-tracker-phase-1-design.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: MinIO anonymous read on the catalog prefix**

In `docker-compose.yml`, `minio-init` entrypoint becomes:

```yaml
        entrypoint: >
            sh -c "
                mc alias set local http://minio:9000 minioadmin minioadmin &&
                mc mb --ignore-existing local/wt-app &&
                mc anonymous set download local/wt-app/catalog
            "
```

Update its comment: "One-shot: creates the bucket `apps/api` expects (`S3_BUCKET`) and opens anonymous read on its `catalog/` prefix, which stands in for the production CDN — the browser loads catalog images straight from `http://localhost:9000/wt-app/catalog/...` (`CATALOG_IMAGE_BASE_URL`). The rest of the bucket stays private."

Verify: `docker compose up -d minio-init && docker compose logs minio-init` shows the policy applied; `curl -I http://localhost:9000/wt-app/catalog/nothing` returns 404 (not 403), and `curl -I http://localhost:9000/wt-app/other` returns 403.

- [ ] **Step 2: Starter content**

`content/exercises/README.md`:

```markdown
# Exercise catalog

Each directory is one catalog exercise; its name is the slug. `exercise.json` holds the text and
lists the images and links; images live under `images/`. The format is validated by
`packages/catalog` (see `exerciseEntrySchema`).

Publish with `pnpm --filter @app/admin start seed-exercises` against the target database and
bucket (`DATABASE_URL`, `S3_*`). Runs are idempotent; removing a directory archives its exercise
rather than deleting it, because past sessions reference it.
```

`content/exercises/barbell-back-squat/exercise.json`:

```json
{
    "name": "Barbell back squat",
    "trackingType": "weight_reps",
    "notes": null,
    "guide": {
        "setup": "Bar across the upper back, hands just outside the shoulders, elbows pulled down. Feet shoulder-width, toes turned out slightly.",
        "execution": "Big breath into the belly and brace. Sit down between the hips, keeping the whole foot planted, until the crease of the hip is below the knee. Drive the floor away.",
        "cues": "Knees track over the toes. Chest up. Bar over mid-foot the whole way.",
        "mistakes": "Heels lifting; knees caving in; losing the brace at the bottom; cutting the depth short as the weight goes up."
    },
    "links": [],
    "images": []
}
```

`content/exercises/plank/exercise.json`:

```json
{
    "name": "Plank",
    "trackingType": "duration",
    "notes": "Bodyweight hold.",
    "guide": {
        "setup": "Forearms on the floor, elbows under the shoulders, feet together.",
        "execution": "Squeeze the glutes, tuck the ribs, and hold a straight line from head to heels for the target time.",
        "cues": "Push the floor away through the forearms. Breathe.",
        "mistakes": "Hips sagging or piking; holding the breath."
    },
    "links": [],
    "images": []
}
```

Verify: `pnpm --filter @app/admin start seed-exercises` against the local database prints `created barbell-back-squat` and `created plank`; a second run prints `unchanged` for both. Then run Task 9 Step 8's smoke check.

- [ ] **Step 3: Update the Phase 1 spec**

In `docs/superpowers/specs/2026-09-10-workout-tracker-phase-1-design.md`:

- Under "### Exercise library", replace the paragraph with: "The library is the shared catalog — first-party exercises and guides published from `content/exercises/` — plus each workspace's own custom exercises, created inline when a movement is missing. See `2026-09-12-global-exercise-catalog-design.md`."
- In the `exercises` table, change `workspace_id` to `uuid null | FK → workspaces.id, on delete cascade; null = catalog row` and add a row `slug | text null | seed key; set only on catalog rows`.
- In "## API", delete the `exercises/:id/images — upload, delete` line.
- At the top of "## Data Model", change "All tables are workspace-owned" to "All tables carry `workspace_id`; the exercise tables allow it to be null for shared catalog rows and are read with `scopedToWorkspaceOrGlobal`."

- [ ] **Step 4: `CLAUDE.md` — content and admin**

Under "### apps/admin", append: "`seed-exercises` publishes `content/exercises/` into the shared catalog; it is the only writer of catalog rows."

Under "## Monorepo Overview" tree, add `packages/catalog/     # Exercise content file format and loader (reads the filesystem, nothing else)` after `domain/`, and `content/exercises/    # Catalog exercises as JSON + images, published by apps/admin seed-exercises` after `packages/`.

- [ ] **Step 5: Full verification**

Run, from the root: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add docker-compose.yml content docs CLAUDE.md
git commit -m "feat: seed starter catalog content and serve catalog images from MinIO locally"
```

---

## Self-review checklist (run after the last task)

- Spec coverage: schema + helper (T1), storage (T2), services (T3, T4, T6), catalog package (T5), admin command (T7), CDN/env (T8, T11), API/contract (T8), web (T9), MCP (T10), tests for every bullet in the spec's Testing section (T1, T3, T4, T5, T6, T7, T8), spec edits (T11).
- Every write in `ExercisesService` / `ExerciseGuideService` still calls `scopedToWorkspace`; only `list` and `loadDetail` use the OrGlobal helper.
- `route-guard-coverage.e2e.spec.ts` was not edited.
- No file imports `exerciseImageContentPath` or `exerciseImageCaptionSchema`.
