# My equipment — design

Approved 2026-09-14. Adds an equipment vocabulary to exercises, named equipment presets per
workspace, an equipment-aware filter on every exercise list, and a first-run onboarding step that
captures the user's equipment.

## Goals

- During onboarding, pick the equipment the user has access to from a tiled list.
- Optionally hide exercises that need equipment the user does not have.
- Switch between named presets ("Home", "Gym") to change that filter quickly.

## Non-goals

- Workspace-defined equipment types. The vocabulary is a closed enum.
- Per-exercise "optional" equipment or alternatives.
- Any further onboarding stages. The stage enum is designed to grow, but only `equipment` and
  `complete` exist now.

## Vocabulary

`Equipment` enum in `@app/domain`:

| Value             | Label            |
| ----------------- | ---------------- |
| `barbell`         | Barbell          |
| `dumbbell`        | Dumbbells        |
| `kettlebell`      | Kettlebell       |
| `cable`           | Cable machine    |
| `machine`         | Weight machines  |
| `squat_rack`      | Squat rack       |
| `bench`           | Bench            |
| `pull_up_bar`     | Pull-up bar      |
| `resistance_band` | Resistance bands |
| `treadmill`       | Treadmill        |
| `stationary_bike` | Stationary bike  |
| `rowing_machine`  | Rowing machine   |

An exercise's `equipment` lists everything it **requires**. Empty means bodyweight and always passes
the filter. `machine` is one generic bucket for pin- and plate-loaded machines (leg press, leg curl,
leg extension, lat pulldown); `cable` is a cable stack. Outdoor running and cycling are bodyweight.

`OnboardingStage` enum in `@app/domain`: `equipment`, `complete`. Ordered; the web app sends the
user to the screen for whichever stage the workspace is at. New stages can be inserted later and
existing workspaces moved to them by migration.

## Data model

One migration (`pnpm --filter @app/db db:generate`), reviewed before commit:

- `exercises.equipment equipment[] NOT NULL DEFAULT '{}'` — Postgres enum array (`pgEnum` +
  `.array()`), so the database rejects an unknown value.
- New `equipment_presets`: `id uuid pk`, `workspace_id uuid NOT NULL` (FK → `workspaces`, cascade),
  `name text NOT NULL`, `equipment equipment[] NOT NULL DEFAULT '{}'`, `created_at`, `updated_at`.
  Unique `(workspace_id, name)`. Index on `workspace_id`.
- `workspaces.onboarding_stage onboarding_stage NOT NULL DEFAULT 'equipment'` — existing
  workspaces go through the wizard once.

Presets are workspace-owned rows: every read and write goes through
`WorkspaceMembershipService.require` plus `scopedToWorkspace`. A preset id from another workspace
is a 404.

**Which preset is active is per device**, stored in the browser's localStorage under
`active-equipment-preset` as a preset id or absent. It is not server state, so switching presets
costs no request and the filter can differ between a gym phone and a desktop.

## Catalog

`exercise.json` gains `equipment: Equipment[]` (default `[]`). The loader validates it with
`z.enum(Equipment)`. `seed-exercises` writes it on insert and update. Every entry in
`content/exercises/` is tagged:

| Slug                     | Equipment               |
| ------------------------ | ----------------------- |
| barbell-back-squat       | barbell, squat_rack     |
| barbell-bench-press      | barbell, bench          |
| barbell-deadlift         | barbell                 |
| barbell-hip-thrust       | barbell, bench          |
| barbell-overhead-press   | barbell                 |
| barbell-row              | barbell                 |
| cable-triceps-pushdown   | cable                   |
| cycling                  | —                       |
| dumbbell-bench-press     | dumbbell, bench         |
| dumbbell-biceps-curl     | dumbbell                |
| dumbbell-lateral-raise   | dumbbell                |
| dumbbell-row             | dumbbell, bench         |
| dumbbell-shoulder-press  | dumbbell                |
| goblet-squat             | dumbbell                |
| lat-pulldown             | machine                 |
| leg-curl                 | machine                 |
| leg-extension            | machine                 |
| leg-press                | machine                 |
| plank                    | —                       |
| pull-up                  | pull_up_bar             |
| push-up                  | —                       |
| romanian-deadlift        | barbell                 |
| rowing                   | rowing_machine          |
| running                  | —                       |
| seated-cable-row         | cable                   |
| side-plank               | —                       |
| standing-calf-raise      | —                       |
| walking-lunge            | —                       |

## API

All under `/api/v1/workspaces/{workspaceId}`. Schemas in `@app/api-contract` first.

### Exercises

- `exerciseResponseSchema` gains `equipment: z.array(z.enum(Equipment))`.
- `postExerciseRequestSchema` / `patchExerciseRequestSchema` accept `equipment` (optional; POST
  defaults to `[]`). Duplicates are rejected.
- `exerciseListQuerySchema` gains `equipment`: a comma-separated list of enum values. Semantics:
  - absent → no equipment filter;
  - present → only exercises whose `equipment` is a subset of the given set
    (`exercises.equipment <@ ARRAY[...]::equipment[]`), so bodyweight exercises always pass;
  - present but empty (`equipment=`) → bodyweight exercises only.
  Applied server-side so pagination and `totalCount` stay correct.

### Equipment presets

| Method | Path                       | Body / result                                          |
| ------ | -------------------------- | ------------------------------------------------------ |
| GET    | `/equipment-presets`       | `{ data: EquipmentPresetResponse[] }`, ordered by name |
| POST   | `/equipment-presets`       | `{ name, equipment }` → 201 preset                     |
| PATCH  | `/equipment-presets/{id}`  | `{ name?, equipment? }`, at least one → preset         |
| DELETE | `/equipment-presets/{id}`  | 204                                                    |

`EquipmentPresetResponse`: `{ id, name, equipment, createdAt, updatedAt }`. Name 1–60 chars.
A duplicate name in the same workspace is a `ConflictError` (409) — check `@app/errors` for the
existing conflict class before adding one. Unpaginated: a workspace has a handful of presets.

### Onboarding

- `PATCH /onboarding` body `{ stage: OnboardingStage }` → `{ stage }`. Sets the workspace's stage.
  Idempotent. Session-authenticated only — not on the MCP allowlist.
- `workspaceListItemSchema` (nested in `UserResponse`) gains `onboardingStage`, so the web app
  knows where to send the user without an extra request.

Nothing here exposes workspace management; the workspace id in the path is the same internal
scoping every other route already uses.

### MCP

The list-exercises tool gains an optional `equipment` argument (array of enum values) passed
through to the query. Exercise responses carry `equipment` because the contract does.

## Web

### Onboarding

`/welcome` — a protected full-screen route outside `AppLayout` (no nav). Rendered when the current
workspace's `onboardingStage === 'equipment'`; `AppLayout` redirects there while that holds, and
`/welcome` redirects to `/` once it does not.

Content: heading, preset name input (default "My gym"), `EquipmentTileGrid`, **Continue** (primary)
and **Skip for now** (secondary). Continue: create the preset, `PATCH /onboarding { stage:
'complete' }`, store the new preset id as active, navigate to `/`. Skip: only the stage update.
Invalidate the `me` query after either so the redirect logic sees the new stage.

### Active preset

`apps/web/src/lib/active-equipment-preset.ts`: read/write the localStorage id (try/catch, absent
on failure). `useActiveEquipmentPreset()` combines it with `useEquipmentPresets()`: returns
`{ preset: EquipmentPreset | null, setActive(id | null) }`; an id that no longer matches a preset
resolves to `null` (filter off).

### Filter chip

`EquipmentFilterChip` on `ExercisesListPage` and inside `ExercisePickerSheet` (which serves both
routines and sessions). Shows the active preset name, or "All equipment". Tap opens a popover:
"All equipment" plus each preset; picking one sets the active id. `ExercisesListPage` also shows a
"Manage equipment" link to Settings; the picker does not, because a picker inside a session must
never navigate away. When filtered, lists pass `equipment` to `useExercises`.

An empty filtered list shows an actionable empty state: "Nothing matches your {preset} equipment"
with a "Show all equipment" action.

### Settings

New **Equipment** card on Settings: preset list with name and a compact equipment summary; "Add
preset" and per-row edit open a sheet with name + `EquipmentTileGrid`; delete asks for
confirmation. Deleting the active preset clears the stored id.

### Custom exercises

The custom exercise create/edit form gains `EquipmentTileGrid`. Catalog exercises show equipment
read-only on the detail page.

### Components

- `EquipmentTileGrid` — multi-select grid of large tap targets, one per enum value, icon + label,
  checked state obvious. Reused by onboarding, preset editor, exercise form.
- `apps/web/src/lib/equipment.ts` — labels and icons per value, the only place they are written.

## Testing

- `packages/domain`: none needed beyond enum existence in contract specs.
- `packages/catalog`: entry schema accepts `equipment`, defaults to `[]`, rejects unknown values.
- `packages/api-contract`: exercise `equipment` field, list query parsing (absent / empty / list /
  invalid), preset schemas, onboarding schema.
- `packages/services`:
  - `ExercisesService.list` filter: subset semantics, bodyweight always passes, empty list →
    bodyweight only; create/update persist `equipment`.
  - `EquipmentPresetsService`: CRUD, duplicate name 409, cross-workspace read/update/delete → 404.
  - `WorkspacesService.setOnboardingStage`: persists; non-member → 404.
  - `CatalogSeedService`: writes and updates `equipment`.
- `apps/api` e2e: preset routes, onboarding route, exercise list `equipment` query; route-guard
  coverage passes without touching the MCP allowlist (except list-exercises which is already on it).
- `apps/web` vitest: active preset resolution (missing id → null, stale id → null).
- No browser or Playwright runs.
