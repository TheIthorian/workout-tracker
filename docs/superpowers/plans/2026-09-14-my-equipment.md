# My Equipment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag exercises with the equipment they require, let a workspace keep named equipment presets, filter every exercise list by the device's active preset, and capture the user's equipment during a first-run onboarding step.

**Architecture:** `Equipment` and `OnboardingStage` are closed enums in `@app/domain`. `exercises.equipment` is a Postgres enum array; the list filter is a server-side `<@` subset test so pagination stays honest. Presets are workspace-scoped rows behind a plain `EquipmentPresetsService`; the _active_ preset is a localStorage id on the device. Onboarding is a stage column on `workspaces` that the web app routes on.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Drizzle + Postgres, NestJS/Fastify, Zod (`@app/api-contract`), Vite + React + TanStack Query + shadcn/ui, vitest + testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-14-my-equipment-design.md`

## Global Constraints

- Every rule in `CLAUDE.md` applies: no `any`, explicit return types, object arguments for 2+ params, JSDoc on public/exported functions, `type` over `interface`, helpers declared after callers, trailing commas, blank lines around log statements.
- Multi-tenancy: every preset read/write does `membership.require` **and** `scopedToWorkspace`. Cross-workspace access is `EntityNotFoundError` (404), never 403.
- Contract first: every wire shape is a Zod schema in `packages/api-contract` before a controller uses it.
- Migrations: `pnpm --filter @app/db db:generate`, then read the SQL before committing. No hand-edited migrations.
- Never `throw new Error` in source — `@app/errors` classes only.
- Tests: co-located `*.spec.ts`; services/api tests use the real Postgres via testcontainers. No browser/Playwright runs. `apps/web` unit tests are `*.test.ts` under `src/`.
- Formatting: run `pnpm format` before each commit; run `pnpm lint` and `pnpm typecheck` before claiming a task done.
- Commits: Conventional Commits, ending with:
    ```
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01232hwbrPabktwxhH3bZfxG
    ```
- Work on the current branch (`main`); do not create branches or worktrees.
- Docker must be running for service/e2e tests (`testcontainers`). If a test run fails with a Docker connection error, say so rather than skipping the test.

---

## File map

| Area     | File                                                                                                  | Responsibility                                            |
| -------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| domain   | `packages/domain/src/equipment.ts` (new)                                                              | `Equipment`, `OnboardingStage` enums                      |
| db       | `packages/db/src/schema/exercises.ts`                                                                 | `equipmentEnum`, `exercises.equipment`                    |
| db       | `packages/db/src/schema/equipment-presets.ts` (new)                                                   | `equipmentPresets` table                                  |
| db       | `packages/db/src/schema/workspaces.ts`                                                                | `onboardingStageEnum`, `workspaces.onboardingStage`       |
| db       | `packages/db/drizzle/0007_*.sql` (generated)                                                          | migration                                                 |
| contract | `packages/api-contract/src/exercise.contract.ts`                                                      | `equipment` on responses/requests, `equipment` list query |
| contract | `packages/api-contract/src/equipment-preset.contract.ts` (new)                                        | preset schemas                                            |
| contract | `packages/api-contract/src/onboarding.contract.ts` (new)                                              | onboarding schemas                                        |
| contract | `packages/api-contract/src/workspace.contract.ts`                                                     | `onboardingStage` on `workspaceListItemSchema`            |
| contract | `packages/api-contract/src/mcp-tool.contract.ts`                                                      | `equipment` on list/create/update tool args               |
| catalog  | `packages/catalog/src/exercise-entry.ts`                                                              | `equipment` field                                         |
| content  | `content/exercises/*/exercise.json`                                                                   | tagging                                                   |
| services | `packages/services/src/exercises.service.ts`                                                          | equipment column + filter                                 |
| services | `packages/services/src/equipment-presets.service.ts` (new)                                            | preset CRUD                                               |
| services | `packages/services/src/workspaces.service.ts`                                                         | `setOnboardingStage`, stage on list                       |
| services | `packages/services/src/users.service.ts`                                                              | stage on `loadWorkspaces`                                 |
| services | `packages/services/src/catalog-seed.service.ts`                                                       | seed writes equipment                                     |
| api      | `apps/api/src/exercises/exercises.controller.ts`                                                      | pass `equipment` query                                    |
| api      | `apps/api/src/equipment-presets/*` (new)                                                              | controller, module, providers                             |
| api      | `apps/api/src/onboarding/*` (new)                                                                     | controller, module (reuses workspace providers)           |
| api      | `apps/api/test/equipment-presets.e2e.spec.ts`, `onboarding.e2e.spec.ts` (new)                         | e2e                                                       |
| mcp      | `apps/mcp/src/mcp/tools/exercise.tools.ts`                                                            | pass `equipment`                                          |
| web      | `apps/web/src/models/equipment.ts` (new)                                                              | enum mirror, labels, icons, preset types                  |
| web      | `apps/web/src/models/exercise.ts`, `models/workspace.ts`                                              | `equipment`, `onboardingStage`                            |
| web      | `apps/web/src/lib/api.ts`                                                                             | `equipmentPresetsApi`, `onboardingApi`, `equipment` param |
| web      | `apps/web/src/lib/active-equipment-preset.ts` (+ `.test.ts`) (new)                                    | localStorage id                                           |
| web      | `apps/web/src/hooks/use-equipment-presets.ts` (new)                                                   | queries, mutations, `useActiveEquipmentPreset`            |
| web      | `apps/web/src/hooks/use-exercises.ts`                                                                 | `equipment` param                                         |
| web      | `apps/web/src/components/equipment/EquipmentTileGrid.tsx` (new)                                       | multi-select tiles                                        |
| web      | `apps/web/src/components/equipment/EquipmentFilterChip.tsx` (new)                                     | preset switcher chip                                      |
| web      | `apps/web/src/components/equipment/EquipmentPresetSheet.tsx` (new)                                    | add/edit preset                                           |
| web      | `apps/web/src/components/settings/EquipmentSettings.tsx` (new)                                        | settings card                                             |
| web      | `apps/web/src/pages/WelcomePage.tsx` (new)                                                            | onboarding                                                |
| web      | `apps/web/src/App.tsx`, `components/layout/AppLayout.tsx`, `lib/return-url.ts`                        | route + redirect                                          |
| web      | `apps/web/src/pages/exercises/ExercisesListPage.tsx`, `components/routines/ExercisePickerSheet.tsx`   | chip + filter + empty state                               |
| web      | `apps/web/src/pages/exercises/ExerciseDetailPage.tsx`, `components/exercises/ExerciseGuideEditor.tsx` | equipment display/edit                                    |
| web      | `apps/web/src/pages/Settings.tsx`                                                                     | Equipment tab                                             |

---

### Task 1: Domain enums

**Files:**

- Create: `packages/domain/src/equipment.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces: `enum Equipment { Barbell='barbell', Dumbbell='dumbbell', Kettlebell='kettlebell', Cable='cable', Machine='machine', SquatRack='squat_rack', Bench='bench', PullUpBar='pull_up_bar', ResistanceBand='resistance_band', Treadmill='treadmill', StationaryBike='stationary_bike', RowingMachine='rowing_machine' }` and `enum OnboardingStage { Equipment='equipment', Complete='complete' }`, exported from `@app/domain`.

- [ ] **Step 1: Create the enums**

`packages/domain/src/equipment.ts`:

```ts
/**
 * The closed set of equipment an exercise can require. An exercise lists everything it needs; an
 * empty list is a bodyweight movement.
 */
export enum Equipment {
    Barbell = 'barbell',
    Dumbbell = 'dumbbell',
    Kettlebell = 'kettlebell',
    Cable = 'cable',
    Machine = 'machine',
    SquatRack = 'squat_rack',
    Bench = 'bench',
    PullUpBar = 'pull_up_bar',
    ResistanceBand = 'resistance_band',
    Treadmill = 'treadmill',
    StationaryBike = 'stationary_bike',
    RowingMachine = 'rowing_machine',
}

/**
 * Where a workspace is in first-run setup, ordered. The web app sends the user to the screen for
 * the current stage; a new stage can be inserted and existing workspaces moved to it by migration.
 */
export enum OnboardingStage {
    Equipment = 'equipment',
    Complete = 'complete',
}
```

- [ ] **Step 2: Export from the index**

Add to `packages/domain/src/index.ts`:

```ts
export { Equipment, OnboardingStage } from './equipment.js';
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter @app/domain typecheck` (or `pnpm typecheck`)
Expected: clean.

```bash
git add packages/domain
git commit -m "feat(domain): add Equipment and OnboardingStage enums"
```

---

### Task 2: Database schema and migration

**Files:**

- Modify: `packages/db/src/schema/exercises.ts`
- Create: `packages/db/src/schema/equipment-presets.ts`
- Modify: `packages/db/src/schema/workspaces.ts`
- Modify: `packages/db/src/schema/index.ts`
- Generated: `packages/db/drizzle/0007_<name>.sql`, `packages/db/drizzle/meta/*`

**Interfaces:**

- Produces: `schema.exercises.equipment` (enum array), `schema.equipmentPresets` table (`id, workspaceId, name, equipment, createdAt, updatedAt`), `schema.workspaces.onboardingStage`, `equipmentEnum`, `onboardingStageEnum`.

- [ ] **Step 1: Add the equipment enum and column to exercises**

In `packages/db/src/schema/exercises.ts`, import `Equipment` alongside `TrackingType`:

```ts
import { Equipment, TrackingType } from '@app/domain';
```

Add after `trackingTypeEnum`:

```ts
export const equipmentEnum = pgEnum('equipment', [
    Equipment.Barbell,
    Equipment.Dumbbell,
    Equipment.Kettlebell,
    Equipment.Cable,
    Equipment.Machine,
    Equipment.SquatRack,
    Equipment.Bench,
    Equipment.PullUpBar,
    Equipment.ResistanceBand,
    Equipment.Treadmill,
    Equipment.StationaryBike,
    Equipment.RowingMachine,
]);
```

Add the column to `exercises` after `trackingType`:

```ts
        equipment: equipmentEnum('equipment')
            .array()
            .notNull()
            .default(sql`'{}'::equipment[]`),
```

- [ ] **Step 2: Add the presets table**

`packages/db/src/schema/equipment-presets.ts`:

```ts
import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { equipmentEnum } from './exercises.js';
import { workspaces } from './workspaces.js';

/**
 * A named set of equipment a workspace can filter its exercise library by — "Home", "Gym". Which
 * preset is active is a per-device choice kept in the browser, not a column here.
 */
export const equipmentPresets = pgTable(
    'equipment_presets',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        name: text('name').notNull(),
        equipment: equipmentEnum('equipment')
            .array()
            .notNull()
            .default(sql`'{}'::equipment[]`),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('equipment_presets_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        uniqueIndex('equipment_presets_workspace_id_name_uidx').on(table.workspaceId, table.name),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'equipment_presets_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
    ],
);
```

- [ ] **Step 3: Add the onboarding stage to workspaces**

In `packages/db/src/schema/workspaces.ts`, import `OnboardingStage` from `@app/domain` (add `@app/domain` is already a dependency of `@app/db` — `exercises.ts` imports it) and add after `workspaceRole`:

```ts
/** Mirrors `OnboardingStage` in `@app/domain`; the two must stay in step. */
export const onboardingStageEnum = pgEnum('onboarding_stage', [OnboardingStage.Equipment, OnboardingStage.Complete]);
```

Add the column to `workspaces` after `name`:

```ts
    onboardingStage: onboardingStageEnum('onboarding_stage').default(OnboardingStage.Equipment).notNull(),
```

- [ ] **Step 4: Export the new table**

Add to `packages/db/src/schema/index.ts` (after `./exercises.js`):

```ts
export * from './equipment-presets.js';
```

- [ ] **Step 5: Generate and read the migration**

Run: `pnpm --filter @app/db db:generate`
Expected: a new `packages/db/drizzle/0007_*.sql`. Open it and confirm it contains exactly:

- `CREATE TYPE "public"."equipment" AS ENUM(...)` with the 12 values;
- `CREATE TYPE "public"."onboarding_stage" AS ENUM('equipment', 'complete')`;
- `CREATE TABLE "equipment_presets" ...` with the FK, index and unique index;
- `ALTER TABLE "exercises" ADD COLUMN "equipment" "equipment"[] DEFAULT '{}'::equipment[] NOT NULL`;
- `ALTER TABLE "workspaces" ADD COLUMN "onboarding_stage" "onboarding_stage" DEFAULT 'equipment' NOT NULL`;
- **no `DROP`** of anything. If there is one, stop and fix the schema rather than committing it.

- [ ] **Step 6: Run the db package tests**

Run: `pnpm --filter @app/db test`
Expected: PASS (the test fixture applies the committed migrations, so a broken SQL file fails here).

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/db
git commit -m "feat(db): add exercise equipment, equipment presets and onboarding stage"
```

---

### Task 3: API contract

**Files:**

- Modify: `packages/api-contract/src/exercise.contract.ts`
- Create: `packages/api-contract/src/equipment-preset.contract.ts`
- Create: `packages/api-contract/src/onboarding.contract.ts`
- Modify: `packages/api-contract/src/workspace.contract.ts`
- Modify: `packages/api-contract/src/mcp-tool.contract.ts`
- Modify: `packages/api-contract/src/index.ts`
- Test: `packages/api-contract/src/exercise.contract.spec.ts`, `packages/api-contract/src/equipment-preset.contract.spec.ts` (new), `packages/api-contract/src/identity-contracts.spec.ts`

**Interfaces:**

- Produces: `equipmentListSchema`, `exerciseListQuerySchema.equipment: Equipment[] | undefined`, `equipmentPresetResponseSchema`, `equipmentPresetListResponseSchema`, `postEquipmentPresetRequestSchema`, `patchEquipmentPresetRequestSchema`, `patchOnboardingRequestSchema`, `onboardingResponseSchema`, and types `EquipmentPresetResponse`, `EquipmentPresetListResponse`, `PostEquipmentPresetRequest`, `PatchEquipmentPresetRequest`, `PatchOnboardingRequest`, `OnboardingResponse`. `workspaceListItemSchema` gains `onboardingStage`. `ExerciseResponse` gains `equipment`.

- [ ] **Step 1: Write the failing exercise contract tests**

Append to `packages/api-contract/src/exercise.contract.spec.ts` (import `Equipment` from `@app/domain` at the top):

```ts
describe('exercise equipment', () => {
    it('defaults equipment to an empty list on create and rejects duplicates', () => {
        expect(postExerciseRequestSchema.parse({ name: 'Plank', trackingType: 'duration' }).equipment).toEqual([]);
        expect(
            postExerciseRequestSchema.safeParse({
                name: 'Squat',
                trackingType: 'weight_reps',
                equipment: [Equipment.Barbell, Equipment.Barbell],
            }).success,
        ).toBe(false);
        expect(
            postExerciseRequestSchema.safeParse({ name: 'Squat', trackingType: 'weight_reps', equipment: ['vibes'] })
                .success,
        ).toBe(false);
    });

    it('parses the equipment list query as absent, empty, or a list', () => {
        expect(exerciseListQuerySchema.parse({}).equipment).toBeUndefined();
        expect(exerciseListQuerySchema.parse({ equipment: '' }).equipment).toEqual([]);
        expect(exerciseListQuerySchema.parse({ equipment: 'barbell,bench' }).equipment).toEqual([
            Equipment.Barbell,
            Equipment.Bench,
        ]);
        expect(exerciseListQuerySchema.safeParse({ equipment: 'barbell,vibes' }).success).toBe(false);
    });
});
```

Make sure `postExerciseRequestSchema` and `exerciseListQuerySchema` are imported in that spec.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @app/api-contract test`
Expected: FAIL (equipment undefined / unknown key).

- [ ] **Step 3: Implement the exercise contract changes**

In `packages/api-contract/src/exercise.contract.ts`, change the domain import to `import { Equipment, TrackingType } from '@app/domain';` and add near the top:

```ts
/** A set of equipment with no repeats. */
export const equipmentListSchema = z
    .array(z.enum(Equipment))
    .max(Object.values(Equipment).length)
    .refine((list) => new Set(list).size === list.length, { message: 'Equipment must not repeat' });
```

- `exerciseResponseSchema`: add `equipment: z.array(z.enum(Equipment)),` after `trackingType`.
- `exerciseListQuerySchema`: add
    ```ts
        /** Comma-separated. Absent: no filter. Empty: bodyweight only. Otherwise: only exercises needing a subset. */
        equipment: z
            .string()
            .optional()
            .transform((raw, ctx) => {
                if (raw === undefined) return undefined;
                const values = raw === '' ? [] : raw.split(',');
                const parsed = equipmentListSchema.safeParse(values);
                if (!parsed.success) {
                    ctx.addIssue({ code: 'custom', message: 'Unknown equipment' });
                    return z.NEVER;
                }
                return parsed.data;
            }),
    ```
- `postExerciseRequestSchema`: add `equipment: equipmentListSchema.default([]),`.
- `patchExerciseRequestSchema`: add `equipment: equipmentListSchema.optional(),`.

- [ ] **Step 4: Create the preset contract**

`packages/api-contract/src/equipment-preset.contract.ts`:

```ts
import { z } from 'zod';
import { equipmentListSchema } from './exercise.contract.js';
import { guidSchema } from './primitives.js';

const presetNameSchema = z.string().trim().min(1, 'Name is required').max(60, 'Name must not exceed 60 characters');

/** A named set of equipment a workspace can filter its library by. */
export const equipmentPresetResponseSchema = z.object({
    id: guidSchema,
    name: z.string(),
    equipment: equipmentListSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** The body of `GET /api/v1/workspaces/{workspaceId}/equipment-presets`. Unpaginated: a workspace keeps a handful. */
export const equipmentPresetListResponseSchema = z.object({
    data: z.array(equipmentPresetResponseSchema),
});

/** The body of `POST /api/v1/workspaces/{workspaceId}/equipment-presets`. */
export const postEquipmentPresetRequestSchema = z.object({
    name: presetNameSchema,
    equipment: equipmentListSchema.default([]),
});

/** The body of `PATCH /api/v1/workspaces/{workspaceId}/equipment-presets/{presetId}`. */
export const patchEquipmentPresetRequestSchema = z
    .object({
        name: presetNameSchema.optional(),
        equipment: equipmentListSchema.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

export type EquipmentPresetResponse = z.infer<typeof equipmentPresetResponseSchema>;
export type EquipmentPresetListResponse = z.infer<typeof equipmentPresetListResponseSchema>;
export type PostEquipmentPresetRequest = z.infer<typeof postEquipmentPresetRequestSchema>;
export type PatchEquipmentPresetRequest = z.infer<typeof patchEquipmentPresetRequestSchema>;
```

- [ ] **Step 5: Create the onboarding contract**

`packages/api-contract/src/onboarding.contract.ts`:

```ts
import { OnboardingStage } from '@app/domain';
import { z } from 'zod';

/** The body of `PATCH /api/v1/workspaces/{workspaceId}/onboarding`. */
export const patchOnboardingRequestSchema = z.object({
    stage: z.enum(OnboardingStage),
});

export const onboardingResponseSchema = z.object({
    stage: z.enum(OnboardingStage),
});

export type PatchOnboardingRequest = z.infer<typeof patchOnboardingRequestSchema>;
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;
```

- [ ] **Step 6: Add the stage to the workspace list item and the MCP tool args**

`packages/api-contract/src/workspace.contract.ts`: import `OnboardingStage` from `@app/domain` and add `onboardingStage: z.enum(OnboardingStage),` to `workspaceListItemSchema` after `role`. (`workspaceResponseSchema` is unchanged.)

`packages/api-contract/src/mcp-tool.contract.ts`: import `Equipment` from `@app/domain` and `equipmentListSchema` from `./exercise.contract.js`; add

- to `listExercisesToolArgsSchema`: `equipment: z.array(z.enum(Equipment)).nullish(),`
- to `createExerciseToolArgsSchema`: `equipment: equipmentListSchema.nullish(),`

(`updateExerciseToolArgsSchema` is `.partial()` of create, so it picks the field up.)

- [ ] **Step 7: Export and test**

Add to `packages/api-contract/src/index.ts` after `./exercise.contract.js`:

```ts
export * from './equipment-preset.contract.js';
export * from './onboarding.contract.js';
```

Create `packages/api-contract/src/equipment-preset.contract.spec.ts`:

```ts
import { Equipment, OnboardingStage } from '@app/domain';
import { describe, expect, it } from 'vitest';
import { patchEquipmentPresetRequestSchema, postEquipmentPresetRequestSchema } from './equipment-preset.contract.js';
import { patchOnboardingRequestSchema } from './onboarding.contract.js';

describe('equipment preset contracts', () => {
    it('trims the name, defaults equipment, and rejects an empty name', () => {
        expect(postEquipmentPresetRequestSchema.parse({ name: '  Home ' })).toEqual({ name: 'Home', equipment: [] });
        expect(postEquipmentPresetRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
        expect(postEquipmentPresetRequestSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
    });

    it('rejects repeated or unknown equipment', () => {
        expect(
            postEquipmentPresetRequestSchema.safeParse({
                name: 'Gym',
                equipment: [Equipment.Barbell, Equipment.Barbell],
            }).success,
        ).toBe(false);
        expect(postEquipmentPresetRequestSchema.safeParse({ name: 'Gym', equipment: ['hammer'] }).success).toBe(false);
    });

    it('requires at least one field on patch', () => {
        expect(patchEquipmentPresetRequestSchema.safeParse({}).success).toBe(false);
        expect(patchEquipmentPresetRequestSchema.safeParse({ equipment: [] }).success).toBe(true);
    });
});

describe('onboarding contract', () => {
    it('accepts a known stage only', () => {
        expect(patchOnboardingRequestSchema.parse({ stage: 'complete' }).stage).toBe(OnboardingStage.Complete);
        expect(patchOnboardingRequestSchema.safeParse({ stage: 'done' }).success).toBe(false);
    });
});
```

In `identity-contracts.spec.ts`, find the `describes the /me response, workspaces included` test and add `onboardingStage: 'equipment'` to the workspace object it parses (it will fail otherwise).

Run: `pnpm --filter @app/api-contract test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add packages/api-contract
git commit -m "feat(api-contract): add equipment, equipment presets and onboarding schemas"
```

---

### Task 4: Catalog format, content tagging and seed

**Files:**

- Modify: `packages/catalog/src/exercise-entry.ts`
- Modify: `packages/catalog/src/load-catalog.spec.ts`
- Modify: all 28 `content/exercises/*/exercise.json`
- Modify: `content/exercises/README.md`
- Modify: `packages/services/src/catalog-seed.service.ts`
- Test: `packages/services/src/catalog-seed.service.spec.ts`

**Interfaces:**

- Consumes: `Equipment` (Task 1), `schema.exercises.equipment` (Task 2).
- Produces: `ExerciseEntry.equipment: Equipment[]`.

- [ ] **Step 1: Failing catalog test**

In `packages/catalog/src/load-catalog.spec.ts`, add a test (follow the file's existing fixture pattern for writing a temp `exercise.json`):

```ts
it('defaults equipment to none and rejects an unknown value', () => {
    expect(exerciseEntrySchema.parse({ name: 'Plank', trackingType: 'duration' }).equipment).toEqual([]);
    expect(exerciseEntrySchema.safeParse({ name: 'X', trackingType: 'duration', equipment: ['laser'] }).success).toBe(
        false,
    );
});
```

Import `exerciseEntrySchema` from `./exercise-entry.js` if not already.

Run: `pnpm --filter @app/catalog test` — expected FAIL.

- [ ] **Step 2: Add the field**

In `packages/catalog/src/exercise-entry.ts`, import `Equipment` too and add to the schema after `trackingType`:

```ts
    /** Everything the movement requires. Empty means bodyweight. */
    equipment: z
        .array(z.enum(Equipment))
        .refine((list) => new Set(list).size === list.length, { message: 'Equipment must not repeat' })
        .default([]),
```

Run: `pnpm --filter @app/catalog test` — expected PASS.

- [ ] **Step 3: Tag every catalog entry**

Add an `"equipment": [...]` key to each `content/exercises/<slug>/exercise.json` directly after `"trackingType"`, using this table exactly:

| slug                    | equipment                   |
| ----------------------- | --------------------------- |
| barbell-back-squat      | `["barbell", "squat_rack"]` |
| barbell-bench-press     | `["barbell", "bench"]`      |
| barbell-deadlift        | `["barbell"]`               |
| barbell-hip-thrust      | `["barbell", "bench"]`      |
| barbell-overhead-press  | `["barbell"]`               |
| barbell-row             | `["barbell"]`               |
| cable-triceps-pushdown  | `["cable"]`                 |
| cycling                 | `[]`                        |
| dumbbell-bench-press    | `["dumbbell", "bench"]`     |
| dumbbell-biceps-curl    | `["dumbbell"]`              |
| dumbbell-lateral-raise  | `["dumbbell"]`              |
| dumbbell-row            | `["dumbbell", "bench"]`     |
| dumbbell-shoulder-press | `["dumbbell"]`              |
| goblet-squat            | `["dumbbell"]`              |
| lat-pulldown            | `["machine"]`               |
| leg-curl                | `["machine"]`               |
| leg-extension           | `["machine"]`               |
| leg-press               | `["machine"]`               |
| plank                   | `[]`                        |
| pull-up                 | `["pull_up_bar"]`           |
| push-up                 | `[]`                        |
| romanian-deadlift       | `["barbell"]`               |
| rowing                  | `["rowing_machine"]`        |
| running                 | `[]`                        |
| seated-cable-row        | `["cable"]`                 |
| side-plank              | `[]`                        |
| standing-calf-raise     | `[]`                        |
| walking-lunge           | `[]`                        |

A small script is fine (e.g. a Node one-off in the scratchpad that reads, sets `equipment`, and rewrites with 4-space JSON + trailing newline), but check `git diff --stat content/` shows 28 files and spot-read three.

Add to `content/exercises/README.md` after the tracking-type paragraph:

```md
`equipment` lists everything the movement requires (see `Equipment` in `@app/domain`); leave it
empty for bodyweight and outdoor work. `machine` covers pin- and plate-loaded machines; `cable` is a
cable stack.
```

- [ ] **Step 4: Failing seed test**

In `packages/services/src/catalog-seed.service.spec.ts`, find the existing "creates" and "updates" tests and add one:

```ts
it('writes and updates equipment', async () => {
    const exercise = loadedExercise({ slug: 'seed-equipment', equipment: [Equipment.Barbell] });
    const { id } = await seed.upsertExercise({ exercise });
    expect(await readEquipment(id)).toEqual([Equipment.Barbell]);

    const changed = await seed.upsertExercise({
        exercise: loadedExercise({ slug: 'seed-equipment', equipment: [Equipment.Barbell, Equipment.Bench] }),
    });
    expect(changed.outcome).toBe(SeedOutcome.Updated);
    expect(await readEquipment(id)).toEqual([Equipment.Barbell, Equipment.Bench]);
});
```

Adapt `loadedExercise` to whatever fixture builder the spec already uses (it will have one that builds a `LoadedExercise` with an `entry`; add `equipment` to that entry with default `[]`). Add a helper at the bottom of the spec:

```ts
async function readEquipment(id: string): Promise<Equipment[]> {
    const [row] = await db
        .select({ equipment: schema.exercises.equipment })
        .from(schema.exercises)
        .where(eq(schema.exercises.id, id));
    return row?.equipment ?? [];
}
```

Run: `pnpm --filter @app/services test -- catalog-seed` — expected FAIL (equipment `[]`).

- [ ] **Step 5: Seed writes equipment**

In `packages/services/src/catalog-seed.service.ts`:

- `desired` gains `equipment: exercise.entry.equipment,` after `trackingType`.
- `DesiredRow` gains `equipment: LoadedExercise['entry']['equipment'];`.
- `syncRow`'s `select` gains `equipment: exercises.equipment,` after `trackingType` so the JSON comparison sees it.

Run: `pnpm --filter @app/services test -- catalog-seed` — expected PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/catalog packages/services content
git commit -m "feat(catalog): tag exercises with required equipment"
```

---

### Task 5: ExercisesService equipment column and filter

**Files:**

- Modify: `packages/services/src/exercises.service.ts`
- Modify: `packages/services/src/testing.ts`
- Test: `packages/services/src/exercises.service.spec.ts`

**Interfaces:**

- Produces: `ExerciseSummary.equipment: Equipment[]`; `list({ ..., equipment?: Equipment[] })`; `create({ ..., equipment?: Equipment[] })`; `update({ ..., equipment?: Equipment[] })`; `seedCatalogExercise(db, { ..., equipment?: Equipment[] })`.

- [ ] **Step 1: Extend the test seed helper**

In `packages/services/src/testing.ts`, `seedCatalogExercise` params gain `equipment?: Equipment[]` and the insert gains `equipment: params.equipment ?? [],`. Import `Equipment` from `@app/domain`.

- [ ] **Step 2: Failing service tests**

Add to `packages/services/src/exercises.service.spec.ts` (import `Equipment`):

```ts
describe('equipment', () => {
    it('stores equipment on create and update', async () => {
        const created = await exercises.create({
            userId,
            workspaceId,
            name: 'Front squat',
            trackingType: TrackingType.WeightReps,
            equipment: [Equipment.Barbell, Equipment.SquatRack],
        });
        expect(created.equipment).toEqual([Equipment.Barbell, Equipment.SquatRack]);

        const updated = await exercises.update({ userId, workspaceId, exerciseId: created.id, equipment: [] });
        expect(updated.equipment).toEqual([]);
    });

    it('defaults to bodyweight', async () => {
        const created = await exercises.create({
            userId,
            workspaceId,
            name: 'Burpee',
            trackingType: TrackingType.WeightReps,
        });
        expect(created.equipment).toEqual([]);
    });

    describe('list filter', () => {
        const prefix = `filter-${randomUUID().slice(0, 8)}`;

        beforeAll(async () => {
            await seedCatalogExercise(db, { slug: `${prefix}-bw`, name: `${prefix} bodyweight`, equipment: [] });
            await seedCatalogExercise(db, {
                slug: `${prefix}-db`,
                name: `${prefix} dumbbell`,
                equipment: [Equipment.Dumbbell],
            });
            await seedCatalogExercise(db, {
                slug: `${prefix}-bb`,
                name: `${prefix} barbell bench`,
                equipment: [Equipment.Barbell, Equipment.Bench],
            });
        });

        const names = async (equipment?: Equipment[]): Promise<string[]> =>
            (await exercises.list({ userId, workspaceId, ...page, search: prefix, equipment })).data
                .map((e) => e.name)
                .sort();

        it('applies no filter when equipment is absent', async () => {
            expect(await names()).toEqual([`${prefix} barbell bench`, `${prefix} bodyweight`, `${prefix} dumbbell`]);
        });

        it('keeps only exercises whose equipment is a subset', async () => {
            expect(await names([Equipment.Dumbbell])).toEqual([`${prefix} bodyweight`, `${prefix} dumbbell`]);
            expect(await names([Equipment.Barbell])).toEqual([`${prefix} bodyweight`]);
            expect(await names([Equipment.Barbell, Equipment.Bench, Equipment.Dumbbell])).toEqual([
                `${prefix} barbell bench`,
                `${prefix} bodyweight`,
                `${prefix} dumbbell`,
            ]);
        });

        it('returns bodyweight only for an empty list', async () => {
            expect(await names([])).toEqual([`${prefix} bodyweight`]);
        });

        it('counts only the filtered rows', async () => {
            const result = await exercises.list({
                userId,
                workspaceId,
                ...page,
                search: prefix,
                equipment: [Equipment.Dumbbell],
            });
            expect(result.totalCount).toBe(2);
        });
    });
});
```

Run: `pnpm --filter @app/services test -- exercises.service` — expected FAIL.

- [ ] **Step 3: Implement**

In `packages/services/src/exercises.service.ts`:

- Import: `import type { Equipment, TrackingType } from '@app/domain';`
- `ExerciseSummary` gains `equipment: Equipment[];` after `trackingType`.
- `EXERCISE_SUMMARY_COLUMNS` gains `equipment: exercises.equipment,`.
- `list` params gain `equipment?: Equipment[]`; add a filter to the `scopedToWorkspaceOrGlobal` call:
    ```ts
                equipment === undefined ? undefined : requiresOnly(equipment),
    ```
    and add a module-level helper after the class:
    ```ts
    /**
     * Admits an exercise only if everything it needs is in `available`. Bodyweight rows (`'{}'`) are a
     * subset of any list, including an empty one, so they always pass.
     */
    function requiresOnly(available: Equipment[]): SQL {
        return sql`${exercises.equipment} <@ ${available}::equipment[]`;
    }
    ```
    Import `type SQL` from `drizzle-orm`. `node-postgres` serialises a JS array parameter as a Postgres array literal, so the cast makes the comparison typed. If the test shows the driver sending the array as JSON instead, build the literal explicitly: ``sql`${exercises.equipment} <@ ${`{${available.join(',')}}`}::equipment[]` `` (values are enum members, never user text).
- `create` params gain `equipment?: Equipment[]` and `.values({...})` gains `equipment: equipment ?? [],`.
- `update` params gain `equipment?: Equipment[]` and `.set({...})` gains `...(equipment === undefined ? {} : { equipment }),`.
- Update the `list` JSDoc `@param` to mention `equipment` semantics in one line.

Run: `pnpm --filter @app/services test -- exercises.service` — expected PASS.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add packages/services
git commit -m "feat(services): store exercise equipment and filter the library by it"
```

---

### Task 6: EquipmentPresetsService

**Files:**

- Create: `packages/services/src/equipment-presets.service.ts`
- Create: `packages/services/src/equipment-presets.service.spec.ts`
- Modify: `packages/services/src/index.ts`

**Interfaces:**

- Consumes: `schema.equipmentPresets`, `scopedToWorkspace`, `WorkspaceMembershipService`, `ConflictError`, `EntityNotFoundError`.
- Produces:

    ```ts
    type EquipmentPreset = { id: string; name: string; equipment: Equipment[]; createdAt: string; updatedAt: string };
    class EquipmentPresetsService {
        constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService });
        list({ userId, workspaceId }): Promise<EquipmentPreset[]>;             // ordered by name
        create({ userId, workspaceId, name, equipment }): Promise<EquipmentPreset>;
        update({ userId, workspaceId, presetId, name?, equipment? }): Promise<EquipmentPreset>;
        remove({ userId, workspaceId, presetId }): Promise<void>;
    }
    ```

- [ ] **Step 1: Failing tests**

`packages/services/src/equipment-presets.service.spec.ts`:

```ts
import { type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { Equipment } from '@app/domain';
import { ConflictError, EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EquipmentPresetsService } from './equipment-presets.service.js';
import { seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let presets: EquipmentPresetsService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    presets = new EquipmentPresetsService({ db, membership: new WorkspaceMembershipService({ db }) });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
});

afterAll(async () => {
    await database?.stop();
});

describe('create and list', () => {
    it('stores a preset and lists by name', async () => {
        await presets.create({ userId, workspaceId, name: 'Gym', equipment: [Equipment.Barbell, Equipment.Cable] });
        await presets.create({ userId, workspaceId, name: 'Home', equipment: [Equipment.Dumbbell] });

        const listed = await presets.list({ userId, workspaceId });

        expect(listed.map((preset) => preset.name)).toEqual(['Gym', 'Home']);
        expect(listed[0]?.equipment).toEqual([Equipment.Barbell, Equipment.Cable]);
    });

    it('rejects a duplicate name in the same workspace', async () => {
        await expect(presets.create({ userId, workspaceId, name: 'Gym', equipment: [] })).rejects.toBeInstanceOf(
            ConflictError,
        );
    });

    it('allows the same name in another workspace', async () => {
        await expect(
            presets.create({ userId: outsiderId, workspaceId: otherWorkspaceId, name: 'Gym', equipment: [] }),
        ).resolves.toMatchObject({ name: 'Gym' });
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(presets.list({ userId, workspaceId: otherWorkspaceId })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(
            presets.create({ userId, workspaceId: otherWorkspaceId, name: 'Sneaky', equipment: [] }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('update and remove', () => {
    it('updates only the fields given', async () => {
        const created = await presets.create({
            userId,
            workspaceId,
            name: 'Travel',
            equipment: [Equipment.ResistanceBand],
        });

        const renamed = await presets.update({ userId, workspaceId, presetId: created.id, name: 'Hotel' });
        expect(renamed).toMatchObject({ name: 'Hotel', equipment: [Equipment.ResistanceBand] });

        const retooled = await presets.update({ userId, workspaceId, presetId: created.id, equipment: [] });
        expect(retooled).toMatchObject({ name: 'Hotel', equipment: [] });
        expect(retooled.updatedAt > created.updatedAt).toBe(true);
    });

    it('rejects renaming onto an existing name', async () => {
        const created = await presets.create({ userId, workspaceId, name: 'Park', equipment: [] });

        await expect(
            presets.update({ userId, workspaceId, presetId: created.id, name: 'Home' }),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    it("answers 404 for another workspace's preset on update and remove", async () => {
        const theirs = await presets.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'Theirs',
            equipment: [],
        });

        await expect(presets.update({ userId, workspaceId, presetId: theirs.id, name: 'Mine' })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(presets.remove({ userId, workspaceId, presetId: theirs.id })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );

        const stillThere = await presets.list({ userId: outsiderId, workspaceId: otherWorkspaceId });
        expect(stillThere.some((preset) => preset.id === theirs.id)).toBe(true);
    });

    it('removes a preset', async () => {
        const created = await presets.create({ userId, workspaceId, name: 'Temp', equipment: [] });

        await presets.remove({ userId, workspaceId, presetId: created.id });

        const listed = await presets.list({ userId, workspaceId });
        expect(listed.some((preset) => preset.id === created.id)).toBe(false);
    });
});
```

Run: `pnpm --filter @app/services test -- equipment-presets` — expected FAIL (module not found).

- [ ] **Step 2: Implement the service**

`packages/services/src/equipment-presets.service.ts`:

```ts
import { schema, scopedToWorkspace, type Db } from '@app/db';
import type { Equipment } from '@app/domain';
import { ConflictError, EntityNotFoundError } from '@app/errors';
import { asc, eq } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { equipmentPresets } = schema;

export type EquipmentPreset = {
    id: string;
    name: string;
    equipment: Equipment[];
    createdAt: string;
    updatedAt: string;
};

/** Named equipment sets a workspace filters its exercise library by. */
export class EquipmentPresetsService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * Every preset in the workspace, by name.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async list({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<EquipmentPreset[]> {
        await this.membership.require({ userId, workspaceId });

        return this.db
            .select(PRESET_COLUMNS)
            .from(equipmentPresets)
            .where(scopedToWorkspace(equipmentPresets, workspaceId))
            .orderBy(asc(equipmentPresets.name));
    }

    /**
     * Creates a preset.
     *
     * @throws ConflictError when the workspace already has a preset with this name.
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async create({
        userId,
        workspaceId,
        name,
        equipment,
    }: {
        userId: string;
        workspaceId: string;
        name: string;
        equipment: Equipment[];
    }): Promise<EquipmentPreset> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .insert(equipmentPresets)
            .values({ workspaceId, name, equipment })
            .onConflictDoNothing()
            .returning(PRESET_COLUMNS);

        if (!row) throw new ConflictError('A preset with this name already exists');

        return row;
    }

    /**
     * Updates a preset. Only the fields present are written.
     *
     * @throws ConflictError when the new name is already taken in the workspace.
     * @throws EntityNotFoundError when the caller is not a member, or the preset is not in this workspace.
     */
    async update({
        userId,
        workspaceId,
        presetId,
        name,
        equipment,
    }: {
        userId: string;
        workspaceId: string;
        presetId: string;
        name?: string;
        equipment?: Equipment[];
    }): Promise<EquipmentPreset> {
        await this.membership.require({ userId, workspaceId });

        if (name !== undefined) {
            const [taken] = await this.db
                .select({ id: equipmentPresets.id })
                .from(equipmentPresets)
                .where(scopedToWorkspace(equipmentPresets, workspaceId, eq(equipmentPresets.name, name)));

            if (taken && taken.id !== presetId) throw new ConflictError('A preset with this name already exists');
        }

        const [row] = await this.db
            .update(equipmentPresets)
            .set({
                ...(name === undefined ? {} : { name }),
                ...(equipment === undefined ? {} : { equipment }),
                updatedAt: new Date().toISOString(),
            })
            .where(scopedToWorkspace(equipmentPresets, workspaceId, eq(equipmentPresets.id, presetId)))
            .returning(PRESET_COLUMNS);

        if (!row) throw new EntityNotFoundError('Equipment preset not found');

        return row;
    }

    /**
     * Deletes a preset.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the preset is not in this workspace.
     */
    async remove({
        userId,
        workspaceId,
        presetId,
    }: {
        userId: string;
        workspaceId: string;
        presetId: string;
    }): Promise<void> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .delete(equipmentPresets)
            .where(scopedToWorkspace(equipmentPresets, workspaceId, eq(equipmentPresets.id, presetId)))
            .returning({ id: equipmentPresets.id });

        if (!row) throw new EntityNotFoundError('Equipment preset not found');
    }
}

const PRESET_COLUMNS = {
    id: equipmentPresets.id,
    name: equipmentPresets.name,
    equipment: equipmentPresets.equipment,
    createdAt: equipmentPresets.createdAt,
    updatedAt: equipmentPresets.updatedAt,
};
```

Check `ConflictError`'s constructor signature in `packages/errors/src/app-error.ts:134` and match it (it may take `(title, detail?)`).

Export from `packages/services/src/index.ts`:

```ts
export { EquipmentPresetsService, type EquipmentPreset } from './equipment-presets.service.js';
```

Run: `pnpm --filter @app/services test -- equipment-presets` — expected PASS.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add packages/services
git commit -m "feat(services): add EquipmentPresetsService"
```

---

### Task 7: Onboarding stage in WorkspacesService and UsersService

**Files:**

- Modify: `packages/services/src/workspaces.service.ts`
- Modify: `packages/services/src/users.service.ts`
- Test: `packages/services/src/workspaces.service.spec.ts`, `packages/services/src/users.service.spec.ts`

**Interfaces:**

- Produces: `WorkspacesService.setOnboardingStage({ userId, workspaceId, stage }): Promise<{ stage: OnboardingStage }>`; `WorkspaceListItem.onboardingStage` and `UserWorkspaceListItem.onboardingStage` (both `OnboardingStage`).

- [ ] **Step 1: Failing tests**

In `packages/services/src/workspaces.service.spec.ts` add (import `OnboardingStage` from `@app/domain`, `EntityNotFoundError` if missing; reuse the spec's existing `workspaces` service instance and seeded users):

```ts
describe('setOnboardingStage', () => {
    it('starts at equipment and moves to complete', async () => {
        const ownerId = await seedUser(db, 'Onboarding');
        const workspaceId = await seedWorkspace(db, ownerId);

        const before = await workspaces.listForUser(ownerId);
        expect(before[0]?.onboardingStage).toBe(OnboardingStage.Equipment);

        await expect(
            workspaces.setOnboardingStage({ userId: ownerId, workspaceId, stage: OnboardingStage.Complete }),
        ).resolves.toEqual({ stage: OnboardingStage.Complete });

        const after = await workspaces.listForUser(ownerId);
        expect(after[0]?.onboardingStage).toBe(OnboardingStage.Complete);
    });

    it('refuses a non-member', async () => {
        const ownerId = await seedUser(db);
        const strangerId = await seedUser(db);
        const workspaceId = await seedWorkspace(db, ownerId);

        await expect(
            workspaces.setOnboardingStage({ userId: strangerId, workspaceId, stage: OnboardingStage.Complete }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});
```

In `packages/services/src/users.service.spec.ts`, the `getUser` test's `toEqual(expect.arrayContaining([...]))` objects gain `onboardingStage: OnboardingStage.Equipment`.

Run: `pnpm --filter @app/services test -- workspaces.service users.service` — expected FAIL.

- [ ] **Step 2: Implement**

`packages/services/src/workspaces.service.ts`:

- Import `OnboardingStage` from `@app/domain`.
- `WorkspaceListItem` type gains `onboardingStage: OnboardingStage;`.
- `listForUser` select gains `onboardingStage: workspaces.onboardingStage,`.
- Add method after `get`:
    ```ts
        /**
         * Records where the workspace is in first-run setup. Idempotent.
         *
         * @throws EntityNotFoundError when the caller is not a member.
         */
        async setOnboardingStage({
            userId,
            workspaceId,
            stage,
        }: {
            userId: string;
            workspaceId: string;
            stage: OnboardingStage;
        }): Promise<{ stage: OnboardingStage }> {
            await this.membership.require({ userId, workspaceId });

            await this.db
                .update(workspaces)
                .set({ onboardingStage: stage, updatedAt: new Date().toISOString() })
                .where(eq(workspaces.id, workspaceId));

            return { stage };
        }
    ```
    (`workspaces` is not a workspace-_owned_ table — it _is_ the tenant — so `eq(workspaces.id, …)` after `membership.require` is the existing pattern in this file; see `get`.)

`packages/services/src/users.service.ts`:

- `UserWorkspaceListItem` gains `onboardingStage: OnboardingStage;` (import type from `@app/domain`).
- `loadWorkspaces` select gains `onboardingStage: workspaces.onboardingStage,`.

Run: `pnpm --filter @app/services test` — expected PASS (whole package; `mcp-access-tokens` or others may read workspace lists).

- [ ] **Step 3: Commit**

```bash
pnpm format
git add packages/services
git commit -m "feat(services): expose and update the workspace onboarding stage"
```

---

### Task 8: API routes — exercises filter, equipment presets, onboarding

**Files:**

- Modify: `apps/api/src/exercises/exercises.controller.ts`
- Create: `apps/api/src/equipment-presets/equipment-presets.controller.ts`, `equipment-presets.module.ts`, `equipment-presets.providers.ts`
- Create: `apps/api/src/onboarding/onboarding.controller.ts`, `onboarding.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/route-guard-coverage.e2e.spec.ts` (MCP_TOKEN_ROUTES only if a tool needs it — none does here; **do not add the new routes**)
- Create: `apps/api/test/equipment-presets.e2e.spec.ts`, `apps/api/test/onboarding.e2e.spec.ts`
- Modify: `apps/api/test/exercises.e2e.spec.ts`

**Interfaces:**

- Consumes: Task 3 schemas, Task 5–7 services.
- Produces routes: `GET/POST /api/v1/workspaces/:workspaceId/equipment-presets`, `PATCH/DELETE …/equipment-presets/:presetId`, `PATCH /api/v1/workspaces/:workspaceId/onboarding`. Session-only (`SessionAuthGuard`).

- [ ] **Step 1: Failing e2e tests**

`apps/api/test/equipment-presets.e2e.spec.ts` (copy the `signUpUser` helper from `exercises.e2e.spec.ts`):

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

let app: TestApp;

async function signUpUser(): Promise<{ cookie: string; workspaceId: string }> {
    const email = `presets-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';
    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });
    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { workspaces: { workspaceId: string }[] };
    return { cookie, workspaceId: body.workspaces[0]?.workspaceId as string };
}

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('equipment preset routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${randomUUID()}/equipment-presets`,
        });
        expect(response.statusCode).toBe(401);
    });

    it('creates, lists, updates and deletes a preset', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const base = `/api/v1/workspaces/${workspaceId}/equipment-presets`;

        const created = await app.inject({
            method: 'POST',
            url: base,
            headers: { cookie },
            payload: { name: 'Home', equipment: ['dumbbell', 'bench'] },
        });
        expect(created.statusCode).toBe(201);
        const preset = JSON.parse(created.body) as { id: string; name: string; equipment: string[] };
        expect(preset).toMatchObject({ name: 'Home', equipment: ['dumbbell', 'bench'] });

        const listed = await app.inject({ method: 'GET', url: base, headers: { cookie } });
        expect(JSON.parse(listed.body)).toEqual({ data: [expect.objectContaining({ id: preset.id })] });

        const patched = await app.inject({
            method: 'PATCH',
            url: `${base}/${preset.id}`,
            headers: { cookie },
            payload: { equipment: [] },
        });
        expect(patched.statusCode).toBe(200);
        expect(JSON.parse(patched.body)).toMatchObject({ name: 'Home', equipment: [] });

        const deleted = await app.inject({ method: 'DELETE', url: `${base}/${preset.id}`, headers: { cookie } });
        expect(deleted.statusCode).toBe(204);

        const after = await app.inject({ method: 'GET', url: base, headers: { cookie } });
        expect(JSON.parse(after.body)).toEqual({ data: [] });
    });

    it('answers 409 for a duplicate name', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const base = `/api/v1/workspaces/${workspaceId}/equipment-presets`;
        await app.inject({ method: 'POST', url: base, headers: { cookie }, payload: { name: 'Gym' } });

        const duplicate = await app.inject({
            method: 'POST',
            url: base,
            headers: { cookie },
            payload: { name: 'Gym' },
        });
        expect(duplicate.statusCode).toBe(409);
    });

    it("answers 404 for another workspace's preset and for a malformed id", async () => {
        const owner = await signUpUser();
        const outsider = await signUpUser();
        const created = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${owner.workspaceId}/equipment-presets`,
            headers: { cookie: owner.cookie },
            payload: { name: 'Theirs' },
        });
        const presetId = (JSON.parse(created.body) as { id: string }).id;

        const listed = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${owner.workspaceId}/equipment-presets`,
            headers: { cookie: outsider.cookie },
        });
        expect(listed.statusCode).toBe(404);

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${outsider.workspaceId}/equipment-presets/${presetId}`,
            headers: { cookie: outsider.cookie },
            payload: { name: 'Mine' },
        });
        expect(patched.statusCode).toBe(404);

        const malformed = await app.inject({
            method: 'DELETE',
            url: `/api/v1/workspaces/${outsider.workspaceId}/equipment-presets/not-a-uuid`,
            headers: { cookie: outsider.cookie },
        });
        expect(malformed.statusCode).toBe(404);
    });
});
```

`apps/api/test/onboarding.e2e.spec.ts` (same helper):

```ts
describe('onboarding route', () => {
    it('reports the stage on /me and updates it', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const before = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
        expect(
            (JSON.parse(before.body) as { workspaces: { onboardingStage: string }[] }).workspaces[0]?.onboardingStage,
        ).toBe('equipment');

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/onboarding`,
            headers: { cookie },
            payload: { stage: 'complete' },
        });
        expect(patched.statusCode).toBe(200);
        expect(JSON.parse(patched.body)).toEqual({ stage: 'complete' });

        const after = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
        expect(
            (JSON.parse(after.body) as { workspaces: { onboardingStage: string }[] }).workspaces[0]?.onboardingStage,
        ).toBe('complete');
    });

    it('rejects an unknown stage and a foreign workspace', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const other = await signUpUser();

        const bad = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/onboarding`,
            headers: { cookie },
            payload: { stage: 'done' },
        });
        expect(bad.statusCode).toBe(400);

        const foreign = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${other.workspaceId}/onboarding`,
            headers: { cookie },
            payload: { stage: 'complete' },
        });
        expect(foreign.statusCode).toBe(404);
    });
});
```

In `apps/api/test/exercises.e2e.spec.ts` add:

```ts
it('filters the list by available equipment', async () => {
    const { cookie, workspaceId } = await signUpUser();
    const tag = randomUUID().slice(0, 8);
    await createExercise({ cookie, workspaceId, payload: { name: `${tag} plank`, trackingType: 'duration' } });
    await createExercise({
        cookie,
        workspaceId,
        payload: { name: `${tag} curl`, trackingType: 'weight_reps', equipment: ['dumbbell'] },
    });

    const filtered = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${workspaceId}/exercises?search=${tag}&equipment=`,
        headers: { cookie },
    });
    const body = JSON.parse(filtered.body) as { data: { name: string; equipment: string[] }[]; totalCount: number };
    expect(body.totalCount).toBe(1);
    expect(body.data[0]).toMatchObject({ name: `${tag} plank`, equipment: [] });

    const invalid = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${workspaceId}/exercises?equipment=hammer`,
        headers: { cookie },
    });
    expect(invalid.statusCode).toBe(400);
});
```

Run: `pnpm --filter @app/api test` — expected FAIL (404 routes, missing fields).

- [ ] **Step 2: Wire the exercises filter**

In `apps/api/src/exercises/exercises.controller.ts` `listExercises`, add `equipment: query.equipment,` to the `list` call. `createExercise`/`patchExercise` already spread `...body`, so `equipment` flows through.

- [ ] **Step 3: Equipment presets module**

`apps/api/src/equipment-presets/equipment-presets.providers.ts`:

```ts
import { type Db } from '@app/db';
import { EquipmentPresetsService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `EquipmentPresetsService` factory provider below. */
export const EQUIPMENT_PRESETS_SERVICE = Symbol('EQUIPMENT_PRESETS_SERVICE');

/** Split out from the module file to avoid a circular import between it and its controller. */
export const equipmentPresetServiceProviders: Provider[] = [
    {
        provide: EQUIPMENT_PRESETS_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): EquipmentPresetsService =>
            new EquipmentPresetsService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
```

`apps/api/src/equipment-presets/equipment-presets.controller.ts`:

```ts
import {
    guidSchema,
    patchEquipmentPresetRequestSchema,
    postEquipmentPresetRequestSchema,
    type EquipmentPresetListResponse,
    type EquipmentPresetResponse,
    type PatchEquipmentPresetRequest,
    type PostEquipmentPresetRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { EquipmentPresetsService } from '@app/services';
import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { EQUIPMENT_PRESETS_SERVICE } from './equipment-presets.providers.js';

/** Named equipment sets the workspace filters its exercise library by. */
@Controller('v1/workspaces/:workspaceId/equipment-presets')
@UseGuards(SessionAuthGuard)
export class EquipmentPresetsController {
    constructor(@Inject(EQUIPMENT_PRESETS_SERVICE) private readonly presets: EquipmentPresetsService) {}

    /** Every preset in the workspace, by name. */
    @Get()
    async listPresets(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
    ): Promise<EquipmentPresetListResponse> {
        return { data: await this.presets.list({ userId: currentUser.userId, workspaceId }) };
    }

    /** Creates a preset. */
    @Post()
    @HttpCode(201)
    async createPreset(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postEquipmentPresetRequestSchema) body: PostEquipmentPresetRequest,
    ): Promise<EquipmentPresetResponse> {
        return this.presets.create({ userId: currentUser.userId, workspaceId, ...body });
    }

    /** Updates a preset. An omitted key leaves the stored value alone. */
    @Patch(':presetId')
    async patchPreset(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'presetId', schema: guidSchema }) presetId: string,
        @ValidatedBody(patchEquipmentPresetRequestSchema) body: PatchEquipmentPresetRequest,
    ): Promise<EquipmentPresetResponse> {
        return this.presets.update({ userId: currentUser.userId, workspaceId, presetId, ...body });
    }

    /** Deletes a preset. */
    @Delete(':presetId')
    @HttpCode(204)
    async deletePreset(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'presetId', schema: guidSchema }) presetId: string,
    ): Promise<void> {
        await this.presets.remove({ userId: currentUser.userId, workspaceId, presetId });
    }
}
```

Check `SessionAuthGuard` is exported from `@app/nest-common` (grep `export.*SessionAuthGuard` in `packages/nest-common/src`); `me.controller.ts` uses it, copy its import.

`apps/api/src/equipment-presets/equipment-presets.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EquipmentPresetsController } from './equipment-presets.controller.js';
import { equipmentPresetServiceProviders } from './equipment-presets.providers.js';

/** Wires `/api/v1/workspaces/:workspaceId/equipment-presets`. */
@Module({
    controllers: [EquipmentPresetsController],
    providers: [...equipmentPresetServiceProviders],
})
export class EquipmentPresetsModule {}
```

- [ ] **Step 4: Onboarding module**

`apps/api/src/onboarding/onboarding.controller.ts`:

```ts
import {
    guidSchema,
    patchOnboardingRequestSchema,
    type OnboardingResponse,
    type PatchOnboardingRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { WorkspacesService } from '@app/services';
import { Controller, Inject, Patch, UseGuards } from '@nestjs/common';
import { WORKSPACES_SERVICE } from '../workspaces/workspaces.providers.js';

/** First-run setup progress. The stage is read from `GET /me`; this only moves it. */
@Controller('v1/workspaces/:workspaceId/onboarding')
@UseGuards(SessionAuthGuard)
export class OnboardingController {
    constructor(@Inject(WORKSPACES_SERVICE) private readonly workspaces: WorkspacesService) {}

    /** Records the workspace's onboarding stage. Idempotent. */
    @Patch()
    async patchOnboarding(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(patchOnboardingRequestSchema) body: PatchOnboardingRequest,
    ): Promise<OnboardingResponse> {
        return this.workspaces.setOnboardingStage({ userId: currentUser.userId, workspaceId, stage: body.stage });
    }
}
```

`apps/api/src/onboarding/onboarding.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { workspaceServiceProviders } from '../workspaces/workspaces.providers.js';
import { OnboardingController } from './onboarding.controller.js';

/** Wires `/api/v1/workspaces/:workspaceId/onboarding`. */
@Module({
    controllers: [OnboardingController],
    providers: [...workspaceServiceProviders],
})
export class OnboardingModule {}
```

Add both modules to `apps/api/src/app.module.ts` `imports` after `WorkspacesModule`: `EquipmentPresetsModule, OnboardingModule`.

- [ ] **Step 5: Run the API suite**

Run: `pnpm --filter @app/api test`
Expected: PASS, including `route-guard-coverage.e2e.spec.ts` — the new routes carry `SessionAuthGuard` only, so they need no allowlist entry. If that spec fails naming the new routes, the guard on them is wrong; fix the controller, do not touch the allowlist. `me.e2e.spec.ts` may need `onboardingStage` added to any exact-shape assertion.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/api
git commit -m "feat(api): add equipment preset and onboarding routes, equipment filter on exercises"
```

---

### Task 9: MCP list tool passes equipment

**Files:**

- Modify: `apps/mcp/src/mcp/tools/exercise.tools.ts`
- Test: `apps/mcp/src/mcp/tool-execution.spec.ts` or whichever spec exercises `ListExercises` args (grep `listExercisesToolArgsSchema` / `ListExercises` under `apps/mcp/src`).

- [ ] **Step 1: Pass the argument**

In `ListExercises`'s handler `query`, add `equipment: args.equipment == null ? undefined : args.equipment.join(','),`. Extend the description with: `"Pass equipment (a list of equipment values) to keep only exercises that need nothing beyond it; an empty list means bodyweight only. Each exercise's equipment lists what it requires."`

`CreateExercise`/`UpdateExercise` handlers forward `args` as the body — confirm `equipment` reaches the body (if the handler picks fields explicitly, add `equipment: args.equipment ?? undefined`).

- [ ] **Step 2: Test**

If the MCP spec has a test that asserts the query forwarded for `ListExercises`, add `equipment: ['barbell']` → expects `equipment: 'barbell'` in the query. Otherwise add one following that spec's stub-client pattern.

Run: `pnpm --filter @app/mcp test && pnpm --filter @app/mcp typecheck` — expected PASS.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add apps/mcp
git commit -m "feat(mcp): accept an equipment filter on list_exercises"
```

---

### Task 10: Web models, API client, active preset, hooks

**Files:**

- Create: `apps/web/src/models/equipment.ts`
- Modify: `apps/web/src/models/exercise.ts`, `apps/web/src/models/workspace.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/active-equipment-preset.ts`, `apps/web/src/lib/active-equipment-preset.test.ts`
- Create: `apps/web/src/hooks/use-equipment-presets.ts`
- Modify: `apps/web/src/hooks/use-exercises.ts`

**Interfaces:**

- Produces:
    - `Equipment`, `OnboardingStage` (re-exported from `@app/domain`), `EQUIPMENT_META: Record<Equipment, { label: string; icon: LucideIcon }>`, `EQUIPMENT_ORDER: Equipment[]`, `type EquipmentPreset`, `type SaveEquipmentPresetRequest`, `type PatchEquipmentPresetRequest`, `summarizeEquipment(equipment: Equipment[]): string`.
    - `readActiveEquipmentPresetId(): string | null`, `writeActiveEquipmentPresetId(id: string | null): void`, `resolveActivePreset({ storedId, presets }): EquipmentPreset | null`.
    - `equipmentPresetsApi.{list,create,update,remove}`, `onboardingApi.setStage`.
    - `useEquipmentPresets({ workspaceId })`, `useCreateEquipmentPreset`, `useUpdateEquipmentPreset`, `useDeleteEquipmentPreset`, `useActiveEquipmentPreset({ workspaceId }): { preset: EquipmentPreset | null; presets: EquipmentPreset[]; isLoading: boolean; setActive: (id: string | null) => void }`.
    - `useExercises({ ..., equipment?: Equipment[] })`.

- [ ] **Step 1: Models**

`apps/web/src/models/equipment.ts`:

```ts
import {
    Anchor,
    Armchair,
    Bike,
    Cable,
    CircleDot,
    Dumbbell,
    Footprints,
    Grip,
    Landmark,
    Minus,
    Ship,
    Weight,
    type LucideIcon,
} from 'lucide-react';

import { Equipment, OnboardingStage } from '@app/domain';

// The web app imports the vocabulary from its owner (vite aliases `@app/domain` to the package
// source, as the session components already rely on); re-exported so pages import one module.
export { Equipment, OnboardingStage };

/** Display order for tile grids: free weights, then stations, then cardio. */
export const EQUIPMENT_ORDER: Equipment[] = [
    Equipment.Barbell,
    Equipment.Dumbbell,
    Equipment.Kettlebell,
    Equipment.SquatRack,
    Equipment.Bench,
    Equipment.PullUpBar,
    Equipment.Cable,
    Equipment.Machine,
    Equipment.ResistanceBand,
    Equipment.Treadmill,
    Equipment.StationaryBike,
    Equipment.RowingMachine,
];

/** Label and icon per equipment value — the only place they are written. */
export const EQUIPMENT_META: Record<Equipment, { label: string; icon: LucideIcon }> = {
    [Equipment.Barbell]: { label: 'Barbell', icon: Minus },
    [Equipment.Dumbbell]: { label: 'Dumbbells', icon: Dumbbell },
    [Equipment.Kettlebell]: { label: 'Kettlebell', icon: Weight },
    [Equipment.Cable]: { label: 'Cable machine', icon: Cable },
    [Equipment.Machine]: { label: 'Weight machines', icon: Landmark },
    [Equipment.SquatRack]: { label: 'Squat rack', icon: Grip },
    [Equipment.Bench]: { label: 'Bench', icon: Armchair },
    [Equipment.PullUpBar]: { label: 'Pull-up bar', icon: Anchor },
    [Equipment.ResistanceBand]: { label: 'Resistance bands', icon: CircleDot },
    [Equipment.Treadmill]: { label: 'Treadmill', icon: Footprints },
    [Equipment.StationaryBike]: { label: 'Stationary bike', icon: Bike },
    [Equipment.RowingMachine]: { label: 'Rowing machine', icon: Ship },
};

/** A named set of equipment the library can be filtered by. */
export type EquipmentPreset = {
    id: string;
    name: string;
    equipment: Equipment[];
    createdAt: string;
    updatedAt: string;
};

export type SaveEquipmentPresetRequest = { name: string; equipment: Equipment[] };
export type PatchEquipmentPresetRequest = { name?: string; equipment?: Equipment[] };

/** "Bodyweight only", "Barbell, Bench" or "Barbell, Bench +3". */
export function summarizeEquipment(equipment: Equipment[]): string {
    if (equipment.length === 0) return 'Bodyweight only';
    const ordered = EQUIPMENT_ORDER.filter((value) => equipment.includes(value));
    const shown = ordered.slice(0, 2).map((value) => EQUIPMENT_META[value].label);
    const rest = ordered.length - shown.length;
    return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}
```

Verify each lucide icon name exists in the installed `lucide-react` (`grep -c "export { default as Landmark" node_modules/lucide-react/dist/lucide-react.d.ts` or check `apps/web/node_modules/lucide-react/dist/esm/icons/`); swap any missing one for an existing icon.

`apps/web/src/models/exercise.ts`: import `type { Equipment }` from `./equipment`; add `equipment: Equipment[];` to `Exercise`, `equipment?: Equipment[];` to `SaveExerciseRequest` and `PatchExerciseRequest`.

`apps/web/src/models/workspace.ts`: import `OnboardingStage` from `./equipment` and add `onboardingStage: OnboardingStage;` to `WorkspaceListItem`.

- [ ] **Step 2: API client**

In `apps/web/src/lib/api.ts`:

- `exercisesApi.getAll` params gain `equipment?: string` (comma-joined; `''` allowed). Because axios drops `undefined` but keeps `''`, callers pass `equipment.join(',')` when filtering and `undefined` otherwise.
- Add:

    ```ts
    /** Named equipment sets for the library filter. */
    export const equipmentPresetsApi = {
        list: async (workspaceId: string): Promise<EquipmentPreset[]> =>
            (await httpClient.get<{ data: EquipmentPreset[] }>(`/api/v1/workspaces/${workspaceId}/equipment-presets`))
                .data,
        create: (workspaceId: string, data: SaveEquipmentPresetRequest) =>
            httpClient.post<EquipmentPreset>(`/api/v1/workspaces/${workspaceId}/equipment-presets`, data),
        update: ({
            workspaceId,
            presetId,
            data,
        }: {
            workspaceId: string;
            presetId: string;
            data: PatchEquipmentPresetRequest;
        }) =>
            httpClient.patch<EquipmentPreset>(`/api/v1/workspaces/${workspaceId}/equipment-presets/${presetId}`, data),
        remove: ({ workspaceId, presetId }: { workspaceId: string; presetId: string }) =>
            httpClient.delete<void>(`/api/v1/workspaces/${workspaceId}/equipment-presets/${presetId}`),
    };

    /** First-run setup progress. */
    export const onboardingApi = {
        setStage: ({ workspaceId, stage }: { workspaceId: string; stage: OnboardingStage }) =>
            httpClient.patch<{ stage: OnboardingStage }>(`/api/v1/workspaces/${workspaceId}/onboarding`, { stage }),
    };
    ```

    with the matching type imports from `@/models/equipment`.

- [ ] **Step 3: Failing active-preset test**

`apps/web/src/lib/active-equipment-preset.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Equipment, type EquipmentPreset } from '@/models/equipment';
import {
    readActiveEquipmentPresetId,
    resolveActivePreset,
    writeActiveEquipmentPresetId,
} from './active-equipment-preset';

const preset = (id: string): EquipmentPreset => ({
    id,
    name: id,
    equipment: [Equipment.Barbell],
    createdAt: '',
    updatedAt: '',
});

describe('active equipment preset storage', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips an id and clears on null', () => {
        writeActiveEquipmentPresetId('abc');
        expect(readActiveEquipmentPresetId()).toBe('abc');
        writeActiveEquipmentPresetId(null);
        expect(readActiveEquipmentPresetId()).toBeNull();
    });

    it('resolves to the matching preset, or null when missing or stale', () => {
        const presets = [preset('a'), preset('b')];
        expect(resolveActivePreset({ storedId: 'b', presets })?.id).toBe('b');
        expect(resolveActivePreset({ storedId: null, presets })).toBeNull();
        expect(resolveActivePreset({ storedId: 'gone', presets })).toBeNull();
    });
});
```

`vite.config.ts` sets no vitest environment, so put `// @vitest-environment jsdom` as the first line of this test file (`jsdom` 25.0.1 is already a devDependency).

Run: `pnpm --filter @app/web test` — expected FAIL.

- [ ] **Step 4: Implement the storage helpers**

`apps/web/src/lib/active-equipment-preset.ts`:

```ts
import type { EquipmentPreset } from '@/models/equipment';

const STORAGE_KEY = 'active-equipment-preset';

/** The preset id this device filters by, or null for "all equipment". Storage failures read as null. */
export function readActiveEquipmentPresetId(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

/** Remembers the device's active preset; null turns the filter off. */
export function writeActiveEquipmentPresetId(id: string | null): void {
    try {
        if (id === null) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, id);
    } catch {
        /* A device that cannot remember the choice still filters for this page load. */
    }
}

/** The stored preset if it still exists; a deleted or foreign id means no filter. */
export function resolveActivePreset({
    storedId,
    presets,
}: {
    storedId: string | null;
    presets: EquipmentPreset[];
}): EquipmentPreset | null {
    if (storedId === null) return null;
    return presets.find((preset) => preset.id === storedId) ?? null;
}
```

Run: `pnpm --filter @app/web test` — expected PASS.

- [ ] **Step 5: Hooks**

`apps/web/src/hooks/use-equipment-presets.ts`:

```ts
import { useCallback, useState } from 'react';
import {
    useMutation,
    useQuery,
    useQueryClient,
    type UseMutationResult,
    type UseQueryResult,
} from '@tanstack/react-query';
import { equipmentPresetsApi } from '@/lib/api';
import {
    readActiveEquipmentPresetId,
    resolveActivePreset,
    writeActiveEquipmentPresetId,
} from '@/lib/active-equipment-preset';
import type { EquipmentPreset, PatchEquipmentPresetRequest, SaveEquipmentPresetRequest } from '@/models/equipment';

const presetsKey = (workspaceId: string): [string, string] => ['equipment-presets', workspaceId];

/** Every preset in the workspace, by name. */
export function useEquipmentPresets({
    workspaceId,
}: {
    workspaceId: string;
}): UseQueryResult<EquipmentPreset[], Error> {
    return useQuery({
        queryKey: presetsKey(workspaceId),
        queryFn: () => equipmentPresetsApi.list(workspaceId),
        enabled: Boolean(workspaceId),
    });
}

/**
 * The device's active preset resolved against the workspace's presets. A stored id that no longer
 * matches (deleted, or from another account on this browser) reads as no filter.
 */
export function useActiveEquipmentPreset({ workspaceId }: { workspaceId: string }): {
    preset: EquipmentPreset | null;
    presets: EquipmentPreset[];
    isLoading: boolean;
    setActive: (id: string | null) => void;
} {
    const { data, isLoading } = useEquipmentPresets({ workspaceId });
    const [storedId, setStoredId] = useState(readActiveEquipmentPresetId);
    const presets = data ?? [];

    const setActive = useCallback((id: string | null): void => {
        writeActiveEquipmentPresetId(id);
        setStoredId(id);
    }, []);

    return { preset: resolveActivePreset({ storedId, presets }), presets, isLoading, setActive };
}

/** Creates a preset and refreshes the list. */
export function useCreateEquipmentPreset({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<EquipmentPreset, Error, SaveEquipmentPresetRequest> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: SaveEquipmentPresetRequest) => equipmentPresetsApi.create(workspaceId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: presetsKey(workspaceId) });
        },
    });
}

/** Updates a preset and refreshes the list. */
export function useUpdateEquipmentPreset({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<EquipmentPreset, Error, { presetId: string; data: PatchEquipmentPresetRequest }> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ presetId, data }) => equipmentPresetsApi.update({ workspaceId, presetId, data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: presetsKey(workspaceId) });
        },
    });
}

/** Deletes a preset, clears it as the device's active choice if it was, and refreshes the list. */
export function useDeleteEquipmentPreset({
    workspaceId,
}: {
    workspaceId: string;
}): UseMutationResult<void, Error, string> {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (presetId: string) => equipmentPresetsApi.remove({ workspaceId, presetId }),
        onSuccess: (_result, presetId) => {
            if (readActiveEquipmentPresetId() === presetId) writeActiveEquipmentPresetId(null);
            queryClient.invalidateQueries({ queryKey: presetsKey(workspaceId) });
        },
    });
}
```

Note: several components may each call `useActiveEquipmentPreset`; their `storedId` state is per-instance, which is fine because the chip and the list it filters live in the same component (Task 12). Do not lift this into a context.

`apps/web/src/hooks/use-exercises.ts` `useExercises`: add `equipment?: Equipment[]` param (import type from `@/models/equipment`); include `equipment: equipment?.join(',') ?? null` in the query key object; pass `equipment: equipment === undefined ? undefined : equipment.join(',')` to `exercisesApi.getAll`.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web lint && pnpm --filter @app/web test`
Expected: clean. (`ExercisesListPage`/picker still compile because `equipment` is optional.)

```bash
pnpm format
git add apps/web
git commit -m "feat(web): add equipment models, preset client and active-preset storage"
```

---

### Task 11: EquipmentTileGrid, onboarding page and redirect

**Files:**

- Create: `apps/web/src/components/equipment/EquipmentTileGrid.tsx`
- Create: `apps/web/src/pages/WelcomePage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/layout/AppLayout.tsx`, `apps/web/src/lib/return-url.ts`

**Interfaces:**

- Produces: `EquipmentTileGrid({ value: Equipment[]; onChange(next: Equipment[]): void; disabled?: boolean; 'aria-label'?: string })`.

- [ ] **Step 1: Tile grid**

`apps/web/src/components/equipment/EquipmentTileGrid.tsx`:

```tsx
import { Check } from 'lucide-react';
import { EQUIPMENT_META, EQUIPMENT_ORDER, type Equipment } from '@/models/equipment';
import { cn } from '@/lib/utils';

type EquipmentTileGridProps = {
    value: Equipment[];
    onChange: (next: Equipment[]) => void;
    disabled?: boolean;
    'aria-label'?: string;
};

/** Multi-select tiles, one per equipment value. Big targets, obvious checked state, one-thumb friendly. */
export function EquipmentTileGrid({
    value,
    onChange,
    disabled,
    'aria-label': ariaLabel,
}: EquipmentTileGridProps): JSX.Element {
    const toggle = (item: Equipment): void => {
        onChange(value.includes(item) ? value.filter((other) => other !== item) : [...value, item]);
    };

    return (
        <div role="group" aria-label={ariaLabel ?? 'Equipment'} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {EQUIPMENT_ORDER.map((item) => {
                const { label, icon: Icon } = EQUIPMENT_META[item];
                const selected = value.includes(item);
                return (
                    <button
                        key={item}
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        disabled={disabled}
                        onClick={() => toggle(item)}
                        className={cn(
                            'relative flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                            selected
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'border-border bg-card hover:bg-secondary',
                        )}
                    >
                        {selected && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" aria-hidden />}
                        <Icon className="h-6 w-6" aria-hidden />
                        <span className="text-center leading-tight">{label}</span>
                    </button>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 2: Welcome page**

`apps/web/src/pages/WelcomePage.tsx`:

```tsx
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Brand } from '@/components/layout/Brand';
import { EquipmentTileGrid } from '@/components/equipment/EquipmentTileGrid';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCreateEquipmentPreset } from '@/hooks/use-equipment-presets';
import { toast } from '@/hooks/use-toast';
import { onboardingApi } from '@/lib/api';
import { writeActiveEquipmentPresetId } from '@/lib/active-equipment-preset';
import { OnboardingStage, type Equipment } from '@/models/equipment';

/**
 * First-run setup: name a preset and tap the equipment on hand. Full-screen, no nav — the user is
 * not in the app yet. Skipping still completes the stage so the screen does not come back.
 */
export default function WelcomePage(): JSX.Element {
    const { refreshUser } = useAuth();
    const { currentWorkspace, workspaceId, isLoading } = useWorkspace();
    const navigate = useNavigate();
    const createPreset = useCreateEquipmentPreset({ workspaceId });
    const [name, setName] = useState('My gym');
    const [equipment, setEquipment] = useState<Equipment[]>([]);
    const [isSkipping, setSkipping] = useState(false);

    if (isLoading) return <FullPageSpinner />;
    if (!currentWorkspace) return <Navigate to="/" replace />;
    if (currentWorkspace.onboardingStage !== OnboardingStage.Equipment) return <Navigate to="/" replace />;

    const complete = async (): Promise<void> => {
        await onboardingApi.setStage({ workspaceId, stage: OnboardingStage.Complete });
        await refreshUser();
        navigate('/', { replace: true });
    };

    const handleContinue = (event: React.FormEvent): void => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed || createPreset.isPending) return;
        createPreset.mutate(
            { name: trimmed, equipment },
            {
                onSuccess: (preset) => {
                    writeActiveEquipmentPresetId(preset.id);
                    void complete().catch(() =>
                        toast({ title: 'Saved your equipment, but couldn’t finish setup. Try again.' }),
                    );
                },
                onError: () => toast({ title: 'Couldn’t save your equipment. Try again.' }),
            },
        );
    };

    const handleSkip = (): void => {
        setSkipping(true);
        void complete()
            .catch(() => toast({ title: 'Couldn’t finish setup. Try again.' }))
            .finally(() => setSkipping(false));
    };

    const busy = createPreset.isPending || isSkipping;

    return (
        <div className="min-h-screen bg-background">
            <form
                onSubmit={handleContinue}
                className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-8 md:px-8"
            >
                <Brand />
                <div className="mt-8">
                    <p className="eyebrow mb-3">Welcome</p>
                    <h1 className="page-title">What do you train with?</h1>
                    <p className="mt-2 text-muted-foreground">
                        Tap everything you have. We’ll hide exercises that need gear you don’t — you can add more setups
                        later, like a home and a gym.
                    </p>
                </div>
                <div className="mt-8 space-y-2">
                    <Label htmlFor="preset-name">Call this setup</Label>
                    <Input
                        id="preset-name"
                        value={name}
                        maxLength={60}
                        onChange={(event) => setName(event.target.value)}
                        className="h-12"
                    />
                </div>
                <div className="mt-6">
                    <EquipmentTileGrid
                        value={equipment}
                        onChange={setEquipment}
                        disabled={busy}
                        aria-label="Equipment you have"
                    />
                    <p className="mt-3 text-xs text-muted-foreground">Nothing selected means bodyweight only.</p>
                </div>
                <div className="mt-auto flex flex-col gap-3 pt-8">
                    <Button type="submit" size="lg" className="h-12 gap-2" disabled={!name.trim() || busy}>
                        {createPreset.isPending ? 'Saving…' : 'Continue'}
                        <ArrowRight aria-hidden />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={busy}
                        onClick={handleSkip}
                    >
                        Skip for now
                    </Button>
                </div>
            </form>
        </div>
    );
}
```

Check `Brand` from `components/layout/Brand.tsx` renders standalone (read it); if it needs props, pass what `AuthLayout.tsx` passes. Check `eyebrow` / `page-title` classes exist in `index.css` (Settings uses them).

- [ ] **Step 3: Route and redirect**

`apps/web/src/App.tsx`:

- `const WelcomePage = lazy(() => import('./pages/WelcomePage'));`
- Add inside the `SessionLayout` route, before the `/` app route:
    ```tsx
    <Route
        path="/welcome"
        element={
            <ProtectedRoute>
                <WelcomePage />
            </ProtectedRoute>
        }
    />
    ```

`apps/web/src/components/layout/AppLayout.tsx`: import `Navigate` from `react-router-dom` and `OnboardingStage` from `@/models/equipment`; after the `NotFoundError` guard add:

```tsx
if (currentWorkspace?.onboardingStage === OnboardingStage.Equipment) return <Navigate to="/welcome" replace />;
```

`apps/web/src/lib/return-url.ts`: leave `/welcome` **off** the allowlist (a return URL into onboarding makes no sense; the redirect handles it).

- [ ] **Step 4: Verify**

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web lint && pnpm --filter @app/web build`
Expected: clean.

```bash
pnpm format
git add apps/web
git commit -m "feat(web): add equipment onboarding step"
```

---

### Task 12: Equipment filter chip on the library and pickers

**Files:**

- Create: `apps/web/src/components/equipment/EquipmentFilterChip.tsx`
- Modify: `apps/web/src/pages/exercises/ExercisesListPage.tsx`
- Modify: `apps/web/src/components/routines/ExercisePickerSheet.tsx`

**Interfaces:**

- Consumes: `useActiveEquipmentPreset` (Task 10).
- Produces: `EquipmentFilterChip({ preset, presets, onSelect(id: string | null), showManageLink?: boolean })`.

- [ ] **Step 1: Chip**

`apps/web/src/components/equipment/EquipmentFilterChip.tsx`:

```tsx
import { Check, ChevronDown, Settings2, SlidersHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { summarizeEquipment, type EquipmentPreset } from '@/models/equipment';
import { cn } from '@/lib/utils';

type EquipmentFilterChipProps = {
    preset: EquipmentPreset | null;
    presets: EquipmentPreset[];
    onSelect: (id: string | null) => void;
    /** Only on pages where leaving is safe — never inside a session's picker. */
    showManageLink?: boolean;
};

/** Shows which equipment preset the list is filtered by and switches it in place. */
export function EquipmentFilterChip({
    preset,
    presets,
    onSelect,
    showManageLink = false,
}: EquipmentFilterChipProps): JSX.Element | null {
    if (presets.length === 0 && !showManageLink) return null;

    const rows: { id: string | null; label: string; detail?: string }[] = [
        { id: null, label: 'All equipment' },
        ...presets.map((row) => ({ id: row.id, label: row.name, detail: summarizeEquipment(row.equipment) })),
    ];

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant={preset ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-10 gap-2 rounded-full"
                    aria-label="Filter by equipment"
                >
                    <SlidersHorizontal className="h-4 w-4" aria-hidden />
                    <span className="max-w-[10rem] truncate">{preset ? preset.name : 'All equipment'}</span>
                    <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
                <ul role="listbox" aria-label="Equipment preset" className="space-y-1">
                    {rows.map((row) => {
                        const selected = (preset?.id ?? null) === row.id;
                        return (
                            <li key={row.id ?? 'all'}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    onClick={() => onSelect(row.id)}
                                    className={cn(
                                        'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                                        selected ? 'bg-primary/5 font-medium' : 'hover:bg-secondary',
                                    )}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate">{row.label}</span>
                                        {row.detail && (
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {row.detail}
                                            </span>
                                        )}
                                    </span>
                                    {selected && <Check className="h-4 w-4 text-primary" aria-hidden />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
                {showManageLink && (
                    <Link
                        to="/settings?tab=equipment"
                        className="mt-1 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-secondary"
                    >
                        <Settings2 className="h-4 w-4" aria-hidden />
                        Manage equipment
                    </Link>
                )}
            </PopoverContent>
        </Popover>
    );
}
```

- [ ] **Step 2: Exercises page**

In `apps/web/src/pages/exercises/ExercisesListPage.tsx`:

- `const active = useActiveEquipmentPreset({ workspaceId });`
- Pass `equipment: active.preset?.equipment` to `useExercises`.
- Render `<EquipmentFilterChip preset={active.preset} presets={active.presets} onSelect={active.setActive} showManageLink />` next to the existing archived toggle / search controls (read the JSX between the header and the list; put the chip in the same controls row).
- Empty state: where the page renders its "no exercises" `EmptyState`, branch: if `active.preset` is set and `search` is empty and `exercises.length === 0`, render
    ```tsx
    <EmptyState
        title={`Nothing matches your ${active.preset.name} equipment`}
        description="Every exercise in your library needs something this setup doesn’t have."
        actionLabel="Show all equipment"
        onAction={() => active.setActive(null)}
    />
    ```
- Rows: show `summarizeEquipment(exercise.equipment)` as a muted secondary line only when `exercise.equipment.length > 0` (keep rows compact; bodyweight rows show nothing extra).

- [ ] **Step 3: Picker sheet**

In `apps/web/src/components/routines/ExercisePickerSheet.tsx`:

- `const active = useActiveEquipmentPreset({ workspaceId });`
- Pass `equipment: active.preset?.equipment` to `useExercises`.
- Under the search input, render `<div className="px-4 pt-2"><EquipmentFilterChip preset={active.preset} presets={active.presets} onSelect={active.setActive} /></div>` (no manage link).
- When `!isLoading && exercises.length === 0 && trimmed.length === 0 && active.preset`, render inside the list area:
    ```tsx
    <EmptyState
        title={`Nothing matches your ${active.preset.name} equipment`}
        description="Switch preset or show all equipment to keep adding."
        actionLabel="Show all equipment"
        onAction={() => active.setActive(null)}
    />
    ```
- The inline "Create" row: pass `equipment: []` explicitly is unnecessary (API defaults); leave the create call as is.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web lint && pnpm --filter @app/web test`
Expected: clean.

```bash
pnpm format
git add apps/web
git commit -m "feat(web): filter the exercise library and pickers by the active equipment preset"
```

---

### Task 13: Equipment settings

**Files:**

- Create: `apps/web/src/components/equipment/EquipmentPresetSheet.tsx`
- Create: `apps/web/src/components/settings/EquipmentSettings.tsx`
- Modify: `apps/web/src/pages/Settings.tsx`

**Interfaces:**

- Produces: `EquipmentPresetSheet({ workspaceId, open, onOpenChange, preset: EquipmentPreset | null })` (null = create).

- [ ] **Step 1: Preset sheet**

`apps/web/src/components/equipment/EquipmentPresetSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { EquipmentTileGrid } from '@/components/equipment/EquipmentTileGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCreateEquipmentPreset, useUpdateEquipmentPreset } from '@/hooks/use-equipment-presets';
import { toast } from '@/hooks/use-toast';
import type { Equipment, EquipmentPreset } from '@/models/equipment';

type EquipmentPresetSheetProps = {
    workspaceId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Null creates a new preset. */
    preset: EquipmentPreset | null;
};

/** Name a preset and tick its equipment. One sheet serves both create and edit. */
export function EquipmentPresetSheet({
    workspaceId,
    open,
    onOpenChange,
    preset,
}: EquipmentPresetSheetProps): JSX.Element {
    const [name, setName] = useState('');
    const [equipment, setEquipment] = useState<Equipment[]>([]);
    const create = useCreateEquipmentPreset({ workspaceId });
    const update = useUpdateEquipmentPreset({ workspaceId });

    // Re-seed each time the sheet opens so an abandoned edit does not bleed into the next one.
    useEffect(() => {
        if (!open) return;
        setName(preset?.name ?? '');
        setEquipment(preset?.equipment ?? []);
    }, [open, preset]);

    const isPending = create.isPending || update.isPending;

    const handleSubmit = (event: React.FormEvent): void => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed || isPending) return;
        const onError = (error: Error): void => {
            toast({
                title:
                    isAxiosError(error) && error.response?.status === 409
                        ? 'You already have a preset with that name.'
                        : 'Couldn’t save the preset. Try again.',
            });
        };
        const onSuccess = (): void => {
            toast({ title: preset ? 'Preset updated' : 'Preset added' });
            onOpenChange(false);
        };
        if (preset) update.mutate({ presetId: preset.id, data: { name: trimmed, equipment } }, { onSuccess, onError });
        else create.mutate({ name: trimmed, equipment }, { onSuccess, onError });
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                className="flex max-h-[90vh] flex-col rounded-t-2xl p-0 md:mx-auto md:max-w-2xl"
            >
                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <SheetHeader className="px-4 pt-4 text-left">
                        <SheetTitle>{preset ? 'Edit preset' : 'New preset'}</SheetTitle>
                        <SheetDescription>Tap everything available in this setup.</SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="preset-name">Name</Label>
                            <Input
                                id="preset-name"
                                value={name}
                                maxLength={60}
                                required
                                placeholder="e.g. Home"
                                onChange={(event) => setName(event.target.value)}
                                className="h-11"
                            />
                        </div>
                        <EquipmentTileGrid value={equipment} onChange={setEquipment} disabled={isPending} />
                    </div>
                    <SheetFooter className="border-t px-4 py-3">
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!name.trim() || isPending}>
                            {isPending ? 'Saving…' : preset ? 'Save changes' : 'Add preset'}
                        </Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
}
```

Check `SheetFooter` is exported from `components/ui/sheet.tsx`; if not, use a plain `div` with the same classes.

- [ ] **Step 2: Settings card**

`apps/web/src/components/settings/EquipmentSettings.tsx`:

```tsx
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { EquipmentPresetSheet } from '@/components/equipment/EquipmentPresetSheet';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDeleteEquipmentPreset, useEquipmentPresets } from '@/hooks/use-equipment-presets';
import { toast } from '@/hooks/use-toast';
import { summarizeEquipment, type EquipmentPreset } from '@/models/equipment';

/** The workspace's equipment presets: add, edit, delete. Which one is active is chosen on the library itself. */
export function EquipmentSettings(): JSX.Element {
    const { workspaceId } = useWorkspace();
    const { data: presets, isLoading, isError, refetch } = useEquipmentPresets({ workspaceId });
    const remove = useDeleteEquipmentPreset({ workspaceId });
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editing, setEditing] = useState<EquipmentPreset | null>(null);
    const [deleting, setDeleting] = useState<EquipmentPreset | null>(null);

    const openCreate = (): void => {
        setEditing(null);
        setSheetOpen(true);
    };
    const openEdit = (preset: EquipmentPreset): void => {
        setEditing(preset);
        setSheetOpen(true);
    };
    const confirmDelete = (): void => {
        if (!deleting) return;
        remove.mutate(deleting.id, {
            onSuccess: () => toast({ title: 'Preset deleted' }),
            onError: () => toast({ title: 'Couldn’t delete the preset. Try again.' }),
            onSettled: () => setDeleting(null),
        });
    };

    return (
        <Card className="shadow-none">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                    <CardTitle className="text-xl">My equipment</CardTitle>
                    <CardDescription>
                        A preset for each place you train. Pick one on the library to hide exercises you can’t do.
                    </CardDescription>
                </div>
                <Button className="gap-2" onClick={openCreate}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Add preset
                </Button>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <LoadingState label="Loading presets…" />
                ) : isError ? (
                    <EmptyState
                        title="Presets couldn’t load"
                        description="Check your connection and try again."
                        actionLabel="Try again"
                        onAction={() => void refetch()}
                    />
                ) : presets && presets.length > 0 ? (
                    <ul className="divide-y">
                        {presets.map((preset) => (
                            <li key={preset.id} className="flex items-center gap-3 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">{preset.name}</p>
                                    <p className="truncate text-sm text-muted-foreground">
                                        {summarizeEquipment(preset.equipment)}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Edit ${preset.name}`}
                                    onClick={() => openEdit(preset)}
                                >
                                    <Pencil className="h-4 w-4" aria-hidden />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Delete ${preset.name}`}
                                    onClick={() => setDeleting(preset)}
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyState
                        title="No presets yet"
                        description="Add one for your gym, one for home — then switch between them on the library."
                        actionLabel="Add preset"
                        onAction={openCreate}
                    />
                )}
            </CardContent>
            <EquipmentPresetSheet
                workspaceId={workspaceId}
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                preset={editing}
            />
            <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                            If it’s the preset you’re filtering by, the library goes back to showing all equipment.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
                            {remove.isPending ? 'Deleting…' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
```

- [ ] **Step 3: Settings tab**

In `apps/web/src/pages/Settings.tsx`: import `Dumbbell` from `lucide-react` and `EquipmentSettings`; add `{ value: 'equipment', label: 'Equipment', icon: Dumbbell }` to `tabs` after `preferences`; add

```tsx
<TabsContent value="equipment" className="m-0 focus-visible:outline-none">
    <EquipmentSettings />
</TabsContent>
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web lint`
Expected: clean.

```bash
pnpm format
git add apps/web
git commit -m "feat(web): manage equipment presets from settings"
```

---

### Task 14: Equipment on custom exercises and the detail page

**Files:**

- Modify: `apps/web/src/pages/exercises/ExercisesListPage.tsx` (create dialog)
- Modify: `apps/web/src/pages/exercises/ExerciseDetailPage.tsx`
- Modify: `apps/web/src/components/exercises/ExerciseGuideEditor.tsx`

- [ ] **Step 1: Create dialog**

In `ExercisesListPage.tsx`: add `const [equipment, setEquipment] = useState<Equipment[]>([]);` reset in `openCreate`; pass `equipment` in `createExercise.mutate({ name, trackingType, equipment })`; in the dialog after the tracking-type fieldset add

```tsx
<fieldset>
    <legend className="mb-3 text-sm font-medium">What does it need?</legend>
    <EquipmentTileGrid value={equipment} onChange={setEquipment} aria-label="Required equipment" />
    <p className="mt-2 text-xs text-muted-foreground">Leave empty for bodyweight.</p>
</fieldset>
```

The dialog may need `max-h-[90vh] overflow-y-auto` on `DialogContent` to stay usable on a phone with the grid added.

- [ ] **Step 2: Detail page badges**

In `ExerciseDetailPage.tsx`, in the header badge row, after the tracking-type badge, render one `Badge variant="outline"` per equipment value (`EQUIPMENT_META[value].label`, in `EQUIPMENT_ORDER` order); when `exercise.equipment.length === 0` render a single `Badge variant="outline">Bodyweight</Badge>`.

- [ ] **Step 3: Guide editor**

In `ExerciseGuideEditor.tsx`:

- Add `const [equipment, setEquipment] = useState<Equipment[]>([]);` seeded in the same `useEffect` that seeds the guide fields: `setEquipment(exercise.equipment);`.
- Find the `updateExercise.mutate(` call that saves the guide fields (line ~115) and include `equipment` in its data.
- Include `equipment` in the editor's dirty check (grep `isDirty` / the comparison used for the discard confirmation) — compare sorted arrays: `[...equipment].sort().join() !== [...exercise.equipment].sort().join()`.
- Render `<EquipmentTileGrid value={equipment} onChange={setEquipment} aria-label="Required equipment" />` in a section titled "Equipment" above the guide text areas.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web lint && pnpm --filter @app/web test && pnpm --filter @app/web build`
Expected: clean.

```bash
pnpm format
git add apps/web
git commit -m "feat(web): set and show required equipment on exercises"
```

---

### Task 15: Whole-repo verification

**Files:** none new.

- [ ] **Step 1: Full checks**

Run, in order, and paste the tail of each:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all pass. If `pnpm format` changed files, commit them as `style: format`.

- [ ] **Step 2: Migration sanity against a live dev database (optional, if Docker Compose is up)**

```bash
pnpm --filter @app/db db:migrate
pnpm --filter @app/admin start seed-exercises
```

Expected: migration applies; seed reports every catalog exercise `updated` once (equipment written), and `unchanged` on a second run.

- [ ] **Step 3: Commit anything outstanding**

```bash
git status --short
```

Expected: clean.

---

## Self-review notes

- Spec coverage: vocabulary (T1), data model (T2), catalog (T4), exercises API (T3/T5/T8), presets API (T3/T6/T8), onboarding (T3/T7/T8), MCP (T9), web onboarding (T11), active preset (T10), filter chip + empty state (T12), settings (T13), custom exercises + detail (T14), tests throughout.
- `equipmentListSchema` is defined in `exercise.contract.ts` and imported by `equipment-preset.contract.ts` and `mcp-tool.contract.ts`; index exports both files, so consumers import from `@app/api-contract`.
- `useActiveEquipmentPreset` signature `{ preset, presets, isLoading, setActive }` is what T12 destructures as `active.*`.
- `apps/web/src/models/equipment.ts` re-exports `Equipment`/`OnboardingStage` from `@app/domain` (the vite alias + `paths` mapping already exist; `RestTimer.tsx` is precedent). No mirror enums.
