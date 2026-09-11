# Global Exercise Catalog — Design

**Date:** 2026-09-12
**Status:** Approved for planning
**Supersedes:** the "Exercise library" and `exercises` sections of
`2026-09-10-workout-tracker-phase-1-design.md`. Everything else in that spec stands.

## Context

Phase 1 plan 1 shipped a workspace-owned exercise library: every exercise, guide image and link
carries a `workspace_id`, and a workspace starts empty. The direction has changed. The exercises and
their how-to guides are **first-party content**, written by us and visible to every user, so that the
app is useful as a set of training guides before a single set has been logged. Because the content is
shared and changes only when we publish it, it can be cached — and guide images in particular should
be served from a CDN without touching the API at all.

Users still need a way to log a movement we have not written up (a machine specific to their gym), so
a workspace can add its own private exercises alongside the catalog.

This spec covers the catalog, its storage shape, how it is authored and published, and what changes
in the exercise routes and UI. Routines and sessions (plans 2 and 3) are unchanged in shape: a routine
is a workspace-owned template of exercises, a session is a snapshot copied from it, and both reference
`exercises.id` whether the exercise is catalog or custom.

## Decisions

### One table, nullable `workspace_id`

Catalog and custom exercises share the `exercises` table. A row with `workspace_id IS NULL` is a
catalog row; a row with a `workspace_id` is that workspace's private exercise. The same rule applies
to `exercise_guide_images` and `exercise_links`.

The alternative — a separate `catalog_exercises` table — keeps the tenancy helper untouched but
forces every downstream reference (`routine_exercises`, `session_exercises`, per-exercise history,
the guide sheet, every MCP tool) to carry an XOR pair of foreign keys and branch on which one is set.
That cost compounds through plans 2 and 3. One table with a single `exercise_id` foreign key is the
cheaper shape by a wide margin.

The risk of one table is that a workspace-scoped query which reads catalog rows could also, by the
same relaxation, write them. That is closed by the helper split below: reads use a helper that admits
catalog rows, writes keep the strict helper, so a write aimed at a catalog id through a workspace route
finds no row and yields the same 404 as a row in another workspace.

### Content as code

Catalog exercises are files in the repository, published to the database by an `apps/admin` command.
There is no admin role and no in-app editor for catalog rows. A guide is reviewed as a diff, images are
versioned with the text they illustrate, and a fresh environment gets the whole catalog from one
command. A platform-admin role would reuse the existing editor UI but needs an admin gate on every
write route and gives the catalog a second, unreviewed source of truth.

### Images bypass the API

Catalog images are read straight from object storage through a CDN. The API returns an absolute URL
and never streams catalog image bytes. Keys are content-addressed, so a URL is immutable and the CDN
can cache it indefinitely.

Custom exercises do not get images for now. The upload pipeline in `@app/storage` and
`ExerciseGuideService` (content-type sniffing, size limits, key generation) is kept, because it will be
reused — progress photos are the likely first consumer — but the routes that expose it for exercise
guides are removed. Custom exercises keep links.

## Data Model

### `exercises`

| Column               | Change                                                          |
| -------------------- | --------------------------------------------------------------- |
| `workspace_id`       | now `uuid null`; FK to `workspaces.id` retained (cascade)        |
| `slug`               | new, `text null`; the seed's upsert key, set only on catalog rows |

New partial unique index: `exercises_catalog_slug_uidx ON (slug) WHERE workspace_id IS NULL`.

A check constraint keeps the two kinds distinct: `(workspace_id IS NULL) = (slug IS NOT NULL)`. A
custom row never has a slug; a catalog row always does.

`created_by_user_id` stays nullable and is null on catalog rows.

### `exercise_guide_images`, `exercise_links`

`workspace_id` becomes nullable. On a child row it must match the parent exercise's `workspace_id`,
including both being null; the service enforces this because a cross-table check is not expressible
as a constraint. The existing `exercise_id` FK cascade is unchanged.

`exercise_guide_images.storage_key` for catalog images is `catalog/<slug>/<sha256>.<ext>`.

### Migration

Additive only: three `DROP NOT NULL`s, one `ADD COLUMN`, one index, one check constraint. The
generated SQL is read before it is committed; there is no `DROP TABLE` or `DROP COLUMN` in this
change.

## Tenancy Helpers (`@app/db`)

`scopedToWorkspace` is unchanged and remains the only helper used on a write path.

New:

```ts
export type SharedOrWorkspaceOwnedTable = { workspaceId: PgColumn };

/** Read-only: admits rows shared with every workspace (`workspace_id IS NULL`) alongside the caller's own. */
export function scopedToWorkspaceOrGlobal<T extends SharedOrWorkspaceOwnedTable>(
    table: T,
    workspaceId: string,
    ...filters: Array<SQL | undefined>
): SQL;
```

Produces `(workspace_id = $1 OR workspace_id IS NULL) AND …`. Its docstring says, in the first line,
that it is for reads only and why: passing it to an `update` or `delete` would let a workspace member
alter catalog rows. `scoping.spec.ts` gains cases for it.

The membership check still precedes every use. The helper relaxes the row filter, not who may ask.

## Services

`ExercisesService`

- `list`, `get` — `scopedToWorkspaceOrGlobal`. Catalog and custom rows interleave in one list,
  sorted by name; the response marks each row.
- `create` — unchanged; always writes the caller's `workspace_id`, never a slug.
- `update` (including archive) — unchanged, strict `scopedToWorkspace`; a catalog id is a 404.

`ExerciseGuideService`

- `listImages`, `listLinks` (as read through `loadDetail`) — `scopedToWorkspaceOrGlobal`.
- `addLink`, `updateLink`, `removeLink` — strict; a catalog exercise id is a 404.
- `addImage`, `removeImage`, `getImage` — kept, strict, tested, and no longer routed. A one-line
  comment on each says it is intentionally unrouted pending a consumer.

New `CatalogSeedService` in `packages/services`, plain class, dependencies `{ db, storage }`:

- `upsertExercise({ entry, imageFiles })` — one transaction per exercise: upsert `exercises` by
  slug (`ON CONFLICT (slug) WHERE workspace_id IS NULL`); replace links to match the file; for each
  image, compute sha256, upload to `catalog/<slug>/<sha>.<ext>` only if the key is absent, and
  replace the image rows to match; delete image rows (and their objects) no longer in the file.
- `archiveMissing({ presentSlugs })` — catalog rows whose slug is not in the set get `archived_at`
  set. Never deleted: sessions reference them.

Both are idempotent. Running the seed twice against the same directory changes nothing on the
second run.

## Catalog Package

New `packages/catalog`: the file format's Zod schema and a loader. It reads the filesystem and
nothing else — no database, no network — so it does not belong in `domain`, and it is shared between
the admin command and a future content-lint step.

```
content/exercises/
  barbell-back-squat/
    exercise.json
    images/
      01-setup.jpg
      02-bottom-position.jpg
```

`exercise.json`:

```json
{
    "name": "Barbell back squat",
    "trackingType": "weight_reps",
    "notes": null,
    "guide": {
        "setup": "…",
        "execution": "…",
        "cues": "…",
        "mistakes": "…"
    },
    "links": [{ "url": "https://…", "label": "Form video" }],
    "images": [{ "file": "01-setup.jpg", "caption": "Bar on the upper back" }]
}
```

The directory name is the slug and must match `^[a-z0-9]+(-[a-z0-9]+)*$`. `images[].file` must
exist under `images/`; position is array order. The loader rejects a malformed file with a
`RequestValidationError` naming the slug and path.

## Admin Command

`apps/admin seed-exercises --dir <path>` (default `content/exercises`).

Loads every entry through `@app/catalog`, runs `CatalogSeedService.upsertExercise` for each, then
`archiveMissing`. Prints one line per exercise (`created` / `updated` / `unchanged` / `archived`).
Exits non-zero on the first load error before touching the database, so a typo in one file does not
half-publish the catalog.

`apps/admin`'s env gains the `S3_*` keys, optional at load and required by this command. It runs as a
deploy step for `apps/api` on Railway and by hand locally.

## Images and the CDN

`apps/api` gains one required env key, `CATALOG_IMAGE_BASE_URL`, validated as an absolute URL.
The image response's `url` is `${CATALOG_IMAGE_BASE_URL}/${storage_key}`. Clients never construct a
path.

| Environment | Bucket                        | `CATALOG_IMAGE_BASE_URL`         |
| ----------- | ----------------------------- | -------------------------------- |
| production  | R2, public via custom domain  | `https://cdn.<domain>`           |
| local       | MinIO, `wt-app`               | `http://localhost:9000/wt-app`   |

Locally, `minio-init` runs `mc anonymous set download local/wt-app/catalog` after creating the
bucket, so the `catalog/` prefix is readable without credentials and the rest of the bucket stays
private. The URL shape is identical in both environments; there is no local-only code path in the API.

Cache headers are the CDN's responsibility. Content-addressed keys mean a changed image is a new URL,
so the edge may cache with `immutable`.

## API

Routes stay under `/api/v1/workspaces/:workspaceId/exercises` and stay session-guarded
(`SessionOrMcpPatGuard` on reads, as today). `PUBLIC_ROUTES` in `route-guard-coverage.e2e.spec.ts`
is not touched.

Removed: `POST :exerciseId/images`, `GET :exerciseId/images/:imageId/content`,
`DELETE :exerciseId/images/:imageId`. The web `http-client` and MCP tool map lose their entries.

Contract (`packages/api-contract`):

- `exerciseResponseSchema` gains `isCatalog: z.boolean()` and `slug: z.string().nullable()`.
- `exerciseGuideImageResponseSchema.url` is now an absolute URL.
- `exerciseImageCaptionSchema` and the multipart upload types are removed with their route.

Error behaviour on a catalog id through a write route is `EntityNotFoundError` (404), the same as a
row in another workspace. A member is not told that the id names a real row they may not edit,
because the same rule that hides other tenants' rows is what hides catalog rows from writes.

## Web

Exercises page and detail page:

- Catalog rows carry a small "Catalog" badge. Edit, archive, link and image controls are hidden for
  them; the guide renders exactly as for a custom row.
- Custom rows lose the image section. The upload widget is deleted from the page, not hidden.
- "New exercise" is unchanged and creates a custom row.
- `<img src={image.url}>` — the browser fetches from the CDN with no cookie.

## MCP

`list_exercises` and `get_exercise` return catalog and custom rows through the same routes. Write
tools hit the same write routes and get a 404 on a catalog id; the tool description says catalog
exercises are read-only. No image tool exists.

## Testing

`packages/db` — `scopedToWorkspaceOrGlobal` builds the expected clause, drops `undefined` filters.

`packages/services` (real Postgres via testcontainers):

- A member of workspace A lists and reads a catalog exercise, its images and links.
- A member of workspace A gets 404 on `update`, archive, `addLink`, `removeLink` against a catalog
  id, and the row is unchanged afterwards.
- Workspace B's custom exercise remains invisible to A (existing test, kept).
- `CatalogSeedService`: run twice → identical rows and no second upload; a slug removed from the
  input → archived, not deleted; an image whose bytes are unchanged but whose caption changed →
  row updated, object not re-uploaded.

`packages/catalog` — loader accepts the fixture tree, rejects a bad tracking type, a missing image
file, and a directory name that is not a slug.

`apps/admin` — `seed-exercises` against the fixture tree reports the expected per-exercise
outcomes; a load error exits non-zero and writes nothing.

`apps/api` e2e — list and detail include a seeded catalog row with `isCatalog: true` and an absolute
image `url`; PATCH on a catalog id is 404; `route-guard-coverage` passes with the image routes gone
and no allowlist change.

## Changes to the Phase 1 Spec

- "Exercise library — starts empty" → starts with the catalog; custom rows are the escape hatch.
- `exercises` table: `workspace_id` nullable, `slug` added, as above.
- `exercises/:id/images` routes: removed from the API list.
- Everything about routines, sessions, sets, workout mode and history is unchanged.

## Out of Scope

- Images on custom exercises (pipeline kept for a future consumer).
- Forking a catalog exercise into a workspace copy.
- Content linting in CI beyond what the loader's schema enforces.
- Serving the catalog to anonymous users. Exercise data still requires a session; only image bytes
  are public.
