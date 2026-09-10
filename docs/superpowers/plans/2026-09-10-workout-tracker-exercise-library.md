# Workout Tracker — Exercise Library & Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the exercise library — exercises with a tracking type, a structured how-to guide, guide images, and external reference links — end to end through every layer.

**Architecture:** Follows the template's `Item` slice exactly: a Zod schema in `packages/api-contract` first, a Drizzle table in `packages/db`, a plain service class in `packages/services`, a thin NestJS controller in `apps/api`, MCP tools that call the API over HTTP, and React pages in `apps/web`. Which measurement fields a tracking type requires is decided once by a pure function in `packages/domain` and reused everywhere else.

**Tech Stack:** TypeScript, NestJS + Fastify, Drizzle + Postgres, Zod, vitest + testcontainers, React + Vite + Tailwind + shadcn/ui, S3/MinIO via `@app/storage`.

**Spec:** `docs/superpowers/specs/2026-09-10-workout-tracker-phase-1-design.md`

This is plan 1 of 4 for Phase 1. Later plans cover routines, the sessions API and state machine, and workout mode's UI.

## Global Constraints

- **Never use `any`** — not in source, not in tests, no `oxlint-disable` for it. Where a cast is unavoidable use `as unknown as X`.
- **`type` over `interface`** unless a class implements it.
- **`enum` for closed sets of values** — a TypeScript enum, read by Zod via `z.enum(MyEnum)`, never a const array with a derived union.
- **Explicit return type on every function and method.**
- **Object arguments** when a function takes two or more parameters.
- **JSDoc on every public method and exported function.** Concise; document a parameter only when it adds information beyond its name.
- **Comments explain why, never what**, and never describe the change being made.
- **Helpers are declared after their caller** so a file reads top-down.
- **Never `throw new Error(...)`** — always a typed error from `@app/errors`.
- **Every workspace-scoped query uses `scopedToWorkspace(table, workspaceId, ...filters)`** from `@app/db`. Never a hand-written `eq(table.workspaceId, id)` alongside other filters.
- **Every service method calls `membership.require({ userId, workspaceId })` before its query.** Both halves, every time.
- **A caller who may not see a workspace gets `EntityNotFoundError` (404), never 403.**
- **Canonical units only:** kilograms, metres, seconds.
- **Exact dependency versions** — no `^` or `~`. `pnpm add --save-exact` inside the workspace that needs it.
- **Formatting:** oxfmt — 4-space indent, single quotes, 120-character print width, trailing commas on multi-line. Run `pnpm format`, don't hand-format.
- **Commits follow Conventional Commits:** `<type>(<scope>): <description>`, scopes `api | mcp | web | db | auth`.
- **Migrations:** after any schema change run `pnpm --filter @app/db db:generate` and commit the generated SQL. Read the SQL before applying, especially any `DROP`.

---

### Task 1: Tracking types in `packages/domain`

Which measurement fields a set must carry is decided by the exercise's tracking type. This is the single source of that rule — the Zod refinement, the database check constraint, and the web client's choice of input widget all derive from it. It is pure logic with no I/O, so it lives in `packages/domain`.

**Files:**
- Create: `packages/domain/src/tracking-type.ts`
- Test: `packages/domain/src/tracking-type.spec.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `enum TrackingType { WeightReps = 'weight_reps', Duration = 'duration', DistanceTime = 'distance_time' }`; `type SetMeasurements = { weightKg?: number | null; reps?: number | null; durationSeconds?: number | null; distanceM?: number | null }`; `requiredMeasurementFields(trackingType: TrackingType): ReadonlyArray<keyof SetMeasurements>`; `validateSetMeasurements({ trackingType, measurements }): { valid: true } | { valid: false; missing: ReadonlyArray<keyof SetMeasurements>; unexpected: ReadonlyArray<keyof SetMeasurements> }`.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/tracking-type.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { TrackingType, requiredMeasurementFields, validateSetMeasurements } from './tracking-type.js';

describe('requiredMeasurementFields', () => {
    it('requires reps for a weight_reps exercise, but not the load', () => {
        expect(requiredMeasurementFields(TrackingType.WeightReps)).toEqual(['reps']);
    });

    it('requires duration for a duration exercise', () => {
        expect(requiredMeasurementFields(TrackingType.Duration)).toEqual(['durationSeconds']);
    });

    it('requires both distance and duration for a distance_time exercise', () => {
        expect(requiredMeasurementFields(TrackingType.DistanceTime)).toEqual(['distanceM', 'durationSeconds']);
    });
});

describe('validateSetMeasurements', () => {
    it('accepts a weight_reps set with load and reps', () => {
        const result = validateSetMeasurements({
            trackingType: TrackingType.WeightReps,
            measurements: { weightKg: 60, reps: 8 },
        });

        expect(result).toEqual({ valid: true });
    });

    it('accepts a bodyweight set with reps and no load', () => {
        expect(
            validateSetMeasurements({ trackingType: TrackingType.WeightReps, measurements: { reps: 12 } }),
        ).toEqual({ valid: true });
    });

    it('reports a missing required field', () => {
        const result = validateSetMeasurements({
            trackingType: TrackingType.Duration,
            measurements: { reps: 10 },
        });

        expect(result).toEqual({ valid: false, missing: ['durationSeconds'], unexpected: ['reps'] });
    });

    it('reports a field that does not belong to this tracking type', () => {
        const result = validateSetMeasurements({
            trackingType: TrackingType.DistanceTime,
            measurements: { distanceM: 5000, durationSeconds: 1500, weightKg: 20 },
        });

        expect(result).toEqual({ valid: false, missing: [], unexpected: ['weightKg'] });
    });

    it('treats null the same as absent', () => {
        const result = validateSetMeasurements({
            trackingType: TrackingType.WeightReps,
            measurements: { reps: null, weightKg: null },
        });

        expect(result).toEqual({ valid: false, missing: ['reps'], unexpected: [] });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @app/domain test -- tracking-type`
Expected: FAIL — cannot resolve `./tracking-type.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/tracking-type.ts`:

```typescript
/** How an exercise's work is measured. Decides which fields a logged set must carry. */
export enum TrackingType {
    WeightReps = 'weight_reps',
    Duration = 'duration',
    DistanceTime = 'distance_time',
}

/** The measurement fields a set may carry, in canonical units: kilograms, metres, seconds. */
export type SetMeasurements = {
    weightKg?: number | null;
    reps?: number | null;
    durationSeconds?: number | null;
    distanceM?: number | null;
};

export type SetMeasurementsValidation =
    | { valid: true }
    | { valid: false; missing: ReadonlyArray<keyof SetMeasurements>; unexpected: ReadonlyArray<keyof SetMeasurements> };

/**
 * The measurement fields a set of this tracking type must carry.
 *
 * Load is deliberately absent for `WeightReps`: a bodyweight movement is a weight/reps exercise
 * with no load, and requiring a zero would make "unloaded" and "zero kilograms" indistinguishable.
 */
export function requiredMeasurementFields(trackingType: TrackingType): ReadonlyArray<keyof SetMeasurements> {
    return REQUIRED_FIELDS[trackingType];
}

/** Every field a set of this tracking type is allowed to carry, required or not. */
export function allowedMeasurementFields(trackingType: TrackingType): ReadonlyArray<keyof SetMeasurements> {
    return ALLOWED_FIELDS[trackingType];
}

/**
 * Checks a set's measurements against its exercise's tracking type.
 *
 * @returns the missing required fields and the fields that do not belong to this tracking type.
 */
export function validateSetMeasurements({
    trackingType,
    measurements,
}: {
    trackingType: TrackingType;
    measurements: SetMeasurements;
}): SetMeasurementsValidation {
    const present = (field: keyof SetMeasurements): boolean =>
        measurements[field] !== undefined && measurements[field] !== null;

    const missing = requiredMeasurementFields(trackingType).filter((field) => !present(field));

    const allowed = allowedMeasurementFields(trackingType);
    const unexpected = MEASUREMENT_FIELDS.filter((field) => present(field) && !allowed.includes(field));

    if (missing.length === 0 && unexpected.length === 0) return { valid: true };

    return { valid: false, missing, unexpected };
}

const MEASUREMENT_FIELDS: ReadonlyArray<keyof SetMeasurements> = [
    'weightKg',
    'reps',
    'durationSeconds',
    'distanceM',
];

const REQUIRED_FIELDS: Record<TrackingType, ReadonlyArray<keyof SetMeasurements>> = {
    [TrackingType.WeightReps]: ['reps'],
    [TrackingType.Duration]: ['durationSeconds'],
    [TrackingType.DistanceTime]: ['distanceM', 'durationSeconds'],
};

const ALLOWED_FIELDS: Record<TrackingType, ReadonlyArray<keyof SetMeasurements>> = {
    [TrackingType.WeightReps]: ['weightKg', 'reps'],
    [TrackingType.Duration]: ['durationSeconds'],
    [TrackingType.DistanceTime]: ['distanceM', 'durationSeconds'],
};
```

- [ ] **Step 4: Export it**

Modify `packages/domain/src/index.ts` so it reads:

```typescript
export { Decimal } from './decimal.js';
export {
    TrackingType,
    allowedMeasurementFields,
    requiredMeasurementFields,
    validateSetMeasurements,
    type SetMeasurements,
    type SetMeasurementsValidation,
} from './tracking-type.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @app/domain test`
Expected: PASS, all tracking-type tests green.

- [ ] **Step 6: Format, typecheck, commit**

```bash
pnpm format
pnpm --filter @app/domain typecheck
git add packages/domain/src/tracking-type.ts packages/domain/src/tracking-type.spec.ts packages/domain/src/index.ts
git commit -m "feat(domain): add exercise tracking types and set measurement rules"
```

---

### Task 2: Exercise tables and migration

**Files:**
- Create: `packages/db/src/schema/exercises.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/<generated>.sql` (produced by `db:generate`, not hand-written)

**Interfaces:**
- Consumes: `TrackingType` from `@app/domain` (Task 1).
- Produces: `exercises`, `exerciseGuideImages`, `exerciseLinks` Drizzle tables, and `trackingTypeEnum` as a `pgEnum`. `exercises` columns: `id`, `workspaceId`, `createdByUserId`, `name`, `trackingType`, `notes`, `guideSetup`, `guideExecution`, `guideCues`, `guideMistakes`, `archivedAt`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Add `@app/domain` as a dependency of `@app/db`**

The enum's values must come from the package that owns the vocabulary, not be restated here.

```bash
pnpm --filter @app/db add --save-exact @app/domain@workspace:*
pnpm install --frozen-lockfile
```

If this creates a project-reference cycle at typecheck (Task 2 Step 5 will tell you), stop and report it rather than working around it — the fix is a design decision, not a mechanical one.

- [ ] **Step 2: Write the schema file**

Create `packages/db/src/schema/exercises.ts`:

```typescript
import { TrackingType } from '@app/domain';
import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { workspaces } from './workspaces.js';

export const trackingTypeEnum = pgEnum('tracking_type', [
    TrackingType.WeightReps,
    TrackingType.Duration,
    TrackingType.DistanceTime,
]);

/**
 * An exercise in the workspace's library, and its how-to guide.
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
        workspaceId: uuid('workspace_id').notNull(),
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

/** An image belonging to an exercise's guide. The bytes live in object storage under `storage_key`. */
export const exerciseGuideImages = pgTable(
    'exercise_guide_images',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        exerciseId: uuid('exercise_id').notNull(),
        storageKey: text('storage_key').notNull(),
        contentType: text('content_type').notNull(),
        caption: text('caption'),
        position: integer('position').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('exercise_guide_images_exercise_id_idx').using(
            'btree',
            table.exerciseId.asc().nullsLast().op('uuid_ops'),
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'exercise_guide_images_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.exerciseId],
            foreignColumns: [exercises.id],
            name: 'exercise_guide_images_exercise_id_exercises_id_fk',
        }).onDelete('cascade'),
    ],
);

/** An external reference for an exercise, typically a video. */
export const exerciseLinks = pgTable(
    'exercise_links',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        exerciseId: uuid('exercise_id').notNull(),
        url: text('url').notNull(),
        label: text('label'),
        position: integer('position').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('exercise_links_exercise_id_idx').using('btree', table.exerciseId.asc().nullsLast().op('uuid_ops')),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'exercise_links_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.exerciseId],
            foreignColumns: [exercises.id],
            name: 'exercise_links_exercise_id_exercises_id_fk',
        }).onDelete('cascade'),
    ],
);
```

- [ ] **Step 3: Export the schema**

Add to `packages/db/src/schema/index.ts`, after the `items` line:

```typescript
export * from './exercises.js';
```

- [ ] **Step 4: Generate the migration and read it**

```bash
pnpm --filter @app/db db:generate
```

Then open the newest file in `packages/db/drizzle/` and read it before going further. Expected: `CREATE TYPE "public"."tracking_type"`, three `CREATE TABLE` statements, three indexes, and the foreign keys above. **If it contains any `DROP`, stop and report it** — a destructive statement here means the schema file collided with something existing, and applying it would lose data.

- [ ] **Step 5: Typecheck and apply against a throwaway database**

```bash
pnpm --filter @app/db typecheck
docker compose up -d
pnpm --filter @app/db test
```

Expected: PASS. The db package's own tests apply the committed migrations to a testcontainer, so a migration that does not apply cleanly fails here.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/exercises.ts packages/db/src/schema/index.ts packages/db/drizzle packages/db/package.json pnpm-lock.yaml
git commit -m "feat(db): add exercises, guide images, and exercise links tables"
```

---

### Task 3: Exercise contract schemas

**Files:**
- Create: `packages/api-contract/src/exercise.contract.ts`
- Modify: `packages/api-contract/src/resource-paths.ts`
- Modify: `packages/api-contract/src/index.ts`
- Test: `packages/api-contract/src/exercise.contract.spec.ts`

**Interfaces:**
- Consumes: `TrackingType` from `@app/domain`; `guidSchema`, `paginatedResponseSchema` from `./primitives.js`.
- Produces: `exerciseResponseSchema`, `exerciseListResponseSchema`, `exerciseDetailResponseSchema`, `postExerciseRequestSchema`, `patchExerciseRequestSchema`, `postExerciseLinkRequestSchema`, `patchExerciseLinkRequestSchema`, `exerciseLinkResponseSchema`, `exerciseGuideImageResponseSchema`, and the types inferred from each. Path helpers `exerciseWebPath({ workspaceId, exerciseId })` and `exerciseApiPath({ workspaceId, exerciseId })`.

- [ ] **Step 1: Add `@app/domain` as a dependency of `@app/api-contract`**

```bash
pnpm --filter @app/api-contract add --save-exact @app/domain@workspace:*
pnpm install --frozen-lockfile
```

- [ ] **Step 2: Write the failing test**

Create `packages/api-contract/src/exercise.contract.spec.ts`:

```typescript
import { TrackingType } from '@app/domain';
import { describe, expect, it } from 'vitest';
import {
    patchExerciseRequestSchema,
    postExerciseLinkRequestSchema,
    postExerciseRequestSchema,
} from './exercise.contract.js';

describe('postExerciseRequestSchema', () => {
    it('accepts a name and a tracking type', () => {
        const parsed = postExerciseRequestSchema.parse({ name: 'Bench Press', trackingType: 'weight_reps' });

        expect(parsed.trackingType).toBe(TrackingType.WeightReps);
    });

    it('rejects an unknown tracking type', () => {
        expect(() => postExerciseRequestSchema.parse({ name: 'Bench Press', trackingType: 'vibes' })).toThrow();
    });

    it('rejects an empty name', () => {
        expect(() => postExerciseRequestSchema.parse({ name: '', trackingType: 'duration' })).toThrow();
    });

    it('accepts the guide fields', () => {
        const parsed = postExerciseRequestSchema.parse({
            name: 'Plank',
            trackingType: 'duration',
            guideSetup: 'Forearms under shoulders.',
            guideCues: 'Ribs down, glutes on.',
        });

        expect(parsed.guideSetup).toBe('Forearms under shoulders.');
    });
});

describe('patchExerciseRequestSchema', () => {
    it('rejects an empty body', () => {
        expect(() => patchExerciseRequestSchema.parse({})).toThrow();
    });

    it('accepts a single field', () => {
        expect(patchExerciseRequestSchema.parse({ guideCues: 'Elbows at 45 degrees.' })).toMatchObject({
            guideCues: 'Elbows at 45 degrees.',
        });
    });
});

describe('postExerciseLinkRequestSchema', () => {
    it('accepts an https url with a label', () => {
        expect(
            postExerciseLinkRequestSchema.parse({ url: 'https://example.com/bench', label: 'Form check' }),
        ).toMatchObject({ url: 'https://example.com/bench' });
    });

    it('rejects a non-url', () => {
        expect(() => postExerciseLinkRequestSchema.parse({ url: 'not a url' })).toThrow();
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @app/api-contract test -- exercise.contract`
Expected: FAIL — cannot resolve `./exercise.contract.js`.

- [ ] **Step 4: Write the contract**

Create `packages/api-contract/src/exercise.contract.ts`:

```typescript
import { TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema, paginatedResponseSchema } from './primitives.js';

const guideFieldSchema = z.string().max(4000);

export const exerciseGuideImageResponseSchema = z.object({
    id: guidSchema,
    caption: z.string().nullable(),
    position: z.number().int(),
    url: z.string(),
});

export const exerciseLinkResponseSchema = z.object({
    id: guidSchema,
    url: z.string(),
    label: z.string().nullable(),
    position: z.number().int(),
});

export const exerciseResponseSchema = z.object({
    id: guidSchema,
    name: z.string(),
    trackingType: z.enum(TrackingType),
    notes: z.string().nullable(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** The exercise plus its guide — what the detail page and the MCP guide tool read. */
export const exerciseDetailResponseSchema = exerciseResponseSchema.extend({
    guideSetup: z.string().nullable(),
    guideExecution: z.string().nullable(),
    guideCues: z.string().nullable(),
    guideMistakes: z.string().nullable(),
    images: z.array(exerciseGuideImageResponseSchema),
    links: z.array(exerciseLinkResponseSchema),
});

export const exerciseListResponseSchema = paginatedResponseSchema(exerciseResponseSchema);

/** The body of `POST /api/v1/workspaces/{workspaceId}/exercises`. */
export const postExerciseRequestSchema = z.object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
    trackingType: z.enum(TrackingType),
    notes: z.string().max(2000).nullable().optional(),
    guideSetup: guideFieldSchema.nullable().optional(),
    guideExecution: guideFieldSchema.nullable().optional(),
    guideCues: guideFieldSchema.nullable().optional(),
    guideMistakes: guideFieldSchema.nullable().optional(),
});

/** The body of `PATCH /api/v1/workspaces/{workspaceId}/exercises/{exerciseId}`. An omitted key leaves the stored value alone. */
export const patchExerciseRequestSchema = z
    .object({
        name: z.string().min(1).max(200).optional(),
        trackingType: z.enum(TrackingType).optional(),
        notes: z.string().max(2000).nullable().optional(),
        guideSetup: guideFieldSchema.nullable().optional(),
        guideExecution: guideFieldSchema.nullable().optional(),
        guideCues: guideFieldSchema.nullable().optional(),
        guideMistakes: guideFieldSchema.nullable().optional(),
        archived: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

export const postExerciseLinkRequestSchema = z.object({
    url: z.url().max(2000),
    label: z.string().max(200).nullable().optional(),
});

export const patchExerciseLinkRequestSchema = z
    .object({
        url: z.url().max(2000).optional(),
        label: z.string().max(200).nullable().optional(),
        position: z.number().int().min(0).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>;
export type ExerciseDetailResponse = z.infer<typeof exerciseDetailResponseSchema>;
export type ExerciseListResponse = z.infer<typeof exerciseListResponseSchema>;
export type ExerciseGuideImageResponse = z.infer<typeof exerciseGuideImageResponseSchema>;
export type ExerciseLinkResponse = z.infer<typeof exerciseLinkResponseSchema>;
export type PostExerciseRequest = z.infer<typeof postExerciseRequestSchema>;
export type PatchExerciseRequest = z.infer<typeof patchExerciseRequestSchema>;
export type PostExerciseLinkRequest = z.infer<typeof postExerciseLinkRequestSchema>;
export type PatchExerciseLinkRequest = z.infer<typeof patchExerciseLinkRequestSchema>;
```

- [ ] **Step 5: Add the path helpers**

Append to `packages/api-contract/src/resource-paths.ts`:

```typescript
/** The exercise's page in the SPA. */
export function exerciseWebPath({ workspaceId, exerciseId }: { workspaceId: string; exerciseId: string }): string {
    return `/workspaces/${workspaceId}/exercises/${exerciseId}`;
}

/** The exercise's own REST route, without the `/api/v1` prefix the generator adds. */
export function exerciseApiPath({ workspaceId, exerciseId }: { workspaceId: string; exerciseId: string }): string {
    return `/workspaces/${workspaceId}/exercises/${exerciseId}`;
}
```

- [ ] **Step 6: Export the contract**

Add to `packages/api-contract/src/index.ts`, after the `item.contract.js` line:

```typescript
export * from './exercise.contract.js';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @app/api-contract test`
Expected: PASS.

- [ ] **Step 8: Format, typecheck, commit**

```bash
pnpm format
pnpm --filter @app/api-contract typecheck
git add packages/api-contract pnpm-lock.yaml
git commit -m "feat(api): add exercise contract schemas and resource paths"
```

---

### Task 4: `ExercisesService`

**Files:**
- Create: `packages/services/src/exercises.service.ts`
- Test: `packages/services/src/exercises.service.spec.ts`
- Modify: `packages/services/src/index.ts`

**Interfaces:**
- Consumes: `Db`, `schema`, `scopedToWorkspace` from `@app/db`; `WorkspaceMembershipService` from `./workspace-membership.service.js`; `TrackingType` from `@app/domain`; `EntityNotFoundError` from `@app/errors`.
- Produces: `class ExercisesService` with `list({ userId, workspaceId, page, pageSize, search?, includeArchived? }): Promise<PaginatedExercises>`, `get({ userId, workspaceId, exerciseId }): Promise<ExerciseDetail>`, `create({ userId, workspaceId, name, trackingType, notes?, guideSetup?, guideExecution?, guideCues?, guideMistakes? }): Promise<ExerciseDetail>`, `update({ userId, workspaceId, exerciseId, ...fields, archived? }): Promise<ExerciseDetail>`. Types `ExerciseSummary`, `ExerciseDetail`, `PaginatedExercises`.

The service returns `images` with a `storageKey`, not a URL — turning a key into a URL is the controller's job in Task 7, because it needs request-time configuration a package must never read.

- [ ] **Step 1: Write the failing test**

Create `packages/services/src/exercises.service.spec.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExercisesService } from './exercises.service.js';
import { seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let exercises: ExercisesService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    exercises = new ExercisesService({ db, membership: new WorkspaceMembershipService({ db }) });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
});

afterAll(async () => {
    await database?.stop();
});

const page = { page: 1, pageSize: 20 };

describe('create', () => {
    it('returns the stored exercise with its guide fields', async () => {
        const created = await exercises.create({
            userId,
            workspaceId,
            name: 'Bench Press',
            trackingType: TrackingType.WeightReps,
            guideCues: 'Ribs down, feet planted.',
        });

        expect(created).toMatchObject({
            name: 'Bench Press',
            trackingType: TrackingType.WeightReps,
            guideCues: 'Ribs down, feet planted.',
        });
        expect(created.images).toEqual([]);
        expect(created.links).toEqual([]);
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(
            exercises.create({
                userId,
                workspaceId: otherWorkspaceId,
                name: 'Trespass',
                trackingType: TrackingType.Duration,
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('list', () => {
    it("returns only this workspace's exercises, newest first", async () => {
        const ownerId = await seedUser(db);
        const scopedWorkspaceId = await seedWorkspace(db, ownerId);
        await exercises.create({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            name: 'first',
            trackingType: TrackingType.WeightReps,
        });
        await exercises.create({
            userId: ownerId,
            workspaceId: scopedWorkspaceId,
            name: 'second',
            trackingType: TrackingType.Duration,
        });
        await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'theirs',
            trackingType: TrackingType.WeightReps,
        });

        const result = await exercises.list({ userId: ownerId, workspaceId: scopedWorkspaceId, ...page });

        expect(result.data.map((exercise) => exercise.name)).toEqual(['second', 'first']);
        expect(result.totalCount).toBe(2);
    });

    it('filters by a case-insensitive name search', async () => {
        const ownerId = await seedUser(db);
        const searchWorkspaceId = await seedWorkspace(db, ownerId);
        for (const name of ['Barbell Row', 'Bench Press', 'Plank']) {
            await exercises.create({
                userId: ownerId,
                workspaceId: searchWorkspaceId,
                name,
                trackingType: TrackingType.WeightReps,
            });
        }

        const result = await exercises.list({
            userId: ownerId,
            workspaceId: searchWorkspaceId,
            ...page,
            search: 'ben',
        });

        expect(result.data.map((exercise) => exercise.name)).toEqual(['Bench Press']);
    });

    it('hides archived exercises unless asked for them', async () => {
        const ownerId = await seedUser(db);
        const archiveWorkspaceId = await seedWorkspace(db, ownerId);
        const { id } = await exercises.create({
            userId: ownerId,
            workspaceId: archiveWorkspaceId,
            name: 'Retired',
            trackingType: TrackingType.WeightReps,
        });
        await exercises.update({ userId: ownerId, workspaceId: archiveWorkspaceId, exerciseId: id, archived: true });

        const visible = await exercises.list({ userId: ownerId, workspaceId: archiveWorkspaceId, ...page });
        const all = await exercises.list({
            userId: ownerId,
            workspaceId: archiveWorkspaceId,
            ...page,
            includeArchived: true,
        });

        expect(visible.data).toHaveLength(0);
        expect(all.data).toHaveLength(1);
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(
            exercises.list({ userId, workspaceId: otherWorkspaceId, ...page }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('get', () => {
    it('throws EntityNotFoundError for an unknown exercise', async () => {
        await expect(
            exercises.get({ userId, workspaceId, exerciseId: randomUUID() }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    // The tenant filter, not just the membership check: the caller IS a member of `workspaceId`,
    // so only `scopedToWorkspace` stops them reading another workspace's row by id.
    it('refuses an exercise id from another workspace even though the caller is a member of this one', async () => {
        const { id } = await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'theirs',
            trackingType: TrackingType.WeightReps,
        });

        await expect(exercises.get({ userId, workspaceId, exerciseId: id })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});

describe('update', () => {
    it('writes only the fields given', async () => {
        const { id } = await exercises.create({
            userId,
            workspaceId,
            name: 'Original',
            trackingType: TrackingType.WeightReps,
            guideSetup: 'Keep me',
        });

        const updated = await exercises.update({ userId, workspaceId, exerciseId: id, name: 'Renamed' });

        expect(updated).toMatchObject({ name: 'Renamed', guideSetup: 'Keep me' });
    });

    it('archives and unarchives', async () => {
        const { id } = await exercises.create({
            userId,
            workspaceId,
            name: 'Archivable',
            trackingType: TrackingType.Duration,
        });

        expect((await exercises.update({ userId, workspaceId, exerciseId: id, archived: true })).archivedAt).not.toBeNull();
        expect((await exercises.update({ userId, workspaceId, exerciseId: id, archived: false })).archivedAt).toBeNull();
    });

    it('refuses an exercise in another workspace, and leaves it untouched', async () => {
        const { id } = await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'theirs',
            trackingType: TrackingType.WeightReps,
        });

        await expect(
            exercises.update({ userId, workspaceId, exerciseId: id, name: 'hijacked' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        expect(
            (await exercises.get({ userId: outsiderId, workspaceId: otherWorkspaceId, exerciseId: id })).name,
        ).toBe('theirs');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @app/services test -- exercises.service`
Expected: FAIL — cannot resolve `./exercises.service.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/services/src/exercises.service.ts`:

```typescript
import { schema, scopedToWorkspace, type Db } from '@app/db';
import type { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { asc, count, desc, eq, ilike, isNull } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exerciseGuideImages, exerciseLinks, exercises } = schema;

export type ExerciseSummary = {
    id: string;
    name: string;
    trackingType: TrackingType;
    notes: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ExerciseGuideImage = {
    id: string;
    storageKey: string;
    contentType: string;
    caption: string | null;
    position: number;
};

export type ExerciseLink = {
    id: string;
    url: string;
    label: string | null;
    position: number;
};

export type ExerciseDetail = ExerciseSummary & {
    guideSetup: string | null;
    guideExecution: string | null;
    guideCues: string | null;
    guideMistakes: string | null;
    images: ExerciseGuideImage[];
    links: ExerciseLink[];
};

export type PaginatedExercises = {
    data: ExerciseSummary[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
};

/**
 * The workspace's exercise library, including each exercise's how-to guide.
 *
 * Images are returned as storage keys rather than URLs: turning a key into a URL needs
 * deployment configuration, which belongs to the app, not to a package.
 */
export class ExercisesService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * A page of the workspace's exercises, newest first.
     *
     * @param search matches anywhere in the name, case-insensitively.
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async list({
        userId,
        workspaceId,
        page,
        pageSize,
        search,
        includeArchived,
    }: {
        userId: string;
        workspaceId: string;
        page: number;
        pageSize: number;
        search?: string;
        includeArchived?: boolean;
    }): Promise<PaginatedExercises> {
        await this.membership.require({ userId, workspaceId });

        const where = scopedToWorkspace(
            exercises,
            workspaceId,
            search === undefined || search === '' ? undefined : ilike(exercises.name, `%${search}%`),
            includeArchived === true ? undefined : isNull(exercises.archivedAt),
        );

        const [data, [totals]] = await Promise.all([
            this.db
                .select(EXERCISE_SUMMARY_COLUMNS)
                .from(exercises)
                .where(where)
                .orderBy(desc(exercises.createdAt))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
            this.db.select({ totalCount: count() }).from(exercises).where(where),
        ]);

        const totalCount = totals?.totalCount ?? 0;

        return { data, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
    }

    /**
     * One exercise with its full guide, images, and links.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the exercise is not in this
     * workspace — the two are deliberately indistinguishable on the wire.
     */
    async get({
        userId,
        workspaceId,
        exerciseId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
    }): Promise<ExerciseDetail> {
        await this.membership.require({ userId, workspaceId });

        return this.loadDetail({ workspaceId, exerciseId });
    }

    /**
     * Creates an exercise in the workspace.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async create({
        userId,
        workspaceId,
        name,
        trackingType,
        notes,
        guideSetup,
        guideExecution,
        guideCues,
        guideMistakes,
    }: {
        userId: string;
        workspaceId: string;
        name: string;
        trackingType: TrackingType;
        notes?: string | null;
        guideSetup?: string | null;
        guideExecution?: string | null;
        guideCues?: string | null;
        guideMistakes?: string | null;
    }): Promise<ExerciseDetail> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .insert(exercises)
            .values({
                workspaceId,
                createdByUserId: userId,
                name,
                trackingType,
                notes: notes ?? null,
                guideSetup: guideSetup ?? null,
                guideExecution: guideExecution ?? null,
                guideCues: guideCues ?? null,
                guideMistakes: guideMistakes ?? null,
            })
            .returning({ id: exercises.id });

        return this.loadDetail({ workspaceId, exerciseId: row.id });
    }

    /**
     * Updates an exercise. Only the fields present are written.
     *
     * @param archived true archives the exercise, false restores it.
     * @throws EntityNotFoundError when the caller is not a member, or the exercise is not in this
     * workspace.
     */
    async update({
        userId,
        workspaceId,
        exerciseId,
        name,
        trackingType,
        notes,
        guideSetup,
        guideExecution,
        guideCues,
        guideMistakes,
        archived,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        name?: string;
        trackingType?: TrackingType;
        notes?: string | null;
        guideSetup?: string | null;
        guideExecution?: string | null;
        guideCues?: string | null;
        guideMistakes?: string | null;
        archived?: boolean;
    }): Promise<ExerciseDetail> {
        await this.membership.require({ userId, workspaceId });

        const now = new Date().toISOString();

        const [row] = await this.db
            .update(exercises)
            .set({
                ...(name === undefined ? {} : { name }),
                ...(trackingType === undefined ? {} : { trackingType }),
                ...(notes === undefined ? {} : { notes }),
                ...(guideSetup === undefined ? {} : { guideSetup }),
                ...(guideExecution === undefined ? {} : { guideExecution }),
                ...(guideCues === undefined ? {} : { guideCues }),
                ...(guideMistakes === undefined ? {} : { guideMistakes }),
                ...(archived === undefined ? {} : { archivedAt: archived ? now : null }),
                updatedAt: now,
            })
            .where(scopedToWorkspace(exercises, workspaceId, eq(exercises.id, exerciseId)))
            .returning({ id: exercises.id });

        if (!row) throw new EntityNotFoundError('Exercise not found');

        return this.loadDetail({ workspaceId, exerciseId });
    }

    private async loadDetail({
        workspaceId,
        exerciseId,
    }: {
        workspaceId: string;
        exerciseId: string;
    }): Promise<ExerciseDetail> {
        const [exercise] = await this.db
            .select(EXERCISE_DETAIL_COLUMNS)
            .from(exercises)
            .where(scopedToWorkspace(exercises, workspaceId, eq(exercises.id, exerciseId)));

        if (!exercise) throw new EntityNotFoundError('Exercise not found');

        const [images, links] = await Promise.all([
            this.db
                .select({
                    id: exerciseGuideImages.id,
                    storageKey: exerciseGuideImages.storageKey,
                    contentType: exerciseGuideImages.contentType,
                    caption: exerciseGuideImages.caption,
                    position: exerciseGuideImages.position,
                })
                .from(exerciseGuideImages)
                .where(
                    scopedToWorkspace(
                        exerciseGuideImages,
                        workspaceId,
                        eq(exerciseGuideImages.exerciseId, exerciseId),
                    ),
                )
                .orderBy(asc(exerciseGuideImages.position)),
            this.db
                .select({
                    id: exerciseLinks.id,
                    url: exerciseLinks.url,
                    label: exerciseLinks.label,
                    position: exerciseLinks.position,
                })
                .from(exerciseLinks)
                .where(scopedToWorkspace(exerciseLinks, workspaceId, eq(exerciseLinks.exerciseId, exerciseId)))
                .orderBy(asc(exerciseLinks.position)),
        ]);

        return { ...exercise, images, links };
    }
}

const EXERCISE_SUMMARY_COLUMNS = {
    id: exercises.id,
    name: exercises.name,
    trackingType: exercises.trackingType,
    notes: exercises.notes,
    archivedAt: exercises.archivedAt,
    createdAt: exercises.createdAt,
    updatedAt: exercises.updatedAt,
};

const EXERCISE_DETAIL_COLUMNS = {
    ...EXERCISE_SUMMARY_COLUMNS,
    guideSetup: exercises.guideSetup,
    guideExecution: exercises.guideExecution,
    guideCues: exercises.guideCues,
    guideMistakes: exercises.guideMistakes,
};
```

- [ ] **Step 4: Export the service**

Add to `packages/services/src/index.ts`:

```typescript
export {
    ExercisesService,
    type ExerciseDetail,
    type ExerciseGuideImage,
    type ExerciseLink,
    type ExerciseSummary,
    type PaginatedExercises,
} from './exercises.service.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @app/services test -- exercises.service`
Expected: PASS, including all three tenancy tests.

- [ ] **Step 6: Format, typecheck, commit**

```bash
pnpm format
pnpm --filter @app/services typecheck
git add packages/services/src/exercises.service.ts packages/services/src/exercises.service.spec.ts packages/services/src/index.ts
git commit -m "feat(api): add ExercisesService with workspace-scoped library and guide reads"
```

---

### Task 5: `ExerciseGuideService` — links and image metadata

Split from `ExercisesService` because it owns writes to two child tables and, in Task 7, the object-storage side effect of deleting an image. Keeping it separate stops `exercises.service.ts` growing into a file that does too much.

**Files:**
- Create: `packages/services/src/exercise-guide.service.ts`
- Test: `packages/services/src/exercise-guide.service.spec.ts`
- Modify: `packages/services/src/index.ts`

**Interfaces:**
- Consumes: `ExercisesService` types from Task 4; `Db`, `schema`, `scopedToWorkspace`; `WorkspaceMembershipService`.
- Produces: `class ExerciseGuideService` with `addLink({ userId, workspaceId, exerciseId, url, label? }): Promise<ExerciseLink>`, `updateLink({ userId, workspaceId, exerciseId, linkId, url?, label?, position? }): Promise<ExerciseLink>`, `removeLink({ userId, workspaceId, exerciseId, linkId }): Promise<void>`, `addImage({ userId, workspaceId, exerciseId, storageKey, contentType, caption? }): Promise<ExerciseGuideImage>`, `removeImage({ userId, workspaceId, exerciseId, imageId }): Promise<{ storageKey: string }>`.

`removeImage` returns the deleted row's storage key so the caller can delete the object. The service does not hold a `StorageService` — the API layer owns that side effect, keeping this class dependent only on the database.

- [ ] **Step 1: Write the failing test**

Create `packages/services/src/exercise-guide.service.spec.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExerciseGuideService } from './exercise-guide.service.js';
import { ExercisesService } from './exercises.service.js';
import { seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let exercises: ExercisesService;
let guides: ExerciseGuideService;

let userId: string;
let workspaceId: string;
let exerciseId: string;
let outsiderId: string;
let otherWorkspaceId: string;
let otherExerciseId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const membership = new WorkspaceMembershipService({ db });
    exercises = new ExercisesService({ db, membership });
    guides = new ExerciseGuideService({ db, membership });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    exerciseId = (
        await exercises.create({ userId, workspaceId, name: 'Bench Press', trackingType: TrackingType.WeightReps })
    ).id;

    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
    otherExerciseId = (
        await exercises.create({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            name: 'Theirs',
            trackingType: TrackingType.WeightReps,
        })
    ).id;
});

afterAll(async () => {
    await database?.stop();
});

describe('addLink', () => {
    it('appends links in order', async () => {
        const first = await guides.addLink({
            userId,
            workspaceId,
            exerciseId,
            url: 'https://example.com/one',
            label: 'One',
        });
        const second = await guides.addLink({ userId, workspaceId, exerciseId, url: 'https://example.com/two' });

        expect(first.position).toBe(0);
        expect(second.position).toBe(1);
        expect(second.label).toBeNull();
    });

    it('refuses an exercise in another workspace', async () => {
        await expect(
            guides.addLink({ userId, workspaceId, exerciseId: otherExerciseId, url: 'https://example.com/x' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses a workspace the caller does not belong to', async () => {
        await expect(
            guides.addLink({
                userId,
                workspaceId: otherWorkspaceId,
                exerciseId: otherExerciseId,
                url: 'https://example.com/x',
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('updateLink', () => {
    it('writes only the fields given', async () => {
        const link = await guides.addLink({
            userId,
            workspaceId,
            exerciseId,
            url: 'https://example.com/before',
            label: 'Keep me',
        });

        const updated = await guides.updateLink({
            userId,
            workspaceId,
            exerciseId,
            linkId: link.id,
            url: 'https://example.com/after',
        });

        expect(updated).toMatchObject({ url: 'https://example.com/after', label: 'Keep me' });
    });

    it('throws EntityNotFoundError for an unknown link', async () => {
        await expect(
            guides.updateLink({ userId, workspaceId, exerciseId, linkId: randomUUID(), label: 'x' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('removeLink', () => {
    it('deletes the link', async () => {
        const link = await guides.addLink({ userId, workspaceId, exerciseId, url: 'https://example.com/doomed' });

        await guides.removeLink({ userId, workspaceId, exerciseId, linkId: link.id });

        const detail = await exercises.get({ userId, workspaceId, exerciseId });
        expect(detail.links.map((entry) => entry.id)).not.toContain(link.id);
    });
});

describe('images', () => {
    it('records an uploaded image and returns its storage key when removed', async () => {
        const image = await guides.addImage({
            userId,
            workspaceId,
            exerciseId,
            storageKey: 'abc123.png',
            contentType: 'image/png',
            caption: 'Bottom position',
        });

        expect(image).toMatchObject({ caption: 'Bottom position', position: 0 });

        const removed = await guides.removeImage({ userId, workspaceId, exerciseId, imageId: image.id });

        expect(removed.storageKey).toBe('abc123.png');
    });

    it('refuses an image on an exercise in another workspace, and leaves it in place', async () => {
        const image = await guides.addImage({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            exerciseId: otherExerciseId,
            storageKey: 'theirs.png',
            contentType: 'image/png',
        });

        await expect(
            guides.removeImage({ userId, workspaceId, exerciseId, imageId: image.id }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        const detail = await exercises.get({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            exerciseId: otherExerciseId,
        });
        expect(detail.images.map((entry) => entry.id)).toContain(image.id);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @app/services test -- exercise-guide.service`
Expected: FAIL — cannot resolve `./exercise-guide.service.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/services/src/exercise-guide.service.ts`:

```typescript
import { schema, scopedToWorkspace, type Db } from '@app/db';
import { EntityNotFoundError } from '@app/errors';
import { eq, max } from 'drizzle-orm';
import type { ExerciseGuideImage, ExerciseLink } from './exercises.service.js';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exerciseGuideImages, exerciseLinks, exercises } = schema;

/**
 * Writes to an exercise's guide attachments — its external links and its image records.
 *
 * Deliberately holds no storage client. `removeImage` returns the deleted row's storage key so the
 * caller can delete the object; keeping the side effect outside means this class can be tested
 * against a database alone.
 */
export class ExerciseGuideService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /** Appends an external link to the exercise's guide. */
    async addLink({
        userId,
        workspaceId,
        exerciseId,
        url,
        label,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        url: string;
        label?: string | null;
    }): Promise<ExerciseLink> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const position = await this.nextPosition({ workspaceId, exerciseId, table: exerciseLinks });

        const [row] = await this.db
            .insert(exerciseLinks)
            .values({ workspaceId, exerciseId, url, label: label ?? null, position })
            .returning(LINK_COLUMNS);

        return row;
    }

    /** Updates a link. Only the fields present are written. */
    async updateLink({
        userId,
        workspaceId,
        exerciseId,
        linkId,
        url,
        label,
        position,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        linkId: string;
        url?: string;
        label?: string | null;
        position?: number;
    }): Promise<ExerciseLink> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const [row] = await this.db
            .update(exerciseLinks)
            .set({
                ...(url === undefined ? {} : { url }),
                ...(label === undefined ? {} : { label }),
                ...(position === undefined ? {} : { position }),
            })
            .where(
                scopedToWorkspace(
                    exerciseLinks,
                    workspaceId,
                    eq(exerciseLinks.id, linkId),
                    eq(exerciseLinks.exerciseId, exerciseId),
                ),
            )
            .returning(LINK_COLUMNS);

        if (!row) throw new EntityNotFoundError('Exercise link not found');

        return row;
    }

    /** Deletes a link from the exercise's guide. */
    async removeLink({
        userId,
        workspaceId,
        exerciseId,
        linkId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        linkId: string;
    }): Promise<void> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const deleted = await this.db
            .delete(exerciseLinks)
            .where(
                scopedToWorkspace(
                    exerciseLinks,
                    workspaceId,
                    eq(exerciseLinks.id, linkId),
                    eq(exerciseLinks.exerciseId, exerciseId),
                ),
            )
            .returning({ id: exerciseLinks.id });

        if (deleted.length === 0) throw new EntityNotFoundError('Exercise link not found');
    }

    /** Records an already-uploaded image against the exercise's guide. */
    async addImage({
        userId,
        workspaceId,
        exerciseId,
        storageKey,
        contentType,
        caption,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        storageKey: string;
        contentType: string;
        caption?: string | null;
    }): Promise<ExerciseGuideImage> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const position = await this.nextPosition({ workspaceId, exerciseId, table: exerciseGuideImages });

        const [row] = await this.db
            .insert(exerciseGuideImages)
            .values({ workspaceId, exerciseId, storageKey, contentType, caption: caption ?? null, position })
            .returning(IMAGE_COLUMNS);

        return row;
    }

    /**
     * Deletes an image record.
     *
     * @returns the storage key of the deleted row, so the caller can remove the stored object.
     */
    async removeImage({
        userId,
        workspaceId,
        exerciseId,
        imageId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        imageId: string;
    }): Promise<{ storageKey: string }> {
        await this.requireExercise({ userId, workspaceId, exerciseId });

        const [deleted] = await this.db
            .delete(exerciseGuideImages)
            .where(
                scopedToWorkspace(
                    exerciseGuideImages,
                    workspaceId,
                    eq(exerciseGuideImages.id, imageId),
                    eq(exerciseGuideImages.exerciseId, exerciseId),
                ),
            )
            .returning({ storageKey: exerciseGuideImages.storageKey });

        if (!deleted) throw new EntityNotFoundError('Exercise image not found');

        return deleted;
    }

    private async requireExercise({
        userId,
        workspaceId,
        exerciseId,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
    }): Promise<void> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .select({ id: exercises.id })
            .from(exercises)
            .where(scopedToWorkspace(exercises, workspaceId, eq(exercises.id, exerciseId)));

        if (!row) throw new EntityNotFoundError('Exercise not found');
    }

    private async nextPosition({
        workspaceId,
        exerciseId,
        table,
    }: {
        workspaceId: string;
        exerciseId: string;
        table: typeof exerciseLinks | typeof exerciseGuideImages;
    }): Promise<number> {
        const [row] = await this.db
            .select({ highest: max(table.position) })
            .from(table)
            .where(scopedToWorkspace(table, workspaceId, eq(table.exerciseId, exerciseId)));

        return row?.highest === null || row?.highest === undefined ? 0 : row.highest + 1;
    }
}

const LINK_COLUMNS = {
    id: exerciseLinks.id,
    url: exerciseLinks.url,
    label: exerciseLinks.label,
    position: exerciseLinks.position,
};

const IMAGE_COLUMNS = {
    id: exerciseGuideImages.id,
    storageKey: exerciseGuideImages.storageKey,
    contentType: exerciseGuideImages.contentType,
    caption: exerciseGuideImages.caption,
    position: exerciseGuideImages.position,
};
```

**Known typing hazard in `nextPosition`:** it takes `table` as a union of two Drizzle tables. Drizzle's `select().from()` and `max()` may not narrow that union, in which case `pnpm --filter @app/services typecheck` fails on `table.position` or `table.exerciseId`. If it does, **do not reach for a cast** — split it into two private methods, `nextLinkPosition` and `nextImagePosition`, each typed against one table. Two near-identical five-line methods are the right answer here; a cast would defeat the type checking that makes the tenant filter safe.

- [ ] **Step 4: Export the service**

Add to `packages/services/src/index.ts`:

```typescript
export { ExerciseGuideService } from './exercise-guide.service.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @app/services test -- exercise-guide.service`
Expected: PASS.

- [ ] **Step 6: Format, typecheck, commit**

```bash
pnpm format
pnpm --filter @app/services typecheck
git add packages/services/src/exercise-guide.service.ts packages/services/src/exercise-guide.service.spec.ts packages/services/src/index.ts
git commit -m "feat(api): add ExerciseGuideService for guide links and image records"
```

---

### Task 6: Exercises API routes

**Files:**
- Create: `apps/api/src/exercises/exercises.controller.ts`
- Create: `apps/api/src/exercises/exercises.providers.ts`
- Create: `apps/api/src/exercises/exercises.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/exercises.e2e.spec.ts`

**Interfaces:**
- Consumes: `ExercisesService` (Task 4); contract schemas (Task 3).
- Produces: routes `GET|POST /v1/workspaces/:workspaceId/exercises`, `GET|PATCH /v1/workspaces/:workspaceId/exercises/:exerciseId`. DI token `EXERCISES_SERVICE`. Exports `exerciseServiceProviders`.

Read `apps/api/test/items.e2e.spec.ts` before writing the e2e spec and follow its harness usage exactly; it shows how a test signs in and issues requests.

- [ ] **Step 1: Write the providers**

Create `apps/api/src/exercises/exercises.providers.ts`:

```typescript
import { type Db } from '@app/db';
import { ExerciseGuideService, ExercisesService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `ExercisesService` factory provider below. */
export const EXERCISES_SERVICE = Symbol('EXERCISES_SERVICE');

/** DI token for the `ExerciseGuideService` factory provider below. */
export const EXERCISE_GUIDE_SERVICE = Symbol('EXERCISE_GUIDE_SERVICE');

/** Split out from `exercises.module.ts` to avoid a circular import between that module and its controllers. */
export const exerciseServiceProviders: Provider[] = [
    {
        provide: EXERCISES_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ExercisesService =>
            new ExercisesService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
    {
        provide: EXERCISE_GUIDE_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ExerciseGuideService =>
            new ExerciseGuideService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
```

- [ ] **Step 2: Write the controller**

Create `apps/api/src/exercises/exercises.controller.ts`:

```typescript
import {
    exerciseWebPath,
    guidSchema,
    paginationQuerySchema,
    patchExerciseRequestSchema,
    postExerciseRequestSchema,
    type ExerciseDetailResponse,
    type ExerciseListResponse,
    type PaginationQuery,
    type PatchExerciseRequest,
    type PostExerciseRequest,
} from '@app/api-contract';
import {
    CurrentUser,
    RESOURCE_URL_GENERATOR,
    ResourceUrlGenerator,
    SessionOrMcpPatGuard,
    ValidatedBody,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseDetail, ExercisesService } from '@app/services';
import { Controller, Get, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { EXERCISES_SERVICE } from './exercises.providers.js';

const exerciseListQuerySchema = paginationQuerySchema.extend({
    search: z.string().max(200).optional(),
    includeArchived: z
        .unknown()
        .optional()
        .transform((raw) => String(raw ?? '').toLowerCase() === 'true')
        .pipe(z.boolean()),
});

type ExerciseListQuery = PaginationQuery & { search?: string; includeArchived: boolean };

/** The workspace's exercise library and each exercise's guide. */
@Controller('v1/workspaces/:workspaceId/exercises')
@UseGuards(SessionOrMcpPatGuard)
export class ExercisesController {
    constructor(
        @Inject(EXERCISES_SERVICE) private readonly exercises: ExercisesService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** A page of the workspace's exercises, newest first. */
    @Get()
    async listExercises(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedQuery(exerciseListQuerySchema) query: ExerciseListQuery,
    ): Promise<ExerciseListResponse> {
        return this.exercises.list({
            userId: currentUser.userId,
            workspaceId,
            page: query.page,
            pageSize: query.pageSize,
            search: query.search,
            includeArchived: query.includeArchived,
        });
    }

    /** One exercise with its guide, images, and links, plus the link to its page in the web app. */
    @Get(':exerciseId')
    async getExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
    ): Promise<ExerciseDetailResponse & { webUrl: string }> {
        const exercise = await this.exercises.get({ userId: currentUser.userId, workspaceId, exerciseId });

        return {
            ...toDetailResponse(exercise),
            webUrl: this.urls.webAppUrl({ path: exerciseWebPath({ workspaceId, exerciseId }) }),
        };
    }

    /** Creates an exercise in the workspace. */
    @Post()
    @HttpCode(200)
    async createExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postExerciseRequestSchema) body: PostExerciseRequest,
    ): Promise<ExerciseDetailResponse> {
        const created = await this.exercises.create({ userId: currentUser.userId, workspaceId, ...body });

        return toDetailResponse(created);
    }

    /** Updates an exercise. An omitted key leaves the stored value alone. */
    @Patch(':exerciseId')
    async patchExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedBody(patchExerciseRequestSchema) body: PatchExerciseRequest,
    ): Promise<ExerciseDetailResponse> {
        const updated = await this.exercises.update({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            ...body,
        });

        return toDetailResponse(updated);
    }
}

/**
 * Storage keys never reach the wire. Task 7 replaces the empty `url` with a real one once the
 * image-serving route exists; until then the detail response carries no image URLs.
 */
function toDetailResponse(exercise: ExerciseDetail): ExerciseDetailResponse {
    return {
        ...exercise,
        images: exercise.images.map((image) => ({
            id: image.id,
            caption: image.caption,
            position: image.position,
            url: '',
        })),
    };
}
```

- [ ] **Step 3: Write the module and register it**

Create `apps/api/src/exercises/exercises.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller.js';
import { exerciseServiceProviders } from './exercises.providers.js';

/** Wires the workspace-scoped `/api/v1/workspaces/:workspaceId/exercises` routes. */
@Module({
    controllers: [ExercisesController],
    providers: [...exerciseServiceProviders],
})
export class ExercisesModule {}
```

Then in `apps/api/src/app.module.ts`, add the import and put `ExercisesModule` in the `imports` array after `ItemsModule`.

- [ ] **Step 4: Write the e2e spec**

Create `apps/api/test/exercises.e2e.spec.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from './harness.js';

let app: TestApp;

/** A signed-up user, their default workspace, and a session cookie for them. */
async function signUpUser(): Promise<{ cookie: string; workspaceId: string; userId: string }> {
    const email = `exercises-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';

    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });

    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { userId: string; workspaces: { workspaceId: string }[] };

    return { cookie, userId: body.userId, workspaceId: body.workspaces[0]?.workspaceId as string };
}

async function createExercise(
    cookie: string,
    workspaceId: string,
    payload: Record<string, unknown>,
): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises`,
        headers: { cookie },
        payload,
    });

    return (JSON.parse(response.body) as { id: string }).id;
}

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('exercise routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/v1/workspaces/${randomUUID()}/exercises` });

        expect(response.statusCode).toBe(401);
    });

    it('creates an exercise and reads back its guide', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const created = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
            payload: { name: 'Bench Press', trackingType: 'weight_reps', guideCues: 'Ribs down.' },
        });

        expect(created.statusCode).toBe(200);
        const exerciseId = (JSON.parse(created.body) as { id: string }).id;

        const fetched = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
            headers: { cookie },
        });

        expect(fetched.statusCode).toBe(200);
        expect(JSON.parse(fetched.body)).toMatchObject({
            name: 'Bench Press',
            trackingType: 'weight_reps',
            guideCues: 'Ribs down.',
            images: [],
            links: [],
        });
    });

    it('rejects an unknown tracking type', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
            payload: { name: 'Vibes', trackingType: 'vibes' },
        });

        expect(response.statusCode).toBe(400);
    });

    // A segment that cannot be a valid id names no resource, and a 400 would let a caller tell
    // "wrong shape" apart from "no such row".
    it('returns 404, not 400, for a malformed exercise id', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises/not-a-uuid`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(404);
    });

    it("returns 404 for another workspace's exercise", async () => {
        const owner = await signUpUser();
        const outsider = await signUpUser();
        const exerciseId = await createExercise(owner.cookie, owner.workspaceId, {
            name: 'Theirs',
            trackingType: 'weight_reps',
        });

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${outsider.workspaceId}/exercises/${exerciseId}`,
            headers: { cookie: outsider.cookie },
        });

        expect(response.statusCode).toBe(404);
    });

    it('updates one guide field and leaves the others alone', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise(cookie, workspaceId, {
            name: 'Squat',
            trackingType: 'weight_reps',
            guideSetup: 'Bar on traps.',
            guideCues: 'Knees out.',
        });

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
            headers: { cookie },
            payload: { guideCues: 'Chest up, knees out.' },
        });

        expect(patched.statusCode).toBe(200);
        expect(JSON.parse(patched.body)).toMatchObject({
            guideSetup: 'Bar on traps.',
            guideCues: 'Chest up, knees out.',
        });
    });

    it('hides an archived exercise from the default list', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const exerciseId = await createExercise(cookie, workspaceId, {
            name: 'Retired',
            trackingType: 'duration',
        });

        await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${exerciseId}`,
            headers: { cookie },
            payload: { archived: true },
        });

        const listed = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises`,
            headers: { cookie },
        });

        expect((JSON.parse(listed.body) as { data: unknown[] }).data).toHaveLength(0);
    });

    it('filters the list by search', async () => {
        const { cookie, workspaceId } = await signUpUser();
        await createExercise(cookie, workspaceId, { name: 'Bench Press', trackingType: 'weight_reps' });
        await createExercise(cookie, workspaceId, { name: 'Plank', trackingType: 'duration' });

        const listed = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises?search=ben`,
            headers: { cookie },
        });

        const body = JSON.parse(listed.body) as { data: { name: string }[] };
        expect(body.data.map((exercise) => exercise.name)).toEqual(['Bench Press']);
    });
});
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @app/api test -- exercises
pnpm --filter @app/api test -- route-guard-coverage
```

Expected: both PASS. `route-guard-coverage` proves the new routes carry a guard. **If it fails because the new routes are PAT-reachable but not in the tool map, leave it failing and fix it in Task 8** — that test is satisfied by adding the MCP tools, never by adding an allowlist entry to quiet it.

- [ ] **Step 6: Format, typecheck, commit**

```bash
pnpm format
pnpm --filter @app/api typecheck
git add apps/api/src/exercises apps/api/src/app.module.ts apps/api/test/exercises.e2e.spec.ts
git commit -m "feat(api): add exercise library routes"
```

---

### Task 7: Guide links and image upload routes

This is the **first upload route in this repository** — there is no existing pattern to copy. `@fastify/multipart` is already registered in `apps/api/src/bootstrap.ts` with a 60 MB limit, and `StorageService.uploadFile({ fileStream, fileName, contentType })` returns the generated storage key.

**Files:**
- Create: `apps/api/src/exercises/exercise-guide.controller.ts`
- Modify: `apps/api/src/exercises/exercises.module.ts`
- Modify: `apps/api/src/exercises/exercises.controller.ts` (fill in the image `url`)
- Test: `apps/api/test/exercise-guide.e2e.spec.ts`

**Interfaces:**
- Consumes: `ExerciseGuideService` and `EXERCISE_GUIDE_SERVICE` (Tasks 5, 6); `StorageService` from `@app/storage` via the existing `STORAGE_SERVICE` provider token in `apps/api/src/providers.ts` — check that file for the exact token name before wiring, and if no storage token exists yet, add one there following the shape of `DB`.
- Produces: routes `POST|PATCH|DELETE /v1/workspaces/:workspaceId/exercises/:exerciseId/links[/:linkId]`, `POST|DELETE /v1/workspaces/:workspaceId/exercises/:exerciseId/images[/:imageId]`, and `GET /v1/workspaces/:workspaceId/exercises/:exerciseId/images/:imageId/content`.

Images are served through the API rather than by a public bucket URL, because a public URL would be an unauthenticated read of workspace-owned content.

- [ ] **Step 1: Restrict what may be uploaded**

Add to the top of `apps/api/src/exercises/exercise-guide.controller.ts`:

```typescript
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
```

Reject anything else with `InvalidFormatError` from `@app/errors`. An unchecked content type here is a stored-XSS vector: the content route serves these bytes back to a browser.

- [ ] **Step 2: Write the upload handler**

In the controller, the image upload route reads the multipart file off the Fastify request, validates it, uploads it, and records it:

```typescript
    /** Uploads an image for the exercise's guide. */
    @Post(':exerciseId/images')
    @HttpCode(200)
    async uploadImage(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @Req() request: FastifyRequest,
    ): Promise<ExerciseGuideImageResponse> {
        const file = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES } });

        if (!file) throw new InvalidFormatError('An image file is required');

        if (!ALLOWED_IMAGE_CONTENT_TYPES.has(file.mimetype)) {
            throw new InvalidFormatError('Unsupported image type', 'Use PNG, JPEG, or WebP.');
        }

        const storageKey = await this.storage.uploadFile({
            fileStream: file.file,
            fileName: file.filename,
            contentType: file.mimetype,
        });

        // `file.file` is truncated rather than thrown when the per-file limit is hit, so the
        // upload can "succeed" with a partial object. Check afterwards and discard it.
        if (file.file.truncated) {
            await this.storage.deleteFile(storageKey);

            throw new InvalidFormatError('Image is too large', 'Images must be 10 MB or smaller.');
        }

        const caption = typeof file.fields.caption === 'object' && file.fields.caption !== null
            ? String((file.fields.caption as { value?: unknown }).value ?? '')
            : '';

        const image = await this.guides.addImage({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            storageKey,
            contentType: file.mimetype,
            caption: caption === '' ? null : caption,
        });

        return {
            id: image.id,
            caption: image.caption,
            position: image.position,
            url: exerciseImageContentPath({ workspaceId, exerciseId, imageId: image.id }),
        };
    }
```

Add `exerciseImageContentPath` to `packages/api-contract/src/resource-paths.ts`:

```typescript
/** The API route that streams an exercise guide image's bytes, without the `/api/v1` prefix. */
export function exerciseImageContentPath({
    workspaceId,
    exerciseId,
    imageId,
}: {
    workspaceId: string;
    exerciseId: string;
    imageId: string;
}): string {
    return `/workspaces/${workspaceId}/exercises/${exerciseId}/images/${imageId}/content`;
}
```

- [ ] **Step 3: Write the delete handler so it cannot orphan an object**

```typescript
    /** Deletes a guide image and the stored object behind it. */
    @Delete(':exerciseId/images/:imageId')
    async deleteImage(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'imageId', schema: guidSchema }) imageId: string,
    ): Promise<void> {
        const { storageKey } = await this.guides.removeImage({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            imageId,
        });

        await this.storage.deleteFile(storageKey);
    }
```

The row is deleted first: a failed object delete leaves an unreferenced object, which is harmless, whereas the reverse order leaves a row pointing at nothing.

- [ ] **Step 4: Write the link routes**

```typescript
    /** Appends an external link to the exercise's guide. */
    @Post(':exerciseId/links')
    @HttpCode(200)
    async createLink(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedBody(postExerciseLinkRequestSchema) body: PostExerciseLinkRequest,
    ): Promise<ExerciseLinkResponse> {
        return this.guides.addLink({
            userId: currentUser.userId,
            workspaceId,
            exerciseId,
            url: body.url,
            label: body.label ?? null,
        });
    }

    /** Updates a link. An omitted key leaves the stored value alone. */
    @Patch(':exerciseId/links/:linkId')
    async patchLink(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'linkId', schema: guidSchema }) linkId: string,
        @ValidatedBody(patchExerciseLinkRequestSchema) body: PatchExerciseLinkRequest,
    ): Promise<ExerciseLinkResponse> {
        return this.guides.updateLink({ userId: currentUser.userId, workspaceId, exerciseId, linkId, ...body });
    }

    /** Deletes a link from the exercise's guide. */
    @Delete(':exerciseId/links/:linkId')
    async deleteLink(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedParam({ name: 'linkId', schema: guidSchema }) linkId: string,
    ): Promise<void> {
        await this.guides.removeLink({ userId: currentUser.userId, workspaceId, exerciseId, linkId });
    }
```

The controller class is declared `@Controller('v1/workspaces/:workspaceId/exercises')` with `@UseGuards(SessionOrMcpPatGuard)`, and its constructor injects `EXERCISE_GUIDE_SERVICE` as `this.guides` and the storage token as `this.storage`.

- [ ] **Step 5: Fill in the image URL in `exercises.controller.ts`**

Replace the `url: ''` placeholder in `toDetailResponse` with `exerciseImageContentPath({ workspaceId, exerciseId, imageId: image.id })`. This means `toDetailResponse` now needs `workspaceId` and `exerciseId` — change its signature to a single object argument `{ exercise, workspaceId }` and derive `exerciseId` from `exercise.id`.

- [ ] **Step 6: Write the e2e spec**

Create `apps/api/test/exercise-guide.e2e.spec.ts` covering:

```
- POST an image with a PNG payload returns 200 and a url pointing at the content route
- GET that content route returns the bytes with the stored content type
- POST an image with content type text/html returns 400
- DELETE the image returns 204 and a subsequent GET of the content route returns 404
- POST a link returns it at position 0, a second link at position 1
- PATCH a link updates only the field given
- DELETE a link removes it from the exercise detail
- Every route above returns 404 for an exercise in another workspace
```

- [ ] **Step 7: Run the tests**

```bash
docker compose up -d
pnpm --filter @app/api test -- exercise-guide
```

Expected: PASS. MinIO must be running for the storage round-trip.

- [ ] **Step 8: Format, typecheck, commit**

```bash
pnpm format
pnpm --filter @app/api typecheck
git add apps/api/src/exercises apps/api/test/exercise-guide.e2e.spec.ts packages/api-contract/src/resource-paths.ts
git commit -m "feat(api): add exercise guide link and image routes"
```

---

### Task 8: MCP exercise tools

**Files:**
- Modify: `packages/api-contract/src/mcp-tool.contract.ts`
- Create: `apps/mcp/src/mcp/tools/exercise.tools.ts`
- Modify: the tool registry that `apps/mcp` builds its tool list from (find it with `grep -rn "buildItemTools" apps/mcp/src`)
- Modify: `apps/api/test/route-guard-coverage.e2e.spec.ts` (the tool-to-route map only)

**Interfaces:**
- Consumes: `ApiClient` from `@app/api-client`; contract types from Task 3.
- Produces: tools `ListExercises`, `GetExercise`, `CreateExercise`, `UpdateExercise`, `AddExerciseLink`. Arg schemas `listExercisesToolArgsSchema`, `getExerciseToolArgsSchema`, `createExerciseToolArgsSchema`, `updateExerciseToolArgsSchema`, `addExerciseLinkToolArgsSchema`.

No tool takes a `workspaceId` — it comes from the token. Read `apps/mcp/src/mcp/tools/item.tools.ts` first; it is the worked example, including which calls go through `runToolCaught` (writes, so a validation complaint reaches the model) and which propagate (reads, where a 404 is not something rewording fixes).

Image upload is deliberately **not** an MCP tool: multipart from a tool call has no good shape, and an MCP client has no file to send.

- [ ] **Step 1: Add the tool argument schemas**

In `packages/api-contract/src/mcp-tool.contract.ts`, following the existing item schemas:

```typescript
export const listExercisesToolArgsSchema = z.object({
    search: z.string().max(200).nullish(),
    includeArchived: z.boolean().nullish(),
    page: z.number().int().min(1).nullish(),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).nullish(),
});

export const getExerciseToolArgsSchema = z.object({
    exerciseId: guidSchema,
});

export const createExerciseToolArgsSchema = z.object({
    name: z.string().min(1).max(200),
    trackingType: z.enum(TrackingType),
    notes: z.string().max(2000).nullish(),
    guideSetup: z.string().max(4000).nullish(),
    guideExecution: z.string().max(4000).nullish(),
    guideCues: z.string().max(4000).nullish(),
    guideMistakes: z.string().max(4000).nullish(),
});

export const updateExerciseToolArgsSchema = createExerciseToolArgsSchema.partial().extend({
    exerciseId: guidSchema,
    archived: z.boolean().nullish(),
});

export const addExerciseLinkToolArgsSchema = z.object({
    exerciseId: guidSchema,
    url: z.url().max(2000),
    label: z.string().max(200).nullish(),
});
```

- [ ] **Step 2: Write the tools**

Create `apps/mcp/src/mcp/tools/exercise.tools.ts` mirroring `item.tools.ts`: a `buildExerciseTools({ context, client, logger, urls })` function returning `McpToolDefinition[]`, with `basePath = \`/workspaces/${context.workspaceId}/exercises\``. Each tool description must state that the tracking type decides which fields a logged set carries, so a model creating an exercise picks the right one.

- [ ] **Step 3: Register the tools**

Add `buildExerciseTools` alongside `buildItemTools` in whichever module composes the tool list.

- [ ] **Step 4: Update the route-guard tool map**

Add the exercise routes the new tools call to the tool-to-route map in `apps/api/test/route-guard-coverage.e2e.spec.ts`. Add them to the **tool map**, matching the tools you actually wrote — not to the PAT-only allowlist. The image routes are not MCP-reachable and must not appear.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @app/mcp test
pnpm --filter @app/api test -- route-guard-coverage
```

Expected: both PASS.

- [ ] **Step 6: Format, typecheck, commit**

```bash
pnpm format
pnpm typecheck
git add packages/api-contract/src/mcp-tool.contract.ts apps/mcp/src apps/api/test/route-guard-coverage.e2e.spec.ts
git commit -m "feat(mcp): add exercise library tools"
```

---

### Task 9: Exercise library web pages

**Files:**
- Create: `apps/web/src/models/exercise.ts`
- Create: `apps/web/src/hooks/use-exercises.ts`
- Create: `apps/web/src/pages/exercises/ExercisesListPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/AppBottomNav.tsx`

**Interfaces:**
- Consumes: the REST routes from Tasks 6 and 7; `httpClient` from `apps/web/src/lib/http-client.ts`.
- Produces: `type Exercise`, `type ExerciseDetail`, `type ExerciseLink`, `type ExerciseGuideImage`; hooks `useExercises({ workspaceId, search })`, `useExercise({ workspaceId, exerciseId })`, `useCreateExercise({ workspaceId })`, `useUpdateExercise({ workspaceId })`; route `/workspaces/:workspaceId/exercises`.

Read `apps/web/src/pages/items/ItemsListPage.tsx` and `apps/web/src/models/item.ts` first and follow their structure, query-key conventions, and use of `@tanstack/react-query`.

- [ ] **Step 1: Write the model and hooks**

`apps/web/src/models/exercise.ts` mirrors the contract's response types. The web app does not import `@app/api-contract` (follow `models/item.ts`, which restates the shape) — restate the types here.

Tracking type must be a TypeScript enum here too, so the widget switch in plan 4 is exhaustive:

```typescript
export enum TrackingType {
    WeightReps = 'weight_reps',
    Duration = 'duration',
    DistanceTime = 'distance_time',
}
```

- [ ] **Step 2: Build the list page**

Mobile-first: a search input pinned at the top, then a single-column list of exercises showing name and a tracking-type badge. Each row links to the detail page. An empty library shows a "Create your first exercise" call to action, not a blank list — the library starts empty by design, so the empty state is the common first experience, not an edge case.

- [ ] **Step 3: Add the route and nav entry**

Add `/workspaces/:workspaceId/exercises` to `App.tsx` as a lazy route inside the protected workspace section, following how `ItemDetailPage` is registered. Add an "Exercises" entry to `AppBottomNav`.

- [ ] **Step 4: Verify in a browser**

```bash
docker compose up -d
pnpm dev
```

Open the app, sign in, and check: the exercises route renders, the empty state appears on a fresh workspace, creating an exercise adds it to the list, and search filters it. Check at a phone width (390px) as well as desktop — this is the screen used at the gym.

- [ ] **Step 5: Format, typecheck, commit**

```bash
pnpm format
pnpm --filter @app/web typecheck
git add apps/web/src
git commit -m "feat(web): add exercise library list page"
```

---

### Task 10: Exercise detail and guide editor

**Files:**
- Create: `apps/web/src/pages/exercises/ExerciseDetailPage.tsx`
- Create: `apps/web/src/components/exercises/ExerciseGuide.tsx`
- Create: `apps/web/src/components/exercises/ExerciseGuideEditor.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `useExercise`, `useUpdateExercise` (Task 9); the link and image routes (Task 7).
- Produces: route `/workspaces/:workspaceId/exercises/:exerciseId`; `<ExerciseGuide exercise={...} />`, the read-only guide view reused as the workout-mode bottom sheet's body in plan 4.

`ExerciseGuide` is a **presentational component that fetches nothing** — it takes an already-loaded exercise. Plan 4 renders it inside a sheet over the session screen, where its own fetch would be a second spinner in front of someone mid-set.

- [ ] **Step 1: Build the read-only guide view**

`ExerciseGuide` renders the four guide sections in fixed order — Setup, Execution, Cues, Common mistakes — omitting any that are empty, then the images, then the links. Scannable in a few seconds: short line lengths, clear section headings, no accordions to open.

- [ ] **Step 2: Build the detail page**

Header with the exercise name and tracking-type badge, then `ExerciseGuide`, then an Edit affordance that swaps in `ExerciseGuideEditor`. On desktop the editor is two-column (fields left, live guide preview right); on mobile it is a single column.

- [ ] **Step 3: Wire image upload and links**

The editor posts images as `multipart/form-data` through `httpClient.postFormData`, and manages links as a simple add/edit/remove list. Show the same 10 MB and PNG/JPEG/WebP limits from Task 7 in the UI before upload, so a rejected file is a message rather than a failed request.

- [ ] **Step 4: Add the route**

Register `/workspaces/:workspaceId/exercises/:exerciseId` in `App.tsx` as a lazy route.

- [ ] **Step 5: Verify in a browser**

With `pnpm dev` running: create an exercise, write all four guide fields, upload a PNG and confirm it renders, add an external link and confirm it opens in a new tab, try uploading a file over 10 MB and confirm the message is clear. Check at 390px width — the guide must be readable without horizontal scrolling.

- [ ] **Step 6: Full check and commit**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
git add apps/web/src
git commit -m "feat(web): add exercise detail page and guide editor"
```

---

## Done When

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` all pass from a clean checkout.
- An exercise can be created, given a full guide with images and links, searched for, archived, and read back — from the web app and from an MCP client.
- Every workspace-scoped service method has a test proving a caller in another workspace gets a 404.
- `route-guard-coverage.e2e.spec.ts` passes without any new entry in the PAT-only allowlist.
