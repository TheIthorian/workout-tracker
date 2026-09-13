# Workout Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workout sessions end to end — the session state machine and rest-timer arithmetic in `packages/domain`, the three session tables, the REST contract and routes for starting, editing, logging against, completing and abandoning a session, per-exercise history, and the MCP tools that start a session, log a set and complete it.

**Architecture:** Starting a session **copies** the routine's slots into `session_exercises` (snapshot, never a live reference) in one transaction, and every later deviation is an ordinary edit to the session's own rows. `WorkoutSessionsService` (plain class in `packages/services`) owns every read and write and returns the full `SessionDetail` from every mutation, including a `state` block computed by the pure `computeSessionState` in `packages/domain` — the same function a client re-runs locally after an optimistic update. One active session per workspace is enforced by a partial unique index on `workout_sessions(workspace_id) where completed_at is null`; the service checks first and maps the index violation to `ActiveSessionExistsError` for the race. `session_exercises` snapshots the exercise's `tracking_type` too, because an exercise's tracking type is editable and history must keep validating against what was trained. `set_entries.set_index` is dense, one-based, unique per session exercise, and renumbered by the service on delete. Rest is arithmetic on the last logged set's `completed_at`, never a running interval.

**Tech Stack:** TypeScript, NestJS + Fastify, Drizzle + Postgres, Zod, vitest + testcontainers, MCP SDK.

**Spec:** `docs/superpowers/specs/2026-09-10-workout-tracker-phase-1-design.md` — sections "Session snapshot, not live reference", "Online-only, but portable", "`workout_sessions`", "`session_exercises`", "`set_entries`", "API" (sessions routes and `exercises/:id/history`), "Packages" (`session-state.ts`, `rest-timer.ts`, `WorkoutSessionsService`, `ExerciseHistoryService`), "Errors" (`ActiveSessionExistsError`), "Testing". Routines are as built by `docs/superpowers/plans/2026-09-12-routines.md`.

## Global Constraints

- **Never use `any`** — not in source, not in tests, no `oxlint-disable` for it. Where a cast is unavoidable use `as unknown as X`.
- **`type` over `interface`** unless a class implements it.
- **`enum` for closed sets of values** — a TypeScript enum, read by Zod via `z.enum(MyEnum)`. `SessionExerciseSource` and `SessionExerciseStatus` live in `@app/domain`, next to `TrackingType`.
- **Explicit return type on every function and method.**
- **Object arguments** when a function takes two or more parameters.
- **JSDoc on every public method and exported function.** Concise.
- **Comments explain why, never what**, and never describe the change being made.
- **Helpers are declared after their caller.**
- **Never `throw new Error(...)`** — always a typed error from `@app/errors`.
- **Every workspace-scoped WRITE uses `scopedToWorkspace(table, workspaceId, ...filters)`.** Reads that must admit catalog exercises use `scopedToWorkspaceOrGlobal` on the `exercises` table only. Never a hand-written `eq(table.workspaceId, id)` alongside other filters.
- **Every service method calls `membership.require({ userId, workspaceId })` before its query.**
- **A caller who may not see a workspace gets `EntityNotFoundError` (404), never 403.** A session, session exercise, or set in another workspace is a 404. An exercise id the workspace cannot see (other tenant, or archived) is a 404 when added ad hoc.
- **A completed session refuses structural change.** Logging a set, adding, skipping, editing or reordering exercises, and completing again all throw `InvalidOperationError` (400) once `completed_at` is set. Editing or deleting an already-logged set stays allowed after completion — correcting a typo is not a new workout.
- **A session with no working set cannot be completed** (`InvalidOperationError`); it is abandoned with `DELETE` instead.
- **Canonical units only:** kilograms, metres, seconds. No unit conversion server-side.
- **`packages/domain` has no I/O.** Its tests run with no database and no network.
- **Libraries never read `process.env`.**
- **Formatting:** 4-space indent, single quotes, 120 cols, trailing commas. Run `pnpm format` before each commit.
- **Blank line before and after every log statement, and after a closing scope brace.**
- **Migrations:** `pnpm --filter @app/db db:generate` after any schema change; read the SQL before committing; this plan's migration is purely additive (one `CREATE TYPE`, three `CREATE TABLE`s, constraints and indexes) — anything else in it is a bug.
- **`route-guard-coverage.e2e.spec.ts`:** only `MCP_TOKEN_ROUTES` grows, and only with the six routes the MCP tools in Task 7 actually call.
- **Commits:** Conventional Commits, ending with the attribution lines the session provides.

## Ordering note

Tasks are additive and each leaves every existing test green. Task 1 (domain) → Task 2 (schema) → Task 3 (errors + contract) → Task 4 (`WorkoutSessionsService`) → Task 5 (`ExerciseHistoryService`) → Task 6 (API) → Task 7 (MCP). Run `pnpm typecheck` at the end of every task — `tsc -b` covers every project reference.

Not in this plan: the Today page, the session screen, the history page, the rest-timer UI, and the guide bottom sheet (plan 4 — workout mode UI). Plan 4 consumes `computeSessionState` and `sessionRestTimer` from `@app/domain` unchanged.

---

### Task 1: Domain — `session-state.ts` and `rest-timer.ts`

**Files:**

- Create: `packages/domain/src/session-state.ts`
- Create: `packages/domain/src/session-state.spec.ts`
- Create: `packages/domain/src/rest-timer.ts`
- Create: `packages/domain/src/rest-timer.spec.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces: `SessionExerciseSource` (enum, values `from_routine` | `added_ad_hoc`), `SessionExerciseStatus` (enum), `SessionLike` / `SessionExerciseLike` / `SessionSetLike` (structural input types), `SessionState`, `SessionProgress`, `LastLoggedSet`, `computeSessionState(session): SessionState`, `sessionExerciseStatus(exercise): SessionExerciseStatus`, `workingSetCount(exercise): number`, `lastLoggedSet(session): LastLoggedSet | null`, `RestTimer`, `restTimer({ startedAt, restSeconds, now }): RestTimer`, `sessionRestTimer({ session, now }): RestTimer | null`.

- [ ] **Step 1: Write the failing state-machine tests**

`packages/domain/src/session-state.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    computeSessionState,
    lastLoggedSet,
    sessionExerciseStatus,
    SessionExerciseStatus,
    type SessionExerciseLike,
    type SessionLike,
} from './session-state.js';

function exercise(overrides: Partial<SessionExerciseLike> & { id: string; position: number }): SessionExerciseLike {
    return { targetSets: 3, restSeconds: 90, skippedAt: null, sets: [], ...overrides };
}

function set({ isWarmup = false, completedAt }: { isWarmup?: boolean; completedAt: string }): {
    isWarmup: boolean;
    completedAt: string;
} {
    return { isWarmup, completedAt };
}

const T1 = '2026-09-13T10:00:00.000Z';
const T2 = '2026-09-13T10:02:00.000Z';
const T3 = '2026-09-13T10:04:00.000Z';

describe('sessionExerciseStatus', () => {
    it('is pending with no sets', () => {
        expect(sessionExerciseStatus(exercise({ id: 'a', position: 0 }))).toBe(SessionExerciseStatus.Pending);
    });

    it('is in progress once any set is logged, warmups included', () => {
        const status = sessionExerciseStatus(
            exercise({ id: 'a', position: 0, sets: [set({ isWarmup: true, completedAt: T1 })] }),
        );

        expect(status).toBe(SessionExerciseStatus.InProgress);
    });

    it('is done when the working sets reach the target, ignoring warmups', () => {
        const status = sessionExerciseStatus(
            exercise({
                id: 'a',
                position: 0,
                targetSets: 2,
                sets: [set({ isWarmup: true, completedAt: T1 }), set({ completedAt: T2 }), set({ completedAt: T3 })],
            }),
        );

        expect(status).toBe(SessionExerciseStatus.Done);
    });

    it('is skipped whenever skippedAt is set, even with sets logged', () => {
        const status = sessionExerciseStatus(
            exercise({ id: 'a', position: 0, skippedAt: T1, sets: [set({ completedAt: T1 })] }),
        );

        expect(status).toBe(SessionExerciseStatus.Skipped);
    });
});

describe('computeSessionState', () => {
    it('points at the first exercise with no sets and names set 1 as next', () => {
        const session: SessionLike = {
            completedAt: null,
            exercises: [exercise({ id: 'b', position: 1 }), exercise({ id: 'a', position: 0 })],
        };

        expect(computeSessionState(session)).toEqual({
            currentSessionExerciseId: 'a',
            nextSetIndex: 1,
            progress: { totalExercises: 2, completedExercises: 0, skippedExercises: 0, targetSets: 6, loggedSets: 0 },
            canComplete: false,
        });
    });

    it('advances past done and skipped exercises, in position order', () => {
        const session: SessionLike = {
            completedAt: null,
            exercises: [
                exercise({ id: 'a', position: 0, targetSets: 1, sets: [set({ completedAt: T1 })] }),
                exercise({ id: 'b', position: 1, skippedAt: T2 }),
                exercise({ id: 'c', position: 2, sets: [set({ isWarmup: true, completedAt: T3 })] }),
            ],
        };

        const state = computeSessionState(session);

        expect(state.currentSessionExerciseId).toBe('c');
        // Warmups count in the on-screen numbering, so the next set is 2 even though no working set is logged.
        expect(state.nextSetIndex).toBe(2);
        expect(state.progress).toEqual({
            totalExercises: 3,
            completedExercises: 1,
            skippedExercises: 1,
            targetSets: 4,
            loggedSets: 1,
        });
        expect(state.canComplete).toBe(true);
    });

    it('has no current exercise once everything is done or skipped', () => {
        const session: SessionLike = {
            completedAt: null,
            exercises: [
                exercise({ id: 'a', position: 0, targetSets: 1, sets: [set({ completedAt: T1 })] }),
                exercise({ id: 'b', position: 1, skippedAt: T2 }),
            ],
        };

        expect(computeSessionState(session)).toMatchObject({ currentSessionExerciseId: null, nextSetIndex: null });
    });

    it('cannot complete an empty session, or one whose only sets are warmups', () => {
        expect(computeSessionState({ completedAt: null, exercises: [] }).canComplete).toBe(false);

        const warmupsOnly: SessionLike = {
            completedAt: null,
            exercises: [exercise({ id: 'a', position: 0, sets: [set({ isWarmup: true, completedAt: T1 })] })],
        };

        expect(computeSessionState(warmupsOnly).canComplete).toBe(false);
    });

    it('cannot complete a session that is already completed', () => {
        const session: SessionLike = {
            completedAt: T3,
            exercises: [exercise({ id: 'a', position: 0, sets: [set({ completedAt: T1 })] })],
        };

        expect(computeSessionState(session).canComplete).toBe(false);
    });
});

describe('lastLoggedSet', () => {
    it('is null with no sets', () => {
        expect(lastLoggedSet({ completedAt: null, exercises: [exercise({ id: 'a', position: 0 })] })).toBeNull();
    });

    it('finds the most recent set across exercises, by time rather than position', () => {
        const session: SessionLike = {
            completedAt: null,
            exercises: [
                exercise({ id: 'a', position: 0, restSeconds: 60, sets: [set({ completedAt: T3 })] }),
                exercise({
                    id: 'b',
                    position: 1,
                    restSeconds: 120,
                    sets: [set({ completedAt: T1 }), set({ completedAt: T2 })],
                }),
            ],
        };

        expect(lastLoggedSet(session)).toEqual({ sessionExerciseId: 'a', completedAt: T3, restSeconds: 60 });
    });

    it('compares timestamps by instant, not by string, so Postgres and ISO formats mix safely', () => {
        const session: SessionLike = {
            completedAt: null,
            exercises: [
                exercise({ id: 'a', position: 0, sets: [set({ completedAt: '2026-09-13 10:05:00+00' })] }),
                exercise({ id: 'b', position: 1, sets: [set({ completedAt: '2026-09-13T10:04:00.000Z' })] }),
            ],
        };

        expect(lastLoggedSet(session)?.sessionExerciseId).toBe('a');
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @app/domain test -- session-state`
Expected: FAIL — `Cannot find module './session-state.js'`.

- [ ] **Step 3: Write `session-state.ts`**

`packages/domain/src/session-state.ts`:

```ts
/** Where a session exercise came from: copied from the routine at start, or added mid-session. */
export enum SessionExerciseSource {
    FromRoutine = 'from_routine',
    AddedAdHoc = 'added_ad_hoc',
}

/** Where one exercise stands within a session. */
export enum SessionExerciseStatus {
    Pending = 'pending',
    InProgress = 'in_progress',
    Done = 'done',
    Skipped = 'skipped',
}

/** The slice of a logged set the state machine reads. */
export type SessionSetLike = { isWarmup: boolean; completedAt: string };

/** The slice of a session exercise the state machine reads. */
export type SessionExerciseLike = {
    id: string;
    position: number;
    targetSets: number;
    restSeconds: number | null;
    skippedAt: string | null;
    sets: ReadonlyArray<SessionSetLike>;
};

/** The slice of a session the state machine reads. */
export type SessionLike = {
    completedAt: string | null;
    exercises: ReadonlyArray<SessionExerciseLike>;
};

export type SessionProgress = {
    totalExercises: number;
    completedExercises: number;
    skippedExercises: number;
    /** Sum of `targetSets` over the exercises that were not skipped. */
    targetSets: number;
    /** Working (non-warmup) sets logged across every exercise, skipped ones included. */
    loggedSets: number;
};

export type SessionState = {
    /** The first exercise in position order that is neither done nor skipped; null when none is left. */
    currentSessionExerciseId: string | null;
    /** The one-based index the next set against the current exercise takes; null with no current exercise. */
    nextSetIndex: number | null;
    progress: SessionProgress;
    /** Active and holding at least one working set. An empty session is abandoned, not completed. */
    canComplete: boolean;
};

/** The most recently logged set and the rest its exercise prescribes — what the rest timer runs from. */
export type LastLoggedSet = { sessionExerciseId: string; completedAt: string; restSeconds: number | null };

/** Derives where the session stands: the exercise to expand, the next set number, progress, and completability. */
export function computeSessionState(session: SessionLike): SessionState {
    const ordered = [...session.exercises].sort((a, b) => a.position - b.position);
    const statuses = ordered.map((exercise) => ({ exercise, status: sessionExerciseStatus(exercise) }));

    const current = statuses.find(
        ({ status }) => status === SessionExerciseStatus.Pending || status === SessionExerciseStatus.InProgress,
    );

    const progress: SessionProgress = {
        totalExercises: ordered.length,
        completedExercises: statuses.filter(({ status }) => status === SessionExerciseStatus.Done).length,
        skippedExercises: statuses.filter(({ status }) => status === SessionExerciseStatus.Skipped).length,
        targetSets: statuses
            .filter(({ status }) => status !== SessionExerciseStatus.Skipped)
            .reduce((sum, { exercise }) => sum + exercise.targetSets, 0),
        loggedSets: ordered.reduce((sum, exercise) => sum + workingSetCount(exercise), 0),
    };

    return {
        currentSessionExerciseId: current?.exercise.id ?? null,
        nextSetIndex: current === undefined ? null : current.exercise.sets.length + 1,
        progress,
        canComplete: session.completedAt === null && progress.loggedSets > 0,
    };
}

/** Skipped beats everything; otherwise done once the working sets reach the target. */
export function sessionExerciseStatus(exercise: SessionExerciseLike): SessionExerciseStatus {
    if (exercise.skippedAt !== null) return SessionExerciseStatus.Skipped;

    if (workingSetCount(exercise) >= exercise.targetSets) return SessionExerciseStatus.Done;

    return exercise.sets.length === 0 ? SessionExerciseStatus.Pending : SessionExerciseStatus.InProgress;
}

/** Sets that count toward the target — everything that is not a warmup. */
export function workingSetCount(exercise: SessionExerciseLike): number {
    return exercise.sets.filter((set) => !set.isWarmup).length;
}

/** The set logged most recently anywhere in the session, compared by instant. */
export function lastLoggedSet(session: SessionLike): LastLoggedSet | null {
    let latest: LastLoggedSet | null = null;
    let latestMs = Number.NEGATIVE_INFINITY;

    for (const exercise of session.exercises) {
        for (const set of exercise.sets) {
            const completedMs = Date.parse(set.completedAt);
            if (completedMs <= latestMs) continue;

            latestMs = completedMs;
            latest = {
                sessionExerciseId: exercise.id,
                completedAt: set.completedAt,
                restSeconds: exercise.restSeconds,
            };
        }
    }

    return latest;
}
```

- [ ] **Step 4: Run the state-machine tests**

Run: `pnpm --filter @app/domain test -- session-state`
Expected: PASS.

- [ ] **Step 5: Write the failing rest-timer tests**

`packages/domain/src/rest-timer.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { restTimer, sessionRestTimer } from './rest-timer.js';
import type { SessionLike } from './session-state.js';

const STARTED = '2026-09-13T10:00:00.000Z';

describe('restTimer', () => {
    it('counts down from the stored start, not from when it was asked', () => {
        const timer = restTimer({ startedAt: STARTED, restSeconds: 90, now: new Date('2026-09-13T10:00:30.000Z') });

        expect(timer).toEqual({ endsAt: '2026-09-13T10:01:30.000Z', remainingSeconds: 60, isFinished: false });
    });

    it('rounds a partial second up so the display never shows 0 while time remains', () => {
        const timer = restTimer({ startedAt: STARTED, restSeconds: 90, now: new Date('2026-09-13T10:01:29.200Z') });

        expect(timer.remainingSeconds).toBe(1);
        expect(timer.isFinished).toBe(false);
    });

    it('is finished, never negative, after the phone sat in a pocket for an hour', () => {
        const timer = restTimer({ startedAt: STARTED, restSeconds: 90, now: new Date('2026-09-13T11:00:00.000Z') });

        expect(timer).toEqual({ endsAt: '2026-09-13T10:01:30.000Z', remainingSeconds: 0, isFinished: true });
    });

    it('never exceeds the prescribed rest when the clocks disagree and the start is in the future', () => {
        const timer = restTimer({ startedAt: STARTED, restSeconds: 90, now: new Date('2026-09-13T09:59:00.000Z') });

        expect(timer.remainingSeconds).toBe(90);
    });

    it('accepts the timestamp format Postgres returns', () => {
        const timer = restTimer({
            startedAt: '2026-09-13 10:00:00.123456+00',
            restSeconds: 60,
            now: new Date('2026-09-13T10:00:30.123Z'),
        });

        expect(timer.remainingSeconds).toBe(30);
    });
});

describe('sessionRestTimer', () => {
    const base = { id: 'a', position: 0, targetSets: 3, skippedAt: null };

    it('runs from the most recently logged set, with that exercise’s rest', () => {
        const session: SessionLike = {
            completedAt: null,
            exercises: [
                { ...base, id: 'a', restSeconds: 60, sets: [{ isWarmup: false, completedAt: STARTED }] },
                {
                    ...base,
                    id: 'b',
                    position: 1,
                    restSeconds: 120,
                    sets: [{ isWarmup: false, completedAt: '2026-09-13T10:05:00.000Z' }],
                },
            ],
        };

        const timer = sessionRestTimer({ session, now: new Date('2026-09-13T10:05:30.000Z') });

        expect(timer).toEqual({ endsAt: '2026-09-13T10:07:00.000Z', remainingSeconds: 90, isFinished: false });
    });

    it('is null with no sets, with no rest prescribed, or once the session is completed', () => {
        const noSets: SessionLike = { completedAt: null, exercises: [{ ...base, restSeconds: 60, sets: [] }] };
        const noRest: SessionLike = {
            completedAt: null,
            exercises: [{ ...base, restSeconds: null, sets: [{ isWarmup: false, completedAt: STARTED }] }],
        };
        const completed: SessionLike = {
            completedAt: '2026-09-13T10:30:00.000Z',
            exercises: [{ ...base, restSeconds: 60, sets: [{ isWarmup: false, completedAt: STARTED }] }],
        };
        const now = new Date('2026-09-13T10:00:10.000Z');

        expect(sessionRestTimer({ session: noSets, now })).toBeNull();
        expect(sessionRestTimer({ session: noRest, now })).toBeNull();
        expect(sessionRestTimer({ session: completed, now })).toBeNull();
    });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @app/domain test -- rest-timer`
Expected: FAIL — `Cannot find module './rest-timer.js'`.

- [ ] **Step 7: Write `rest-timer.ts`**

`packages/domain/src/rest-timer.ts`:

```ts
import { lastLoggedSet, type SessionLike } from './session-state.js';

export type RestTimer = {
    /** ISO instant the rest ends. */
    endsAt: string;
    /** Whole seconds left, rounded up, never negative. */
    remainingSeconds: number;
    isFinished: boolean;
};

/**
 * Remaining rest as arithmetic on a stored start, so it survives a locked or backgrounded phone
 * that would have killed a running interval.
 *
 * Clamped to `[0, restSeconds]`: a long absence reads as finished, and a start that sits in the
 * future because two clocks disagree reads as a full rest rather than more than was prescribed.
 */
export function restTimer({
    startedAt,
    restSeconds,
    now,
}: {
    startedAt: string;
    restSeconds: number;
    now: Date;
}): RestTimer {
    const endsAtMs = Date.parse(startedAt) + restSeconds * 1000;
    const remainingSeconds = Math.min(restSeconds, Math.max(0, Math.ceil((endsAtMs - now.getTime()) / 1000)));

    return { endsAt: new Date(endsAtMs).toISOString(), remainingSeconds, isFinished: remainingSeconds === 0 };
}

/**
 * The rest timer an active session is currently running: from its most recently logged set, for
 * that set's exercise's rest. Null when nothing is resting — no set yet, no rest prescribed, or
 * the session is over.
 */
export function sessionRestTimer({ session, now }: { session: SessionLike; now: Date }): RestTimer | null {
    if (session.completedAt !== null) return null;

    const last = lastLoggedSet(session);
    if (last === null || last.restSeconds === null || last.restSeconds <= 0) return null;

    return restTimer({ startedAt: last.completedAt, restSeconds: last.restSeconds, now });
}
```

- [ ] **Step 8: Export from the package index**

`packages/domain/src/index.ts` — replace the whole file with:

```ts
export { Decimal } from './decimal.js';
export { restTimer, sessionRestTimer, type RestTimer } from './rest-timer.js';
export {
    SessionExerciseSource,
    SessionExerciseStatus,
    computeSessionState,
    lastLoggedSet,
    sessionExerciseStatus,
    workingSetCount,
    type LastLoggedSet,
    type SessionExerciseLike,
    type SessionLike,
    type SessionProgress,
    type SessionSetLike,
    type SessionState,
} from './session-state.js';
export {
    TrackingType,
    allowedMeasurementFields,
    requiredMeasurementFields,
    validateSetMeasurements,
    type SetMeasurements,
    type SetMeasurementsValidation,
} from './tracking-type.js';
```

- [ ] **Step 9: Run the whole domain suite, format, typecheck**

Run: `pnpm --filter @app/domain test && pnpm format && pnpm typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): add the session state machine and rest-timer arithmetic"
```

---

### Task 2: Schema — `workout_sessions`, `session_exercises`, `set_entries`

**Files:**

- Create: `packages/db/src/schema/sessions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0005_<generated>.sql` (generated)
- Modify: `packages/db/drizzle/meta/*` (generated)

**Interfaces:**

- Consumes: `SessionExerciseSource`, `TrackingType` from `@app/domain` (Task 1); `trackingTypeEnum` from `./exercises.js`.
- Produces: `schema.workoutSessions`, `schema.sessionExercises`, `schema.setEntries`, `schema.sessionExerciseSourceEnum`.

- [ ] **Step 1: Write the schema**

`packages/db/src/schema/sessions.ts`:

```ts
import { SessionExerciseSource } from '@app/domain';
import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    foreignKey,
    index,
    integer,
    numeric,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { exercises, trackingTypeEnum } from './exercises.js';
import { routines } from './routines.js';
import { workspaces } from './workspaces.js';

export const sessionExerciseSourceEnum = pgEnum('session_exercise_source', [
    SessionExerciseSource.FromRoutine,
    SessionExerciseSource.AddedAdHoc,
]);

/**
 * One workout. `routine_id` records where the exercise list was copied from and is never read
 * back for targets; it nulls out if the routine is ever hard-deleted, as does `user_id` for the
 * member, so history outlives both.
 *
 * At most one session per workspace is active (`completed_at is null`), enforced by the partial
 * unique index: a backgrounded phone plus an open desktop tab must land in the same session.
 */
export const workoutSessions = pgTable(
    'workout_sessions',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        userId: uuid('user_id'),
        routineId: uuid('routine_id'),
        name: text('name').notNull(),
        startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
        notes: text('notes'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('workout_sessions_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        uniqueIndex('workout_sessions_active_uidx')
            .on(table.workspaceId)
            .where(sql`${table.completedAt} is null`),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'workout_sessions_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.userId],
            foreignColumns: [user.id],
            name: 'workout_sessions_user_id_user_id_fk',
        }).onDelete('set null'),
        foreignKey({
            columns: [table.routineId],
            foreignColumns: [routines.id],
            name: 'workout_sessions_routine_id_routines_id_fk',
        }).onDelete('set null'),
    ],
);

/**
 * The snapshot boundary. Each row is a copy of a routine slot (or an ad-hoc addition) with its
 * targets frozen at session start; nothing here reads back into `routines`. `tracking_type` is
 * copied too, because an exercise's tracking type is editable and a set logged last month must
 * keep validating against what was actually trained.
 *
 * `position` is dense and 0-based, kept so by the service rather than a unique index for the same
 * reason `routine_exercises` does it.
 */
export const sessionExercises = pgTable(
    'session_exercises',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        sessionId: uuid('session_id').notNull(),
        exerciseId: uuid('exercise_id').notNull(),
        trackingType: trackingTypeEnum('tracking_type').notNull(),
        source: sessionExerciseSourceEnum('source').notNull(),
        position: integer('position').notNull(),
        targetSets: integer('target_sets').notNull(),
        restSeconds: integer('rest_seconds'),
        notes: text('notes'),
        skippedAt: timestamp('skipped_at', { withTimezone: true, mode: 'string' }),
        targetReps: integer('target_reps'),
        targetWeightKg: numeric('target_weight_kg', { precision: 7, scale: 2, mode: 'number' }),
        targetDurationSeconds: integer('target_duration_seconds'),
        targetDistanceM: numeric('target_distance_m', { precision: 9, scale: 2, mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('session_exercises_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        index('session_exercises_session_id_idx').using('btree', table.sessionId.asc().nullsLast().op('uuid_ops')),
        // Per-exercise history reads by exercise across every session.
        index('session_exercises_exercise_id_idx').using('btree', table.exerciseId.asc().nullsLast().op('uuid_ops')),
        check('session_exercises_target_sets_check', sql`${table.targetSets} >= 1`),
        check(
            'session_exercises_targets_non_negative_check',
            sql`coalesce(${table.restSeconds}, 0) >= 0 and coalesce(${table.targetReps}, 0) >= 0 and coalesce(${table.targetWeightKg}, 0) >= 0 and coalesce(${table.targetDurationSeconds}, 0) >= 0 and coalesce(${table.targetDistanceM}, 0) >= 0`,
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'session_exercises_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.sessionId],
            foreignColumns: [workoutSessions.id],
            name: 'session_exercises_session_id_workout_sessions_id_fk',
        }).onDelete('cascade'),
        // Exercises are archived, never deleted; `restrict` makes a stray hard delete fail loudly
        // instead of silently erasing what was trained.
        foreignKey({
            columns: [table.exerciseId],
            foreignColumns: [exercises.id],
            name: 'session_exercises_exercise_id_exercises_id_fk',
        }).onDelete('restrict'),
    ],
);

/**
 * One logged set. `set_index` is dense and one-based per session exercise and renumbered by the
 * service on delete, so on-screen numbering never has a gap; the unique index holds because the
 * renumber walks ascending, each row moving into the slot the previous one just left.
 *
 * Which measurement columns a row must carry follows the parent's `tracking_type` and is checked
 * in the service with `@app/domain`'s `validateSetMeasurements`. The check here mirrors only the
 * type-independent half — every tracking type requires reps or a duration — because a check
 * constraint cannot see the parent row.
 */
export const setEntries = pgTable(
    'set_entries',
    {
        id: uuid('id').primaryKey().defaultRandom().notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        sessionExerciseId: uuid('session_exercise_id').notNull(),
        setIndex: integer('set_index').notNull(),
        completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        isWarmup: boolean('is_warmup').default(false).notNull(),
        rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
        weightKg: numeric('weight_kg', { precision: 7, scale: 2, mode: 'number' }),
        reps: integer('reps'),
        durationSeconds: integer('duration_seconds'),
        distanceM: numeric('distance_m', { precision: 9, scale: 2, mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
            .default(sql`now()`)
            .notNull(),
    },
    (table) => [
        index('set_entries_workspace_id_idx').using('btree', table.workspaceId.asc().nullsLast().op('uuid_ops')),
        uniqueIndex('set_entries_session_exercise_id_set_index_uidx').on(table.sessionExerciseId, table.setIndex),
        check('set_entries_set_index_check', sql`${table.setIndex} >= 1`),
        check('set_entries_rpe_check', sql`${table.rpe} is null or (${table.rpe} >= 0 and ${table.rpe} <= 10)`),
        check(
            'set_entries_measurements_non_negative_check',
            sql`coalesce(${table.weightKg}, 0) >= 0 and coalesce(${table.reps}, 0) >= 0 and coalesce(${table.durationSeconds}, 0) >= 0 and coalesce(${table.distanceM}, 0) >= 0`,
        ),
        check(
            'set_entries_measurement_present_check',
            sql`${table.reps} is not null or ${table.durationSeconds} is not null`,
        ),
        foreignKey({
            columns: [table.workspaceId],
            foreignColumns: [workspaces.id],
            name: 'set_entries_workspace_id_workspaces_id_fk',
        }).onDelete('cascade'),
        foreignKey({
            columns: [table.sessionExerciseId],
            foreignColumns: [sessionExercises.id],
            name: 'set_entries_session_exercise_id_session_exercises_id_fk',
        }).onDelete('cascade'),
    ],
);
```

- [ ] **Step 2: Export it**

`packages/db/src/schema/index.ts` — append:

```ts
export * from './sessions.js';
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @app/db db:generate`
Expected: one new file `packages/db/drizzle/0005_*.sql` plus `meta/0005_snapshot.json` and an updated `meta/_journal.json`.

- [ ] **Step 4: Read the SQL**

Open the generated `0005_*.sql`. It must contain exactly: `CREATE TYPE "public"."session_exercise_source" AS ENUM('from_routine', 'added_ad_hoc')`, three `CREATE TABLE`s (`session_exercises`, `set_entries`, `workout_sessions`) each with its `CHECK` constraints inline, the eight `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements with the `ON DELETE` actions above (`cascade` / `set null` / `restrict`), and the seven `CREATE INDEX` / `CREATE UNIQUE INDEX` statements — including `CREATE UNIQUE INDEX "workout_sessions_active_uidx" ON "workout_sessions" USING btree ("workspace_id") WHERE "workout_sessions"."completed_at" is null`. **No `DROP`, no `ALTER` of an existing table.** If anything else appears, the schema file is wrong; fix it and regenerate rather than editing the SQL.

- [ ] **Step 5: Prove the migration applies and the partial unique index holds**

Run: `pnpm --filter @app/db test`
Expected: PASS (the existing `client.spec.ts` / `transaction.spec.ts` boot a container and apply every migration, so a broken migration fails here). Then confirm the index's behaviour once the service exists — Task 4's spec covers the race.

- [ ] **Step 6: Format, typecheck, commit**

Run: `pnpm format && pnpm typecheck`
Expected: no errors.

```bash
git add packages/db
git commit -m "feat(db): add workout_sessions, session_exercises and set_entries tables"
```

---

### Task 3: `ActiveSessionExistsError` + contract — session schemas, history schema, resource paths, MCP tool args

**Files:**

- Modify: `packages/errors/src/app-error.ts`
- Modify: `packages/errors/src/app-error.spec.ts`
- Create: `packages/api-contract/src/session.contract.ts`
- Create: `packages/api-contract/src/session.contract.spec.ts`
- Modify: `packages/api-contract/src/resource-paths.ts`
- Modify: `packages/api-contract/src/mcp-tool.contract.ts`
- Modify: `packages/api-contract/src/index.ts`

**Interfaces:**

- Consumes: `SessionExerciseSource`, `TrackingType` from `@app/domain`.
- Produces: `ActiveSessionExistsError` (409). Contract: `sessionSetResponseSchema`, `sessionExerciseResponseSchema`, `sessionStateSchema`, `sessionResponseSchema`, `sessionDetailResponseSchema`, `sessionListResponseSchema`, `activeSessionResponseSchema`, `sessionListQuerySchema`, `postSessionRequestSchema`, `completeSessionRequestSchema`, `postSessionExerciseRequestSchema`, `patchSessionExerciseRequestSchema`, `putSessionExerciseOrderRequestSchema`, `postSetRequestSchema`, `patchSetRequestSchema`, `exerciseHistoryQuerySchema`, `exerciseHistoryResponseSchema`, and their `z.infer` types (`SessionDetailResponse`, `SessionListResponse`, `ActiveSessionResponse`, `PostSessionRequest`, `CompleteSessionRequest`, `PostSessionExerciseRequest`, `PatchSessionExerciseRequest`, `PutSessionExerciseOrderRequest`, `PostSetRequest`, `PatchSetRequest`, `ExerciseHistoryQuery`, `ExerciseHistoryResponse`, `SessionListQuery`). Paths: `sessionWebPath`, `sessionApiPath`. MCP args: `listSessionsToolArgsSchema`, `getActiveSessionToolArgsSchema`, `getSessionToolArgsSchema`, `startSessionToolArgsSchema`, `logSetToolArgsSchema`, `completeSessionToolArgsSchema`.

- [ ] **Step 1: Write the failing error test**

Append to `packages/errors/src/app-error.spec.ts`, inside the existing top-level `describe` (add `ActiveSessionExistsError` to the import from `./app-error.js`):

```ts
it('builds the ActiveSessionExists problem body as a 409', () => {
    const error = new ActiveSessionExistsError();

    expect(error.problem).toMatchObject({
        type: expect.stringMatching(/\/ActiveSessionExistsError$/),
        title: 'An active session already exists',
        status: 409,
    });
    expect(error.statusCode).toBe(409);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @app/errors test`
Expected: FAIL — `ActiveSessionExistsError` is not exported.

- [ ] **Step 3: Add the error class**

`packages/errors/src/app-error.ts` — insert after `SetShapeMismatchError`:

```ts
/**
 * Thrown when starting a session while the workspace already has one in progress (HTTP 409).
 * Finish or abandon the live one first; a second live session would split one workout's sets
 * across two rows.
 */
export class ActiveSessionExistsError extends AppError {
    constructor(detail?: string) {
        super(
            'An active session already exists',
            buildProblem({
                errorName: 'ActiveSessionExistsError',
                title: 'An active session already exists',
                status: 409,
                detail,
            }),
        );
    }
}
```

- [ ] **Step 4: Run the errors suite**

Run: `pnpm --filter @app/errors test`
Expected: PASS.

- [ ] **Step 5: Write the failing contract tests**

`packages/api-contract/src/session.contract.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    completeSessionRequestSchema,
    exerciseHistoryQuerySchema,
    patchSessionExerciseRequestSchema,
    patchSetRequestSchema,
    postSessionExerciseRequestSchema,
    postSessionRequestSchema,
    postSetRequestSchema,
    putSessionExerciseOrderRequestSchema,
} from './session.contract.js';

const idA = '4b6c7e39-0f8b-4c8b-9a8e-2d1f0f0e1a11';
const idB = '4b6c7e39-0f8b-4c8b-9a8e-2d1f0f0e1a22';

describe('postSessionRequestSchema', () => {
    it('accepts a missing body as a blank session', () => {
        expect(postSessionRequestSchema.parse(undefined)).toEqual({});
        expect(postSessionRequestSchema.parse({})).toEqual({});
    });

    it('accepts a routine id and an override name', () => {
        expect(postSessionRequestSchema.parse({ routineId: idA, name: 'Legs' })).toEqual({
            routineId: idA,
            name: 'Legs',
        });
    });

    it('rejects a blank name', () => {
        expect(postSessionRequestSchema.safeParse({ name: '' }).success).toBe(false);
    });
});

describe('completeSessionRequestSchema', () => {
    it('accepts a missing body', () => {
        expect(completeSessionRequestSchema.parse(undefined)).toEqual({});
    });
});

describe('postSessionExerciseRequestSchema', () => {
    it('defaults targetSets to 3', () => {
        expect(postSessionExerciseRequestSchema.parse({ exerciseId: idA })).toMatchObject({
            exerciseId: idA,
            targetSets: 3,
        });
    });

    it('rejects zero sets and negative targets', () => {
        expect(postSessionExerciseRequestSchema.safeParse({ exerciseId: idA, targetSets: 0 }).success).toBe(false);
        expect(postSessionExerciseRequestSchema.safeParse({ exerciseId: idA, targetWeightKg: -1 }).success).toBe(false);
    });
});

describe('patchSessionExerciseRequestSchema', () => {
    it('requires at least one field and accepts skipped alone', () => {
        expect(patchSessionExerciseRequestSchema.safeParse({}).success).toBe(false);
        expect(patchSessionExerciseRequestSchema.parse({ skipped: true })).toEqual({ skipped: true });
    });

    it('does not accept exerciseId, position, or source', () => {
        expect(patchSessionExerciseRequestSchema.safeParse({ exerciseId: idA }).success).toBe(false);
        expect(patchSessionExerciseRequestSchema.safeParse({ position: 1 }).success).toBe(false);
        expect(patchSessionExerciseRequestSchema.safeParse({ source: 'added_ad_hoc' }).success).toBe(false);
    });
});

describe('putSessionExerciseOrderRequestSchema', () => {
    it('rejects an empty list and a repeated id', () => {
        expect(putSessionExerciseOrderRequestSchema.safeParse({ sessionExerciseIds: [] }).success).toBe(false);
        expect(putSessionExerciseOrderRequestSchema.safeParse({ sessionExerciseIds: [idA, idA] }).success).toBe(false);
        expect(putSessionExerciseOrderRequestSchema.safeParse({ sessionExerciseIds: [idA, idB] }).success).toBe(true);
    });
});

describe('postSetRequestSchema', () => {
    it('defaults isWarmup to false and leaves measurements to the service', () => {
        expect(postSetRequestSchema.parse({ reps: 8, weightKg: 60 })).toEqual({
            isWarmup: false,
            reps: 8,
            weightKg: 60,
        });
        // Which measurements fit is the exercise's tracking type's call, which only the service can see.
        expect(postSetRequestSchema.safeParse({}).success).toBe(true);
    });

    it('bounds rpe to 0–10 and refuses negative measurements', () => {
        expect(postSetRequestSchema.safeParse({ reps: 8, rpe: 11 }).success).toBe(false);
        expect(postSetRequestSchema.safeParse({ reps: -1 }).success).toBe(false);
    });
});

describe('patchSetRequestSchema', () => {
    it('requires at least one field and rejects setIndex', () => {
        expect(patchSetRequestSchema.safeParse({}).success).toBe(false);
        expect(patchSetRequestSchema.safeParse({ setIndex: 2 }).success).toBe(false);
        expect(patchSetRequestSchema.parse({ weightKg: 62.5 })).toEqual({ weightKg: 62.5 });
    });
});

describe('exerciseHistoryQuerySchema', () => {
    it('defaults limit to 10 and clamps it to 50', () => {
        expect(exerciseHistoryQuerySchema.parse({})).toEqual({ limit: 10 });
        expect(exerciseHistoryQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
        expect(exerciseHistoryQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @app/api-contract test -- session.contract`
Expected: FAIL — `Cannot find module './session.contract.js'`.

- [ ] **Step 7: Write the contract**

`packages/api-contract/src/session.contract.ts`:

```ts
import { SessionExerciseSource, TrackingType } from '@app/domain';
import { z } from 'zod';
import { guidSchema, paginatedResponseSchema, paginationQuerySchema } from './primitives.js';

/** One logged set, measurements in canonical units. Which are non-null follows the exercise's tracking type. */
export const sessionSetResponseSchema = z.object({
    id: guidSchema,
    setIndex: z.number().int(),
    completedAt: z.string(),
    isWarmup: z.boolean(),
    rpe: z.number().nullable(),
    weightKg: z.number().nullable(),
    reps: z.number().int().nullable(),
    durationSeconds: z.number().int().nullable(),
    distanceM: z.number().nullable(),
});

/** The library exercise a session exercise was copied from — enough to render the card and open its guide. */
export const sessionExerciseSummarySchema = z.object({
    id: guidSchema,
    name: z.string(),
    isCatalog: z.boolean(),
    archivedAt: z.string().nullable(),
});

/** One exercise in a session: the snapshot of its targets, where it came from, and its logged sets. */
export const sessionExerciseResponseSchema = z.object({
    id: guidSchema,
    position: z.number().int(),
    source: z.enum(SessionExerciseSource),
    /** Snapshotted at session start; the input widget and set validation key off this, not the library row. */
    trackingType: z.enum(TrackingType),
    targetSets: z.number().int(),
    restSeconds: z.number().int().nullable(),
    notes: z.string().nullable(),
    skippedAt: z.string().nullable(),
    targetReps: z.number().int().nullable(),
    targetWeightKg: z.number().nullable(),
    targetDurationSeconds: z.number().int().nullable(),
    targetDistanceM: z.number().nullable(),
    exercise: sessionExerciseSummarySchema,
    sets: z.array(sessionSetResponseSchema),
});

export const sessionProgressSchema = z.object({
    totalExercises: z.number().int(),
    completedExercises: z.number().int(),
    skippedExercises: z.number().int(),
    targetSets: z.number().int(),
    loggedSets: z.number().int(),
});

/** `computeSessionState` from `@app/domain`, as the API serves it. A client re-derives the same shape locally. */
export const sessionStateSchema = z.object({
    currentSessionExerciseId: guidSchema.nullable(),
    nextSetIndex: z.number().int().nullable(),
    progress: sessionProgressSchema,
    canComplete: z.boolean(),
});

export const sessionResponseSchema = z.object({
    id: guidSchema,
    name: z.string(),
    /** Provenance only — never read back for targets. */
    routineId: guidSchema.nullable(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    notes: z.string().nullable(),
    exerciseCount: z.number().int(),
    setCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** The whole aggregate — what workout mode fetches once and then mutates locally. */
export const sessionDetailResponseSchema = sessionResponseSchema.extend({
    exercises: z.array(sessionExerciseResponseSchema),
    state: sessionStateSchema,
});

export const sessionListResponseSchema = paginatedResponseSchema(sessionResponseSchema);

/** `GET .../sessions/active`: an envelope, because "nothing is active" is a normal answer, not a 404. */
export const activeSessionResponseSchema = z.object({ session: sessionDetailResponseSchema.nullable() });

/** Query parameters for `GET /api/v1/workspaces/{workspaceId}/sessions`. Newest started first. */
export const sessionListQuerySchema = paginationQuerySchema;

/**
 * The body of `POST /api/v1/workspaces/{workspaceId}/sessions`. Both fields optional and the whole
 * body optional: an empty POST starts a blank session. `name` overrides the routine's name.
 */
export const postSessionRequestSchema = z
    .object({
        routineId: guidSchema.nullable().optional(),
        name: z
            .string()
            .min(1, 'Name is required')
            .max(200, 'Name must not exceed 200 characters')
            .nullable()
            .optional(),
    })
    .default({});

/** The body of `POST .../sessions/{sessionId}/complete`. Optional notes for the finished workout. */
export const completeSessionRequestSchema = z
    .object({
        notes: z.string().max(4000).nullable().optional(),
    })
    .default({});

/**
 * Targets for one session exercise, the same shape and bounds as a routine slot's. Which fields
 * fit is checked by the service against the session exercise's snapshotted tracking type.
 */
const sessionExerciseTargetsSchema = z.object({
    targetSets: z.number().int().min(1).max(100),
    restSeconds: z.number().int().min(0).max(3600).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    targetReps: z.number().int().min(0).max(1000).nullable().optional(),
    targetWeightKg: z.number().min(0).max(10000).nullable().optional(),
    targetDurationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    targetDistanceM: z.number().min(0).max(1000000).nullable().optional(),
});

/** The body of `POST .../sessions/{sessionId}/exercises`: appends an ad-hoc exercise. */
export const postSessionExerciseRequestSchema = sessionExerciseTargetsSchema.extend({
    exerciseId: guidSchema,
    targetSets: z.number().int().min(1).max(100).default(3),
});

/**
 * The body of `PATCH .../sessions/{sessionId}/exercises/{sessionExerciseId}`. `skipped` true skips,
 * false unskips; the rest edits the snapshotted targets. Position goes through the order route.
 */
export const patchSessionExerciseRequestSchema = sessionExerciseTargetsSchema
    .partial()
    .extend({ skipped: z.boolean().optional() })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

/** The body of `PUT .../sessions/{sessionId}/exercises/order`: every session exercise id, in the new order. */
export const putSessionExerciseOrderRequestSchema = z.object({
    sessionExerciseIds: z
        .array(guidSchema)
        .min(1)
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'Each id may appear once' }),
});

/** Measurements a set may carry. All optional here; the service requires what the tracking type needs. */
const setMeasurementsSchema = z.object({
    weightKg: z.number().min(0).max(10000).nullable().optional(),
    reps: z.number().int().min(0).max(1000).nullable().optional(),
    durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    distanceM: z.number().min(0).max(1000000).nullable().optional(),
});

/** The body of `POST .../exercises/{sessionExerciseId}/sets`: logs the next set. */
export const postSetRequestSchema = setMeasurementsSchema.extend({
    isWarmup: z.boolean().default(false),
    rpe: z.number().min(0).max(10).nullable().optional(),
});

/** The body of `PATCH .../sets/{setId}`. An omitted key leaves the stored value alone; the index is not editable. */
export const patchSetRequestSchema = setMeasurementsSchema
    .extend({
        isWarmup: z.boolean().optional(),
        rpe: z.number().min(0).max(10).nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

/** Query parameters for `GET .../exercises/{exerciseId}/history`: how many recent sessions to return. */
export const exerciseHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** One past appearance of an exercise: the session it was in and every set logged against it. */
export const exerciseHistoryEntrySchema = z.object({
    sessionId: guidSchema,
    sessionName: z.string(),
    startedAt: z.string(),
    completedAt: z.string(),
    sessionExerciseId: guidSchema,
    trackingType: z.enum(TrackingType),
    sets: z.array(sessionSetResponseSchema),
});

/** Completed sessions only, most recent first — what backs the last-time prefill. */
export const exerciseHistoryResponseSchema = z.object({ data: z.array(exerciseHistoryEntrySchema) });

export type SessionSetResponse = z.infer<typeof sessionSetResponseSchema>;
export type SessionExerciseResponse = z.infer<typeof sessionExerciseResponseSchema>;
export type SessionStateResponse = z.infer<typeof sessionStateSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type ActiveSessionResponse = z.infer<typeof activeSessionResponseSchema>;
export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;
export type PostSessionRequest = z.infer<typeof postSessionRequestSchema>;
export type CompleteSessionRequest = z.infer<typeof completeSessionRequestSchema>;
export type PostSessionExerciseRequest = z.infer<typeof postSessionExerciseRequestSchema>;
export type PatchSessionExerciseRequest = z.infer<typeof patchSessionExerciseRequestSchema>;
export type PutSessionExerciseOrderRequest = z.infer<typeof putSessionExerciseOrderRequestSchema>;
export type PostSetRequest = z.infer<typeof postSetRequestSchema>;
export type PatchSetRequest = z.infer<typeof patchSetRequestSchema>;
export type ExerciseHistoryQuery = z.infer<typeof exerciseHistoryQuerySchema>;
export type ExerciseHistoryEntry = z.infer<typeof exerciseHistoryEntrySchema>;
export type ExerciseHistoryResponse = z.infer<typeof exerciseHistoryResponseSchema>;
```

- [ ] **Step 8: Add the resource paths**

`packages/api-contract/src/resource-paths.ts` — append:

```ts
/** The session's page in the SPA — workout mode while active, the read-only record after. */
export function sessionWebPath({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }): string {
    return `/workspaces/${workspaceId}/sessions/${sessionId}`;
}

/** The session's own REST route, without the `/api/v1` prefix the generator adds. */
export function sessionApiPath({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }): string {
    return `/workspaces/${workspaceId}/sessions/${sessionId}`;
}
```

- [ ] **Step 9: Add the MCP tool argument schemas**

`packages/api-contract/src/mcp-tool.contract.ts` — insert before the `export type` block:

```ts
/** `list_sessions`. Newest started first. */
export const listSessionsToolArgsSchema = z.strictObject({
    page: z.number().int().min(1).nullish(),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).nullish(),
});

/** `get_active_session` takes no arguments — there is at most one per workspace. */
export const getActiveSessionToolArgsSchema = z.strictObject({});

/** `get_session`. */
export const getSessionToolArgsSchema = z.strictObject({
    sessionId: guidSchema,
});

/** `start_session`. From a routine, or blank when `routineId` is omitted. */
export const startSessionToolArgsSchema = z.strictObject({
    routineId: guidSchema.nullish(),
    name: z.string().min(1).max(200).nullish(),
});

/** `log_set`. Measurements in canonical units; which ones fit follows the session exercise's trackingType. */
export const logSetToolArgsSchema = z.strictObject({
    sessionId: guidSchema,
    sessionExerciseId: guidSchema,
    isWarmup: z.boolean().nullish(),
    rpe: z.number().min(0).max(10).nullish(),
    weightKg: z.number().min(0).max(10000).nullish(),
    reps: z.number().int().min(0).max(1000).nullish(),
    durationSeconds: z.number().int().min(0).max(86400).nullish(),
    distanceM: z.number().min(0).max(1000000).nullish(),
});

/** `complete_session`. */
export const completeSessionToolArgsSchema = z.strictObject({
    sessionId: guidSchema,
    notes: z.string().max(4000).nullish(),
});
```

and append to the `export type` block:

```ts
export type ListSessionsToolArgs = z.infer<typeof listSessionsToolArgsSchema>;
export type GetActiveSessionToolArgs = z.infer<typeof getActiveSessionToolArgsSchema>;
export type GetSessionToolArgs = z.infer<typeof getSessionToolArgsSchema>;
export type StartSessionToolArgs = z.infer<typeof startSessionToolArgsSchema>;
export type LogSetToolArgs = z.infer<typeof logSetToolArgsSchema>;
export type CompleteSessionToolArgs = z.infer<typeof completeSessionToolArgsSchema>;
```

- [ ] **Step 10: Export the contract**

`packages/api-contract/src/index.ts` — insert `export * from './session.contract.js';` after the `routine.contract.js` line.

- [ ] **Step 11: Run the contract suite, format, typecheck**

Run: `pnpm --filter @app/api-contract test && pnpm format && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 12: Commit**

```bash
git add packages/errors packages/api-contract
git commit -m "feat(api-contract): add session schemas, exercise history schema, and ActiveSessionExistsError"
```

---

### Task 4: `WorkoutSessionsService`

**Files:**

- Create: `packages/services/src/workout-sessions.service.ts`
- Create: `packages/services/src/workout-sessions.service.spec.ts`
- Modify: `packages/services/src/index.ts`

**Interfaces:**

- Consumes: `schema.workoutSessions`, `schema.sessionExercises`, `schema.setEntries`, `schema.routines`, `schema.routineExercises`, `schema.exercises` (Task 2); `computeSessionState`, `validateSetMeasurements`, `SessionExerciseSource`, `TrackingType`, `SetMeasurements` from `@app/domain`; `ActiveSessionExistsError`, `EntityNotFoundError`, `InvalidOperationError`, `SetShapeMismatchError` from `@app/errors`; `WorkspaceMembershipService`.
- Produces: `WorkoutSessionsService` with `list`, `getActive`, `get`, `start`, `complete`, `abandon`, `addExercise`, `updateExercise`, `reorderExercises`, `logSet`, `updateSet`, `deleteSet`; types `SessionSummary`, `SessionExercise`, `SessionExerciseTargets`, `SessionExerciseInput`, `SessionSet`, `SetInput`, `SessionDetail`, `PaginatedSessions`.

- [ ] **Step 1: Write the failing service tests**

`packages/services/src/workout-sessions.service.spec.ts`:

```ts
import { schema, type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { SessionExerciseSource, TrackingType } from '@app/domain';
import {
    ActiveSessionExistsError,
    EntityNotFoundError,
    InvalidOperationError,
    SetShapeMismatchError,
} from '@app/errors';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExercisesService } from './exercises.service.js';
import { RoutinesService } from './routines.service.js';
import { seedCatalogExercise, seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';
import { WorkoutSessionsService, type SessionDetail } from './workout-sessions.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let sessions: WorkoutSessionsService;
let routines: RoutinesService;
let exercises: ExercisesService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;

let benchId: string;
let plankId: string;
let runId: string;
let catalogSquatId: string;
let pushDayId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const membership = new WorkspaceMembershipService({ db });
    sessions = new WorkoutSessionsService({ db, membership });
    routines = new RoutinesService({ db, membership });
    exercises = new ExercisesService({ db, membership });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);

    benchId = (await exercises.create({ userId, workspaceId, name: 'Bench', trackingType: TrackingType.WeightReps }))
        .id;
    plankId = (await exercises.create({ userId, workspaceId, name: 'Plank', trackingType: TrackingType.Duration })).id;
    runId = (await exercises.create({ userId, workspaceId, name: 'Run', trackingType: TrackingType.DistanceTime })).id;
    catalogSquatId = await seedCatalogExercise(db, { slug: 'back-squat', name: 'Back Squat' });

    const pushDay = await routines.create({ userId, workspaceId, name: 'Push Day' });
    pushDayId = pushDay.id;
    await routines.replaceExercises({
        userId,
        workspaceId,
        routineId: pushDayId,
        exercises: [
            { exerciseId: benchId, targetSets: 3, targetReps: 8, targetWeightKg: 60, restSeconds: 120 },
            { exerciseId: catalogSquatId, targetSets: 2, targetReps: 5 },
            { exerciseId: plankId, targetSets: 1, targetDurationSeconds: 60 },
        ],
    });
});

afterAll(async () => {
    await database?.stop();
});

/** Every test that starts a session ends it, so the one-active-session rule does not bleed between tests. */
async function endActive(): Promise<void> {
    const active = await sessions.getActive({ userId, workspaceId });
    if (active !== null) await sessions.abandon({ userId, workspaceId, sessionId: active.id });
}

function slot(detail: SessionDetail, name: string): SessionDetail['exercises'][number] {
    const found = detail.exercises.find((exercise) => exercise.exercise.name === name);
    if (found === undefined) throw new EntityNotFoundError(`no slot named ${name}`);
    return found;
}

describe('start', () => {
    it('copies the routine into the session as a snapshot, with the tracking type and targets', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });

        expect(started).toMatchObject({
            name: 'Push Day',
            routineId: pushDayId,
            completedAt: null,
            exerciseCount: 3,
            setCount: 0,
            state: { currentSessionExerciseId: started.exercises[0]?.id, nextSetIndex: 1, canComplete: false },
        });
        expect(
            started.exercises.map((exercise) => [exercise.position, exercise.exercise.name, exercise.source]),
        ).toEqual([
            [0, 'Bench', SessionExerciseSource.FromRoutine],
            [1, 'Back Squat', SessionExerciseSource.FromRoutine],
            [2, 'Plank', SessionExerciseSource.FromRoutine],
        ]);
        expect(slot(started, 'Bench')).toMatchObject({
            trackingType: TrackingType.WeightReps,
            targetSets: 3,
            targetReps: 8,
            targetWeightKg: 60,
            restSeconds: 120,
            exercise: { id: benchId, isCatalog: false },
        });
        expect(slot(started, 'Back Squat').exercise.isCatalog).toBe(true);

        await endActive();
    });

    it('is a snapshot: editing the routine afterwards does not move the session', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        await routines.updateExercise({
            userId,
            workspaceId,
            routineId: pushDayId,
            routineExerciseId: (await routines.get({ userId, workspaceId, routineId: pushDayId })).exercises[0]
                ?.id as string,
            targetReps: 99,
        });

        const reread = await sessions.get({ userId, workspaceId, sessionId: started.id });
        expect(slot(reread, 'Bench').targetReps).toBe(8);

        await routines.updateExercise({
            userId,
            workspaceId,
            routineId: pushDayId,
            routineExerciseId: (await routines.get({ userId, workspaceId, routineId: pushDayId })).exercises[0]
                ?.id as string,
            targetReps: 8,
        });
        await endActive();
    });

    it('starts a blank session with a default name, or the name given', async () => {
        const blank = await sessions.start({ userId, workspaceId });
        expect(blank).toMatchObject({ name: 'Workout', routineId: null, exercises: [] });
        await endActive();

        const named = await sessions.start({ userId, workspaceId, routineId: pushDayId, name: 'Push (light)' });
        expect(named.name).toBe('Push (light)');
        await endActive();
    });

    it('refuses a second active session with a 409', async () => {
        await sessions.start({ userId, workspaceId });

        await expect(sessions.start({ userId, workspaceId })).rejects.toBeInstanceOf(ActiveSessionExistsError);

        await endActive();
    });

    it('is backed by the partial unique index, under the name the service maps to a 409', async () => {
        await sessions.start({ userId, workspaceId });

        // The loser of a race gets past the service's check and hits this instead; the constraint
        // name is what `isActiveSessionViolation` keys on, so pin it here.
        await expect(
            db.insert(schema.workoutSessions).values({ workspaceId, userId, name: 'Racing' }),
        ).rejects.toMatchObject({ cause: { code: '23505', constraint: 'workout_sessions_active_uidx' } });

        await endActive();
    });

    it("cannot start from another workspace's routine", async () => {
        await expect(
            sessions.start({ userId: outsiderId, workspaceId: otherWorkspaceId, routineId: pushDayId }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses a non-member with a 404', async () => {
        await expect(sessions.start({ userId: outsiderId, workspaceId })).rejects.toBeInstanceOf(EntityNotFoundError);
    });
});

describe('the workout: log, skip, add, reorder, complete', () => {
    it('runs a whole session end to end', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        const bench = slot(started, 'Bench');

        const afterWarmup = await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: bench.id,
            isWarmup: true,
            weightKg: 40,
            reps: 10,
        });
        expect(slot(afterWarmup, 'Bench').sets).toMatchObject([
            { setIndex: 1, isWarmup: true, weightKg: 40, reps: 10 },
        ]);
        expect(afterWarmup.state).toMatchObject({
            currentSessionExerciseId: bench.id,
            nextSetIndex: 2,
            canComplete: false,
        });

        let detail = afterWarmup;
        for (const reps of [8, 8, 7]) {
            detail = await sessions.logSet({
                userId,
                workspaceId,
                sessionId: started.id,
                sessionExerciseId: bench.id,
                weightKg: 60,
                reps,
                rpe: 8.5,
            });
        }
        expect(slot(detail, 'Bench').sets.map((set) => set.setIndex)).toEqual([1, 2, 3, 4]);
        expect(detail.setCount).toBe(4);
        // Bench hit its 3 working sets, so the machine moves on to the squat.
        expect(detail.state).toMatchObject({
            currentSessionExerciseId: slot(detail, 'Back Squat').id,
            nextSetIndex: 1,
            canComplete: true,
            progress: { completedExercises: 1, loggedSets: 3, targetSets: 6 },
        });

        const skipped = await sessions.updateExercise({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: slot(detail, 'Back Squat').id,
            skipped: true,
        });
        expect(slot(skipped, 'Back Squat').skippedAt).not.toBeNull();
        expect(skipped.state).toMatchObject({
            currentSessionExerciseId: slot(skipped, 'Plank').id,
            progress: { skippedExercises: 1, targetSets: 4 },
        });

        const unskipped = await sessions.updateExercise({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: slot(detail, 'Back Squat').id,
            skipped: false,
        });
        expect(slot(unskipped, 'Back Squat').skippedAt).toBeNull();

        const added = await sessions.addExercise({
            userId,
            workspaceId,
            sessionId: started.id,
            exerciseId: runId,
            targetSets: 1,
            targetDistanceM: 1000,
        });
        expect(slot(added, 'Run')).toMatchObject({
            position: 3,
            source: SessionExerciseSource.AddedAdHoc,
            trackingType: TrackingType.DistanceTime,
            targetDistanceM: 1000,
        });

        const reordered = await sessions.reorderExercises({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseIds: [
                slot(added, 'Run').id,
                slot(added, 'Bench').id,
                slot(added, 'Plank').id,
                slot(added, 'Back Squat').id,
            ],
        });
        expect(reordered.exercises.map((exercise) => [exercise.position, exercise.exercise.name])).toEqual([
            [0, 'Run'],
            [1, 'Bench'],
            [2, 'Plank'],
            [3, 'Back Squat'],
        ]);

        const completed = await sessions.complete({ userId, workspaceId, sessionId: started.id, notes: 'Good day' });
        expect(completed.completedAt).not.toBeNull();
        expect(completed.notes).toBe('Good day');
        expect(completed.state.canComplete).toBe(false);

        expect(await sessions.getActive({ userId, workspaceId })).toBeNull();
        const listed = await sessions.list({ userId, workspaceId, page: 1, pageSize: 20 });
        expect(listed.data.find((session) => session.id === started.id)).toMatchObject({
            exerciseCount: 4,
            setCount: 4,
            completedAt: completed.completedAt,
        });
    });

    it('returns the active session, with state, from getActive', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });

        const active = await sessions.getActive({ userId, workspaceId });
        expect(active).toMatchObject({ id: started.id, state: { nextSetIndex: 1 } });

        await endActive();
    });

    it('rejects a set whose measurements do not fit the snapshotted tracking type', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });

        await expect(
            sessions.logSet({
                userId,
                workspaceId,
                sessionId: started.id,
                sessionExerciseId: slot(started, 'Plank').id,
                reps: 10,
            }),
        ).rejects.toBeInstanceOf(SetShapeMismatchError);
        // A missing required measurement is a mismatch too — a weight_reps set needs reps.
        await expect(
            sessions.logSet({
                userId,
                workspaceId,
                sessionId: started.id,
                sessionExerciseId: slot(started, 'Bench').id,
                weightKg: 60,
            }),
        ).rejects.toBeInstanceOf(SetShapeMismatchError);

        await endActive();
    });

    it('validates against the snapshot even after the library exercise changes tracking type', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        await exercises.update({ userId, workspaceId, exerciseId: benchId, trackingType: TrackingType.Duration });

        const logged = await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: slot(started, 'Bench').id,
            reps: 8,
        });
        expect(slot(logged, 'Bench').sets).toHaveLength(1);

        await exercises.update({ userId, workspaceId, exerciseId: benchId, trackingType: TrackingType.WeightReps });
        await endActive();
    });

    it('edits and deletes sets, renumbering the rest without a gap', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        const bench = slot(started, 'Bench');
        let detail = started;
        for (const reps of [10, 9, 8]) {
            detail = await sessions.logSet({
                userId,
                workspaceId,
                sessionId: started.id,
                sessionExerciseId: bench.id,
                reps,
            });
        }
        const [first, second, third] = slot(detail, 'Bench').sets;

        const edited = await sessions.updateSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: bench.id,
            setId: second?.id as string,
            weightKg: 62.5,
            isWarmup: true,
        });
        expect(slot(edited, 'Bench').sets[1]).toMatchObject({
            id: second?.id,
            reps: 9,
            weightKg: 62.5,
            isWarmup: true,
        });

        await expect(
            sessions.updateSet({
                userId,
                workspaceId,
                sessionId: started.id,
                sessionExerciseId: bench.id,
                setId: second?.id as string,
                distanceM: 5,
            }),
        ).rejects.toBeInstanceOf(SetShapeMismatchError);

        const afterDelete = await sessions.deleteSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: bench.id,
            setId: first?.id as string,
        });
        expect(slot(afterDelete, 'Bench').sets.map((set) => [set.id, set.setIndex])).toEqual([
            [second?.id, 1],
            [third?.id, 2],
        ]);

        await endActive();
    });

    it('still lets a set be corrected or removed after the session is completed', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        const bench = slot(started, 'Bench');
        const logged = await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: bench.id,
            reps: 8,
        });
        const setId = slot(logged, 'Bench').sets[0]?.id as string;
        await sessions.complete({ userId, workspaceId, sessionId: started.id });

        const edited = await sessions.updateSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: bench.id,
            setId,
            reps: 9,
        });
        expect(slot(edited, 'Bench').sets[0]?.reps).toBe(9);
    });

    it('refuses structural changes and a second completion once completed', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        const bench = slot(started, 'Bench');
        await sessions.logSet({ userId, workspaceId, sessionId: started.id, sessionExerciseId: bench.id, reps: 8 });
        await sessions.complete({ userId, workspaceId, sessionId: started.id });

        const base = { userId, workspaceId, sessionId: started.id };
        await expect(sessions.logSet({ ...base, sessionExerciseId: bench.id, reps: 8 })).rejects.toBeInstanceOf(
            InvalidOperationError,
        );
        await expect(sessions.addExercise({ ...base, exerciseId: runId, targetSets: 1 })).rejects.toBeInstanceOf(
            InvalidOperationError,
        );
        await expect(
            sessions.updateExercise({ ...base, sessionExerciseId: bench.id, skipped: true }),
        ).rejects.toBeInstanceOf(InvalidOperationError);
        await expect(
            sessions.reorderExercises({
                ...base,
                sessionExerciseIds: started.exercises.map((exercise) => exercise.id),
            }),
        ).rejects.toBeInstanceOf(InvalidOperationError);
        await expect(sessions.complete(base)).rejects.toBeInstanceOf(InvalidOperationError);
    });

    it('refuses to complete a session with no working set', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: slot(started, 'Bench').id,
            isWarmup: true,
            reps: 10,
        });

        await expect(sessions.complete({ userId, workspaceId, sessionId: started.id })).rejects.toBeInstanceOf(
            InvalidOperationError,
        );

        await endActive();
    });

    it('refuses a reorder that is not a permutation of the session exercises', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        const ids = started.exercises.map((exercise) => exercise.id);

        await expect(
            sessions.reorderExercises({ userId, workspaceId, sessionId: started.id, sessionExerciseIds: ids.slice(1) }),
        ).rejects.toBeInstanceOf(InvalidOperationError);

        await endActive();
    });

    it('refuses an archived exercise, and a target that does not fit, when adding ad hoc', async () => {
        const started = await sessions.start({ userId, workspaceId });
        const archivedId = (
            await exercises.create({ userId, workspaceId, name: 'Old', trackingType: TrackingType.WeightReps })
        ).id;
        await exercises.update({ userId, workspaceId, exerciseId: archivedId, archived: true });

        await expect(
            sessions.addExercise({ userId, workspaceId, sessionId: started.id, exerciseId: archivedId, targetSets: 1 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            sessions.addExercise({
                userId,
                workspaceId,
                sessionId: started.id,
                exerciseId: plankId,
                targetSets: 1,
                targetReps: 5,
            }),
        ).rejects.toBeInstanceOf(SetShapeMismatchError);

        await endActive();
    });

    it('abandons a session, taking its exercises and sets with it', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: slot(started, 'Bench').id,
            reps: 8,
        });

        await sessions.abandon({ userId, workspaceId, sessionId: started.id });

        expect(await sessions.getActive({ userId, workspaceId })).toBeNull();
        await expect(sessions.get({ userId, workspaceId, sessionId: started.id })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        const orphans = await db
            .select({ id: schema.sessionExercises.id })
            .from(schema.sessionExercises)
            .where(eq(schema.sessionExercises.sessionId, started.id));
        expect(orphans).toEqual([]);
    });
});

describe('tenancy', () => {
    it("cannot read or write another workspace's session, and every refusal is a 404", async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        const bench = slot(started, 'Bench');
        const logged = await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: bench.id,
            reps: 8,
        });
        const setId = slot(logged, 'Bench').sets[0]?.id as string;
        const theirs = { userId: outsiderId, workspaceId: otherWorkspaceId, sessionId: started.id };

        await expect(sessions.get(theirs)).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(sessions.complete(theirs)).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(sessions.abandon(theirs)).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            sessions.addExercise({ ...theirs, exerciseId: catalogSquatId, targetSets: 1 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            sessions.updateExercise({ ...theirs, sessionExerciseId: bench.id, skipped: true }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            sessions.reorderExercises({
                ...theirs,
                sessionExerciseIds: started.exercises.map((exercise) => exercise.id),
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(sessions.logSet({ ...theirs, sessionExerciseId: bench.id, reps: 8 })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(
            sessions.updateSet({ ...theirs, sessionExerciseId: bench.id, setId, reps: 9 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(sessions.deleteSet({ ...theirs, sessionExerciseId: bench.id, setId })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );

        // The outsider's own workspace is untouched: no active session, nothing listed.
        expect(await sessions.getActive({ userId: outsiderId, workspaceId: otherWorkspaceId })).toBeNull();
        expect(
            (await sessions.list({ userId: outsiderId, workspaceId: otherWorkspaceId, page: 1, pageSize: 20 })).data,
        ).toEqual([]);
        // And the member's session is exactly as it was.
        expect(slot(await sessions.get({ userId, workspaceId, sessionId: started.id }), 'Bench').sets).toHaveLength(1);

        await endActive();
    });

    it('does not let a set be reached through a session exercise it does not belong to', async () => {
        const started = await sessions.start({ userId, workspaceId, routineId: pushDayId });
        const bench = slot(started, 'Bench');
        const plank = slot(started, 'Plank');
        const logged = await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: bench.id,
            reps: 8,
        });
        const setId = slot(logged, 'Bench').sets[0]?.id as string;

        await expect(
            sessions.deleteSet({ userId, workspaceId, sessionId: started.id, sessionExerciseId: plank.id, setId }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);

        await endActive();
    });

    it('refuses a non-member with a 404 on every read', async () => {
        await expect(sessions.list({ userId: outsiderId, workspaceId, page: 1, pageSize: 20 })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        await expect(sessions.getActive({ userId: outsiderId, workspaceId })).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @app/services test -- workout-sessions`
Expected: FAIL — `Cannot find module './workout-sessions.service.js'`.

- [ ] **Step 3: Write the service**

`packages/services/src/workout-sessions.service.ts`:

```ts
import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, withTransaction, type Db, type Tx } from '@app/db';
import {
    computeSessionState,
    SessionExerciseSource,
    validateSetMeasurements,
    type SessionState,
    type SetMeasurements,
    type TrackingType,
} from '@app/domain';
import {
    ActiveSessionExistsError,
    EntityNotFoundError,
    InvalidOperationError,
    SetShapeMismatchError,
} from '@app/errors';
import { asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { exercises, routineExercises, routines, sessionExercises, setEntries, workoutSessions } = schema;

/** Postgres error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/** The partial unique index that admits one live session per workspace — `packages/db/src/schema/sessions.ts`. */
const ACTIVE_SESSION_INDEX = 'workout_sessions_active_uidx';

const DEFAULT_SESSION_NAME = 'Workout';

export type SessionSummary = {
    id: string;
    name: string;
    routineId: string | null;
    startedAt: string;
    completedAt: string | null;
    notes: string | null;
    exerciseCount: number;
    setCount: number;
    createdAt: string;
    updatedAt: string;
};

export type SessionSet = {
    id: string;
    setIndex: number;
    completedAt: string;
    isWarmup: boolean;
    rpe: number | null;
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
};

export type SessionExerciseTargets = {
    targetSets: number;
    restSeconds: number | null;
    notes: string | null;
    targetReps: number | null;
    targetWeightKg: number | null;
    targetDurationSeconds: number | null;
    targetDistanceM: number | null;
};

export type SessionExercise = SessionExerciseTargets & {
    id: string;
    position: number;
    source: SessionExerciseSource;
    trackingType: TrackingType;
    skippedAt: string | null;
    exercise: {
        id: string;
        name: string;
        isCatalog: boolean;
        archivedAt: string | null;
    };
    sets: SessionSet[];
};

export type SessionDetail = SessionSummary & { exercises: SessionExercise[]; state: SessionState };

/** An ad-hoc exercise as a caller supplies it: the exercise plus its targets. Omitted targets are null. */
export type SessionExerciseInput = { exerciseId: string; targetSets: number } & Partial<
    Omit<SessionExerciseTargets, 'targetSets'>
>;

/** A set as a caller supplies it. Omitted measurements are null; which must be present follows the tracking type. */
export type SetInput = SetMeasurements & { isWarmup?: boolean; rpe?: number | null };

export type PaginatedSessions = {
    data: SessionSummary[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
};

/**
 * Workout sessions: the snapshot taken from a routine at start, the sets logged against it, and
 * its completion.
 *
 * Every mutation resolves to the full `SessionDetail`, state included, so a client refreshes from
 * one shape whichever route it used. Positions and set indexes are dense and renumbered here;
 * nothing else may write them. A completed session accepts corrections to its sets and nothing
 * else.
 */
export class WorkoutSessionsService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * A page of the workspace's sessions, newest started first, active one included.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async list({
        userId,
        workspaceId,
        page,
        pageSize,
    }: {
        userId: string;
        workspaceId: string;
        page: number;
        pageSize: number;
    }): Promise<PaginatedSessions> {
        await this.membership.require({ userId, workspaceId });

        const where = scopedToWorkspace(workoutSessions, workspaceId);

        const [data, [totals]] = await Promise.all([
            this.db
                .select(SESSION_SUMMARY_COLUMNS)
                .from(workoutSessions)
                .where(where)
                .orderBy(desc(workoutSessions.startedAt), desc(workoutSessions.createdAt))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
            this.db.select({ totalCount: count() }).from(workoutSessions).where(where),
        ]);

        const totalCount = totals?.totalCount ?? 0;

        return { data, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
    }

    /**
     * The workspace's live session, or null when none is in progress.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async getActive({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<SessionDetail | null> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .select({ id: workoutSessions.id })
            .from(workoutSessions)
            .where(scopedToWorkspace(workoutSessions, workspaceId, isNull(workoutSessions.completedAt)));

        if (!row) return null;

        return this.loadDetail({ db: this.db, workspaceId, sessionId: row.id });
    }

    /**
     * One session with its exercises, sets, and derived state.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the session is not in this
     * workspace — the two are deliberately indistinguishable on the wire.
     */
    async get({
        userId,
        workspaceId,
        sessionId,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        return this.loadDetail({ db: this.db, workspaceId, sessionId });
    }

    /**
     * Starts a session, copying the routine's slots (when one is given) into the session as one
     * transaction: a half-copied routine is a session that cannot be trusted.
     *
     * @param name overrides the routine's name; a blank session with no name is called "Workout".
     * @throws ActiveSessionExistsError when the workspace already has a live session.
     * @throws EntityNotFoundError for a non-member, or a routine not in this workspace.
     */
    async start({
        userId,
        workspaceId,
        routineId,
        name,
    }: {
        userId: string;
        workspaceId: string;
        routineId?: string | null;
        name?: string | null;
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        try {
            return await withTransaction(this.db, async (tx) => {
                const [active] = await tx
                    .select({ id: workoutSessions.id })
                    .from(workoutSessions)
                    .where(scopedToWorkspace(workoutSessions, workspaceId, isNull(workoutSessions.completedAt)));

                if (active) throw new ActiveSessionExistsError();

                const routine =
                    routineId === undefined || routineId === null
                        ? null
                        : await this.loadRoutineSnapshot({ db: tx, workspaceId, routineId });

                const [session] = await tx
                    .insert(workoutSessions)
                    .values({
                        workspaceId,
                        userId,
                        routineId: routine?.id ?? null,
                        name: name ?? routine?.name ?? DEFAULT_SESSION_NAME,
                    })
                    .returning({ id: workoutSessions.id });

                if (routine !== null && routine.slots.length > 0) {
                    await tx.insert(sessionExercises).values(
                        routine.slots.map((slot, position) => ({
                            workspaceId,
                            sessionId: session.id,
                            exerciseId: slot.exerciseId,
                            trackingType: slot.trackingType,
                            source: SessionExerciseSource.FromRoutine,
                            position,
                            targetSets: slot.targetSets,
                            restSeconds: slot.restSeconds,
                            notes: slot.notes,
                            targetReps: slot.targetReps,
                            targetWeightKg: slot.targetWeightKg,
                            targetDurationSeconds: slot.targetDurationSeconds,
                            targetDistanceM: slot.targetDistanceM,
                        })),
                    );
                }

                return this.loadDetail({ db: tx, workspaceId, sessionId: session.id });
            });
        } catch (error) {
            // Two starts racing past the check above collide on the partial unique index instead.
            if (isActiveSessionViolation(error)) throw new ActiveSessionExistsError();

            throw error;
        }
    }

    /**
     * Marks the session finished. Only a live session with at least one working set can be
     * completed; an empty one is abandoned instead.
     *
     * @throws InvalidOperationError when the session is already completed or has no working set.
     * @throws EntityNotFoundError when the session is not in this workspace.
     */
    async complete({
        userId,
        workspaceId,
        sessionId,
        notes,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        notes?: string | null;
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            const detail = await this.loadDetail({ db: tx, workspaceId, sessionId });

            if (detail.completedAt !== null) throw new InvalidOperationError('Session is already completed');
            if (!detail.state.canComplete) {
                throw new InvalidOperationError(
                    'Session has no logged sets',
                    'Abandon an empty session instead of completing it',
                );
            }

            const now = new Date().toISOString();

            await tx
                .update(workoutSessions)
                .set({ completedAt: now, updatedAt: now, ...(notes === undefined ? {} : { notes }) })
                .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)));

            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /**
     * Deletes the session and everything logged against it.
     *
     * @throws EntityNotFoundError when the session is not in this workspace.
     */
    async abandon({
        userId,
        workspaceId,
        sessionId,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
    }): Promise<void> {
        await this.membership.require({ userId, workspaceId });

        const deleted = await this.db
            .delete(workoutSessions)
            .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)))
            .returning({ id: workoutSessions.id });

        if (deleted.length === 0) throw new EntityNotFoundError('Session not found');
    }

    /**
     * Appends an ad-hoc exercise to the end of a live session, snapshotting its tracking type.
     *
     * @throws InvalidOperationError when the session is completed.
     * @throws EntityNotFoundError for a session not in this workspace, or an exercise the workspace
     * cannot see (another tenant's, or archived).
     * @throws SetShapeMismatchError when a target does not fit the exercise's tracking type.
     */
    async addExercise({
        userId,
        workspaceId,
        sessionId,
        ...input
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
    } & SessionExerciseInput): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, mustBeActive: true });

            const [exercise] = await tx
                .select({ id: exercises.id, trackingType: exercises.trackingType })
                .from(exercises)
                .where(
                    scopedToWorkspaceOrGlobal(
                        exercises,
                        workspaceId,
                        eq(exercises.id, input.exerciseId),
                        isNull(exercises.archivedAt),
                    ),
                );

            if (!exercise) throw new EntityNotFoundError('Exercise not found');

            assertTargetsFit({ trackingType: exercise.trackingType, targets: input });

            const [{ next }] = await tx
                .select({ next: sql<number>`coalesce(max(${sessionExercises.position}) + 1, 0)`.mapWith(Number) })
                .from(sessionExercises)
                .where(scopedToWorkspace(sessionExercises, workspaceId, eq(sessionExercises.sessionId, sessionId)));

            await tx.insert(sessionExercises).values({
                workspaceId,
                sessionId,
                exerciseId: input.exerciseId,
                trackingType: exercise.trackingType,
                source: SessionExerciseSource.AddedAdHoc,
                position: next,
                targetSets: input.targetSets,
                restSeconds: input.restSeconds ?? null,
                notes: input.notes ?? null,
                targetReps: input.targetReps ?? null,
                targetWeightKg: input.targetWeightKg ?? null,
                targetDurationSeconds: input.targetDurationSeconds ?? null,
                targetDistanceM: input.targetDistanceM ?? null,
            });

            await this.touchSession({ db: tx, workspaceId, sessionId });

            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /**
     * Skips or unskips a session exercise, and/or edits its snapshotted targets. Only the fields
     * present are written; the merged targets are re-checked against the snapshotted tracking type.
     *
     * @throws InvalidOperationError when the session is completed.
     * @throws EntityNotFoundError when the exercise is not in this session and workspace.
     * @throws SetShapeMismatchError when a target does not fit the tracking type.
     */
    async updateExercise({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseId,
        skipped,
        ...patch
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
        skipped?: boolean;
    } & Partial<SessionExerciseTargets>): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, mustBeActive: true });
            const current = await this.requireSessionExercise({ db: tx, workspaceId, sessionId, sessionExerciseId });

            const merged: SessionExerciseTargets = {
                targetSets: patch.targetSets ?? current.targetSets,
                restSeconds: patch.restSeconds === undefined ? current.restSeconds : patch.restSeconds,
                notes: patch.notes === undefined ? current.notes : patch.notes,
                targetReps: patch.targetReps === undefined ? current.targetReps : patch.targetReps,
                targetWeightKg: patch.targetWeightKg === undefined ? current.targetWeightKg : patch.targetWeightKg,
                targetDurationSeconds:
                    patch.targetDurationSeconds === undefined
                        ? current.targetDurationSeconds
                        : patch.targetDurationSeconds,
                targetDistanceM: patch.targetDistanceM === undefined ? current.targetDistanceM : patch.targetDistanceM,
            };
            assertTargetsFit({ trackingType: current.trackingType, targets: merged });

            const now = new Date().toISOString();

            await tx
                .update(sessionExercises)
                .set({
                    ...merged,
                    ...(skipped === undefined ? {} : { skippedAt: skipped ? now : null }),
                    updatedAt: now,
                })
                .where(scopedToWorkspace(sessionExercises, workspaceId, eq(sessionExercises.id, sessionExerciseId)));

            await this.touchSession({ db: tx, workspaceId, sessionId });

            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /**
     * Rewrites the session's exercise order. `sessionExerciseIds` must name every exercise in the
     * session exactly once.
     *
     * @throws InvalidOperationError when the session is completed, or the list is not a permutation.
     * @throws EntityNotFoundError when the session is not in this workspace.
     */
    async reorderExercises({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseIds,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseIds: string[];
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, mustBeActive: true });

            const current = await tx
                .select({ id: sessionExercises.id })
                .from(sessionExercises)
                .where(scopedToWorkspace(sessionExercises, workspaceId, eq(sessionExercises.sessionId, sessionId)));

            const currentIds = new Set(current.map((row) => row.id));
            const isPermutation =
                sessionExerciseIds.length === currentIds.size &&
                new Set(sessionExerciseIds).size === currentIds.size &&
                sessionExerciseIds.every((id) => currentIds.has(id));

            if (!isPermutation) {
                throw new InvalidOperationError('Exercise order must name every exercise in the session exactly once');
            }

            for (const [position, id] of sessionExerciseIds.entries()) {
                await tx
                    .update(sessionExercises)
                    .set({ position })
                    .where(scopedToWorkspace(sessionExercises, workspaceId, eq(sessionExercises.id, id)));
            }

            await this.touchSession({ db: tx, workspaceId, sessionId });

            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /**
     * Logs the next set against a session exercise. The set takes the next dense index; the row
     * is locked for the insert so two devices logging at once cannot take the same one.
     *
     * @throws InvalidOperationError when the session is completed.
     * @throws EntityNotFoundError when the exercise is not in this session and workspace.
     * @throws SetShapeMismatchError when the measurements do not fit the snapshotted tracking type.
     */
    async logSet({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseId,
        isWarmup,
        rpe,
        ...measurements
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
    } & SetInput): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            await this.requireSession({ db: tx, workspaceId, sessionId, mustBeActive: true });
            const exercise = await this.requireSessionExercise({
                db: tx,
                workspaceId,
                sessionId,
                sessionExerciseId,
                lock: true,
            });

            assertSetFits({ trackingType: exercise.trackingType, measurements });

            const [{ next }] = await tx
                .select({ next: sql<number>`coalesce(max(${setEntries.setIndex}) + 1, 1)`.mapWith(Number) })
                .from(setEntries)
                .where(scopedToWorkspace(setEntries, workspaceId, eq(setEntries.sessionExerciseId, sessionExerciseId)));

            await tx.insert(setEntries).values({
                workspaceId,
                sessionExerciseId,
                setIndex: next,
                isWarmup: isWarmup ?? false,
                rpe: rpe ?? null,
                weightKg: measurements.weightKg ?? null,
                reps: measurements.reps ?? null,
                durationSeconds: measurements.durationSeconds ?? null,
                distanceM: measurements.distanceM ?? null,
            });

            await this.touchSession({ db: tx, workspaceId, sessionId });

            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /**
     * Corrects a logged set. Only the fields present are written; the merged measurements are
     * re-checked against the snapshotted tracking type. Allowed after completion — fixing a typo
     * is not a new workout.
     *
     * @throws EntityNotFoundError when the set is not in this session exercise, session and workspace.
     * @throws SetShapeMismatchError when the measurements do not fit the tracking type.
     */
    async updateSet({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseId,
        setId,
        isWarmup,
        rpe,
        ...measurements
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
        setId: string;
    } & SetInput): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            const exercise = await this.requireSessionExercise({ db: tx, workspaceId, sessionId, sessionExerciseId });

            const [current] = await tx
                .select({
                    weightKg: setEntries.weightKg,
                    reps: setEntries.reps,
                    durationSeconds: setEntries.durationSeconds,
                    distanceM: setEntries.distanceM,
                })
                .from(setEntries)
                .where(
                    scopedToWorkspace(
                        setEntries,
                        workspaceId,
                        eq(setEntries.sessionExerciseId, sessionExerciseId),
                        eq(setEntries.id, setId),
                    ),
                );

            if (!current) throw new EntityNotFoundError('Set not found');

            const merged: SetMeasurements = {
                weightKg: measurements.weightKg === undefined ? current.weightKg : measurements.weightKg,
                reps: measurements.reps === undefined ? current.reps : measurements.reps,
                durationSeconds:
                    measurements.durationSeconds === undefined ? current.durationSeconds : measurements.durationSeconds,
                distanceM: measurements.distanceM === undefined ? current.distanceM : measurements.distanceM,
            };
            assertSetFits({ trackingType: exercise.trackingType, measurements: merged });

            await tx
                .update(setEntries)
                .set({
                    weightKg: merged.weightKg ?? null,
                    reps: merged.reps ?? null,
                    durationSeconds: merged.durationSeconds ?? null,
                    distanceM: merged.distanceM ?? null,
                    ...(isWarmup === undefined ? {} : { isWarmup }),
                    ...(rpe === undefined ? {} : { rpe }),
                    updatedAt: new Date().toISOString(),
                })
                .where(
                    scopedToWorkspace(
                        setEntries,
                        workspaceId,
                        eq(setEntries.sessionExerciseId, sessionExerciseId),
                        eq(setEntries.id, setId),
                    ),
                );

            await this.touchSession({ db: tx, workspaceId, sessionId });

            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    /**
     * Removes a set and closes the gap in the remaining indexes. Allowed after completion.
     *
     * @throws EntityNotFoundError when the set is not in this session exercise, session and workspace.
     */
    async deleteSet({
        userId,
        workspaceId,
        sessionId,
        sessionExerciseId,
        setId,
    }: {
        userId: string;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
        setId: string;
    }): Promise<SessionDetail> {
        await this.membership.require({ userId, workspaceId });

        return withTransaction(this.db, async (tx) => {
            await this.requireSessionExercise({ db: tx, workspaceId, sessionId, sessionExerciseId, lock: true });

            const deleted = await tx
                .delete(setEntries)
                .where(
                    scopedToWorkspace(
                        setEntries,
                        workspaceId,
                        eq(setEntries.sessionExerciseId, sessionExerciseId),
                        eq(setEntries.id, setId),
                    ),
                )
                .returning({ id: setEntries.id });

            if (deleted.length === 0) throw new EntityNotFoundError('Set not found');

            const remaining = await tx
                .select({ id: setEntries.id, setIndex: setEntries.setIndex })
                .from(setEntries)
                .where(scopedToWorkspace(setEntries, workspaceId, eq(setEntries.sessionExerciseId, sessionExerciseId)))
                .orderBy(asc(setEntries.setIndex));

            // Ascending order matters: each row moves into the index the previous one just
            // vacated, so the unique index on (session_exercise_id, set_index) never trips.
            for (const [offset, set] of remaining.entries()) {
                const setIndex = offset + 1;
                if (set.setIndex === setIndex) continue;

                await tx
                    .update(setEntries)
                    .set({ setIndex })
                    .where(scopedToWorkspace(setEntries, workspaceId, eq(setEntries.id, set.id)));
            }

            await this.touchSession({ db: tx, workspaceId, sessionId });

            return this.loadDetail({ db: tx, workspaceId, sessionId });
        });
    }

    private async requireSession({
        db,
        workspaceId,
        sessionId,
        mustBeActive,
    }: {
        db: Db | Tx;
        workspaceId: string;
        sessionId: string;
        mustBeActive: boolean;
    }): Promise<void> {
        const [row] = await db
            .select({ id: workoutSessions.id, completedAt: workoutSessions.completedAt })
            .from(workoutSessions)
            .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)));

        if (!row) throw new EntityNotFoundError('Session not found');
        if (mustBeActive && row.completedAt !== null) throw new InvalidOperationError('Session is already completed');
    }

    /**
     * The session exercise's snapshot, provided it belongs to this session and workspace. `lock`
     * takes a row lock so concurrent set writes against the same exercise serialise on it.
     */
    private async requireSessionExercise({
        db,
        workspaceId,
        sessionId,
        sessionExerciseId,
        lock = false,
    }: {
        db: Db | Tx;
        workspaceId: string;
        sessionId: string;
        sessionExerciseId: string;
        lock?: boolean;
    }): Promise<SessionExerciseTargets & { id: string; trackingType: TrackingType }> {
        const query = db
            .select({
                id: sessionExercises.id,
                trackingType: sessionExercises.trackingType,
                targetSets: sessionExercises.targetSets,
                restSeconds: sessionExercises.restSeconds,
                notes: sessionExercises.notes,
                targetReps: sessionExercises.targetReps,
                targetWeightKg: sessionExercises.targetWeightKg,
                targetDurationSeconds: sessionExercises.targetDurationSeconds,
                targetDistanceM: sessionExercises.targetDistanceM,
            })
            .from(sessionExercises)
            .where(
                scopedToWorkspace(
                    sessionExercises,
                    workspaceId,
                    eq(sessionExercises.sessionId, sessionId),
                    eq(sessionExercises.id, sessionExerciseId),
                ),
            );

        const [row] = await (lock ? query.for('update') : query);

        if (!row) throw new EntityNotFoundError('Session exercise not found');

        return row;
    }

    private async loadRoutineSnapshot({
        db,
        workspaceId,
        routineId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        routineId: string;
    }): Promise<{ id: string; name: string; slots: RoutineSlotSnapshot[] }> {
        const [routine] = await db
            .select({ id: routines.id, name: routines.name })
            .from(routines)
            .where(scopedToWorkspace(routines, workspaceId, eq(routines.id, routineId)));

        if (!routine) throw new EntityNotFoundError('Routine not found');

        // The tenant filter sits on `routine_exercises`; the joined exercise may be catalog
        // content (null workspace), admitted when the slot was written.
        const slots = await db
            .select({
                exerciseId: routineExercises.exerciseId,
                trackingType: exercises.trackingType,
                targetSets: routineExercises.targetSets,
                restSeconds: routineExercises.restSeconds,
                notes: routineExercises.notes,
                targetReps: routineExercises.targetReps,
                targetWeightKg: routineExercises.targetWeightKg,
                targetDurationSeconds: routineExercises.targetDurationSeconds,
                targetDistanceM: routineExercises.targetDistanceM,
            })
            .from(routineExercises)
            .innerJoin(exercises, eq(exercises.id, routineExercises.exerciseId))
            .where(scopedToWorkspace(routineExercises, workspaceId, eq(routineExercises.routineId, routineId)))
            .orderBy(asc(routineExercises.position));

        return { ...routine, slots };
    }

    private async touchSession({
        db,
        workspaceId,
        sessionId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        sessionId: string;
    }): Promise<void> {
        await db
            .update(workoutSessions)
            .set({ updatedAt: new Date().toISOString() })
            .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)));
    }

    private async loadDetail({
        db,
        workspaceId,
        sessionId,
    }: {
        db: Db | Tx;
        workspaceId: string;
        sessionId: string;
    }): Promise<SessionDetail> {
        const [session] = await db
            .select(SESSION_SUMMARY_COLUMNS)
            .from(workoutSessions)
            .where(scopedToWorkspace(workoutSessions, workspaceId, eq(workoutSessions.id, sessionId)));

        if (!session) throw new EntityNotFoundError('Session not found');

        // The tenant filter sits on `session_exercises`; the joined exercise may be catalog
        // content (null workspace), admitted when the row was written.
        const exerciseRows = await db
            .select({
                id: sessionExercises.id,
                position: sessionExercises.position,
                source: sessionExercises.source,
                trackingType: sessionExercises.trackingType,
                targetSets: sessionExercises.targetSets,
                restSeconds: sessionExercises.restSeconds,
                notes: sessionExercises.notes,
                skippedAt: sessionExercises.skippedAt,
                targetReps: sessionExercises.targetReps,
                targetWeightKg: sessionExercises.targetWeightKg,
                targetDurationSeconds: sessionExercises.targetDurationSeconds,
                targetDistanceM: sessionExercises.targetDistanceM,
                exercise: {
                    id: exercises.id,
                    name: exercises.name,
                    isCatalog: sql<boolean>`${exercises.workspaceId} is null`,
                    archivedAt: exercises.archivedAt,
                },
            })
            .from(sessionExercises)
            .innerJoin(exercises, eq(exercises.id, sessionExercises.exerciseId))
            .where(scopedToWorkspace(sessionExercises, workspaceId, eq(sessionExercises.sessionId, sessionId)))
            .orderBy(asc(sessionExercises.position));

        const setRows =
            exerciseRows.length === 0
                ? []
                : await db
                      .select({
                          id: setEntries.id,
                          sessionExerciseId: setEntries.sessionExerciseId,
                          setIndex: setEntries.setIndex,
                          completedAt: setEntries.completedAt,
                          isWarmup: setEntries.isWarmup,
                          rpe: setEntries.rpe,
                          weightKg: setEntries.weightKg,
                          reps: setEntries.reps,
                          durationSeconds: setEntries.durationSeconds,
                          distanceM: setEntries.distanceM,
                      })
                      .from(setEntries)
                      .where(
                          scopedToWorkspace(
                              setEntries,
                              workspaceId,
                              inArray(
                                  setEntries.sessionExerciseId,
                                  exerciseRows.map((row) => row.id),
                              ),
                          ),
                      )
                      .orderBy(asc(setEntries.setIndex));

        const setsByExercise = new Map<string, SessionSet[]>();

        for (const { sessionExerciseId, ...set } of setRows) {
            const sets = setsByExercise.get(sessionExerciseId) ?? [];
            sets.push(set);
            setsByExercise.set(sessionExerciseId, sets);
        }

        const sessionExerciseList: SessionExercise[] = exerciseRows.map((row) => ({
            ...row,
            sets: setsByExercise.get(row.id) ?? [],
        }));

        return {
            ...session,
            exercises: sessionExerciseList,
            state: computeSessionState({ completedAt: session.completedAt, exercises: sessionExerciseList }),
        };
    }
}

type RoutineSlotSnapshot = SessionExerciseTargets & { exerciseId: string; trackingType: TrackingType };

const SESSION_SUMMARY_COLUMNS = {
    id: workoutSessions.id,
    name: workoutSessions.name,
    routineId: workoutSessions.routineId,
    startedAt: workoutSessions.startedAt,
    completedAt: workoutSessions.completedAt,
    notes: workoutSessions.notes,
    // Comparisons stay inside nested `SQL` so the single-table rewrite (which strips top-level
    // `PgColumn` qualifiers) does not strip `workout_sessions.id`'s.
    exerciseCount: sql<number>`(select count(*) from ${sessionExercises} where ${eq(
        sessionExercises.sessionId,
        workoutSessions.id,
    )})`.mapWith(Number),
    setCount: sql<number>`(select count(*) from ${setEntries} inner join ${sessionExercises} on ${eq(
        sessionExercises.id,
        setEntries.sessionExerciseId,
    )} where ${eq(sessionExercises.sessionId, workoutSessions.id)})`.mapWith(Number),
    createdAt: workoutSessions.createdAt,
    updatedAt: workoutSessions.updatedAt,
};

/**
 * A missing target is fine — targets are suggestions — so only the `unexpected` half of the
 * domain check matters here; `missing` is what a logged set cares about.
 */
function assertTargetsFit({
    trackingType,
    targets,
}: {
    trackingType: TrackingType;
    targets: Partial<Omit<SessionExerciseTargets, 'targetSets' | 'restSeconds' | 'notes'>>;
}): void {
    const result = validateSetMeasurements({
        trackingType,
        measurements: {
            weightKg: targets.targetWeightKg,
            reps: targets.targetReps,
            durationSeconds: targets.targetDurationSeconds,
            distanceM: targets.targetDistanceM,
        },
    });

    if (result.valid || result.unexpected.length === 0) return;

    throw new SetShapeMismatchError(
        'Targets do not match the exercise tracking type',
        `${trackingType} does not use: ${result.unexpected.join(', ')}`,
    );
}

/** A logged set must carry everything its tracking type requires and nothing it does not. */
function assertSetFits({
    trackingType,
    measurements,
}: {
    trackingType: TrackingType;
    measurements: SetMeasurements;
}): void {
    const result = validateSetMeasurements({ trackingType, measurements });

    if (result.valid) return;

    const details = [
        result.missing.length === 0 ? null : `${trackingType} requires: ${result.missing.join(', ')}`,
        result.unexpected.length === 0 ? null : `${trackingType} does not use: ${result.unexpected.join(', ')}`,
    ].filter((detail) => detail !== null);

    throw new SetShapeMismatchError('Set does not match the exercise tracking type', details.join('; '));
}

/**
 * Drizzle wraps the driver error in `DrizzleQueryError` with the pg error as `cause`, and
 * `withTransaction` does not itself unwrap it.
 */
function isActiveSessionViolation(error: unknown): boolean {
    const cause = (error as { cause?: unknown } | undefined)?.cause;
    const pgError = cause as { code?: string; constraint?: string } | undefined;

    return pgError?.code === UNIQUE_VIOLATION && pgError.constraint === ACTIVE_SESSION_INDEX;
}
```

- [ ] **Step 4: Export from the package index**

`packages/services/src/index.ts` — append:

```ts
export {
    WorkoutSessionsService,
    type PaginatedSessions,
    type SessionDetail,
    type SessionExercise,
    type SessionExerciseInput,
    type SessionExerciseTargets,
    type SessionSet,
    type SetInput,
    type SessionSummary,
} from './workout-sessions.service.js';
```

- [ ] **Step 5: Run the service tests**

Run: `pnpm --filter @app/services test -- workout-sessions`
Expected: PASS. If the "backed by the partial unique index" test fails on the constraint name, log the rejection's `cause` once: for a unique index violation Postgres reports the index name as `constraint`, and `ACTIVE_SESSION_INDEX` must match it exactly.

- [ ] **Step 6: Run the whole services suite, format, typecheck**

Run: `pnpm --filter @app/services test && pnpm format && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/services
git commit -m "feat(services): add WorkoutSessionsService"
```

---

### Task 5: `ExerciseHistoryService`

**Files:**

- Create: `packages/services/src/exercise-history.service.ts`
- Create: `packages/services/src/exercise-history.service.spec.ts`
- Modify: `packages/services/src/index.ts`

**Interfaces:**

- Consumes: `schema.sessionExercises`, `schema.setEntries`, `schema.workoutSessions`, `schema.exercises`; `SessionSet` from Task 4; `WorkspaceMembershipService`.
- Produces: `ExerciseHistoryService.recent({ userId, workspaceId, exerciseId, limit }): Promise<ExerciseHistory>`; types `ExerciseHistory`, `ExerciseHistoryEntry`.

- [ ] **Step 1: Write the failing tests**

`packages/services/src/exercise-history.service.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { type Db } from '@app/db';
import { startTestDatabase } from '@app/db/testing';
import { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExerciseHistoryService } from './exercise-history.service.js';
import { ExercisesService } from './exercises.service.js';
import { seedCatalogExercise, seedUser, seedWorkspace } from './testing.js';
import { WorkspaceMembershipService } from './workspace-membership.service.js';
import { WorkoutSessionsService } from './workout-sessions.service.js';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let db: Db;
let history: ExerciseHistoryService;
let sessions: WorkoutSessionsService;
let exercises: ExercisesService;

let userId: string;
let workspaceId: string;
let outsiderId: string;
let otherWorkspaceId: string;
let benchId: string;
let catalogSquatId: string;

beforeAll(async () => {
    database = await startTestDatabase();
    db = database.db;
    const membership = new WorkspaceMembershipService({ db });
    history = new ExerciseHistoryService({ db, membership });
    sessions = new WorkoutSessionsService({ db, membership });
    exercises = new ExercisesService({ db, membership });

    userId = await seedUser(db, 'Member');
    workspaceId = await seedWorkspace(db, userId);
    outsiderId = await seedUser(db, 'Outsider');
    otherWorkspaceId = await seedWorkspace(db, outsiderId);
    benchId = (await exercises.create({ userId, workspaceId, name: 'Bench', trackingType: TrackingType.WeightReps }))
        .id;
    catalogSquatId = await seedCatalogExercise(db, { slug: 'back-squat', name: 'Back Squat' });
});

afterAll(async () => {
    await database?.stop();
});

/** One completed session with `reps` logged against `exerciseId`, so history has something to find. */
async function completedSession({
    ownerId,
    ownerWorkspaceId,
    exerciseId,
    reps,
}: {
    ownerId: string;
    ownerWorkspaceId: string;
    exerciseId: string;
    reps: number[];
}): Promise<string> {
    const started = await sessions.start({
        userId: ownerId,
        workspaceId: ownerWorkspaceId,
        name: `Session ${reps.join('-')}`,
    });
    const added = await sessions.addExercise({
        userId: ownerId,
        workspaceId: ownerWorkspaceId,
        sessionId: started.id,
        exerciseId,
        targetSets: reps.length,
    });
    const sessionExerciseId = added.exercises[0]?.id as string;

    for (const count of reps) {
        await sessions.logSet({
            userId: ownerId,
            workspaceId: ownerWorkspaceId,
            sessionId: started.id,
            sessionExerciseId,
            reps: count,
            weightKg: 60,
        });
    }

    await sessions.complete({ userId: ownerId, workspaceId: ownerWorkspaceId, sessionId: started.id });

    return started.id;
}

describe('recent', () => {
    it('returns completed sessions containing the exercise, most recent first, each with its sets', async () => {
        const older = await completedSession({
            ownerId: userId,
            ownerWorkspaceId: workspaceId,
            exerciseId: benchId,
            reps: [8, 8],
        });
        const newer = await completedSession({
            ownerId: userId,
            ownerWorkspaceId: workspaceId,
            exerciseId: benchId,
            reps: [10],
        });

        const result = await history.recent({ userId, workspaceId, exerciseId: benchId, limit: 10 });

        expect(result.data.map((entry) => entry.sessionId)).toEqual([newer, older]);
        expect(result.data[0]).toMatchObject({
            sessionName: 'Session 10',
            trackingType: TrackingType.WeightReps,
            sets: [{ setIndex: 1, reps: 10, weightKg: 60 }],
        });
        expect(result.data[0]?.completedAt).toEqual(expect.any(String));
    });

    it('excludes the active session — that is the present, not history', async () => {
        const started = await sessions.start({ userId, workspaceId });
        const added = await sessions.addExercise({
            userId,
            workspaceId,
            sessionId: started.id,
            exerciseId: benchId,
            targetSets: 1,
        });
        await sessions.logSet({
            userId,
            workspaceId,
            sessionId: started.id,
            sessionExerciseId: added.exercises[0]?.id as string,
            reps: 5,
        });

        const result = await history.recent({ userId, workspaceId, exerciseId: benchId, limit: 10 });

        expect(result.data.map((entry) => entry.sessionId)).not.toContain(started.id);

        await sessions.abandon({ userId, workspaceId, sessionId: started.id });
    });

    it('honours the limit', async () => {
        const result = await history.recent({ userId, workspaceId, exerciseId: benchId, limit: 1 });

        expect(result.data).toHaveLength(1);
    });

    it('works for a catalog exercise, and is empty when it was never trained', async () => {
        const result = await history.recent({ userId, workspaceId, exerciseId: catalogSquatId, limit: 10 });

        expect(result.data).toEqual([]);
    });

    it('is a 404 for an exercise the workspace cannot see, and for a non-member', async () => {
        await expect(
            history.recent({ userId, workspaceId, exerciseId: randomUUID(), limit: 10 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            history.recent({ userId: outsiderId, workspaceId: otherWorkspaceId, exerciseId: benchId, limit: 10 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
        await expect(
            history.recent({ userId: outsiderId, workspaceId, exerciseId: benchId, limit: 10 }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it("never shows another workspace's sessions for a shared catalog exercise", async () => {
        await completedSession({
            ownerId: outsiderId,
            ownerWorkspaceId: otherWorkspaceId,
            exerciseId: catalogSquatId,
            reps: [5],
        });

        const mine = await history.recent({ userId, workspaceId, exerciseId: catalogSquatId, limit: 10 });
        const theirs = await history.recent({
            userId: outsiderId,
            workspaceId: otherWorkspaceId,
            exerciseId: catalogSquatId,
            limit: 10,
        });

        expect(mine.data).toEqual([]);
        expect(theirs.data).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @app/services test -- exercise-history`
Expected: FAIL — `Cannot find module './exercise-history.service.js'`.

- [ ] **Step 3: Write the service**

`packages/services/src/exercise-history.service.ts`:

```ts
import { schema, scopedToWorkspace, scopedToWorkspaceOrGlobal, type Db } from '@app/db';
import type { TrackingType } from '@app/domain';
import { EntityNotFoundError } from '@app/errors';
import { asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';
import type { SessionSet } from './workout-sessions.service.js';

const { exercises, sessionExercises, setEntries, workoutSessions } = schema;

/** One past appearance of an exercise: the session it was in and every set logged against it. */
export type ExerciseHistoryEntry = {
    sessionId: string;
    sessionName: string;
    startedAt: string;
    completedAt: string;
    sessionExerciseId: string;
    trackingType: TrackingType;
    sets: SessionSet[];
};

export type ExerciseHistory = { data: ExerciseHistoryEntry[] };

/**
 * What was logged against an exercise in past sessions — the last-time prefill today, progress
 * charts later. Reads completed sessions only: the active one is the present.
 */
export class ExerciseHistoryService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * The exercise's most recent appearances in completed sessions, newest first. A session where
     * the exercise appears twice yields two entries, in position order.
     *
     * @param limit how many appearances to return.
     * @throws EntityNotFoundError when the caller is not a member, or the exercise is not one the
     * workspace can see. Archived exercises are still visible here — their history is still real.
     */
    async recent({
        userId,
        workspaceId,
        exerciseId,
        limit,
    }: {
        userId: string;
        workspaceId: string;
        exerciseId: string;
        limit: number;
    }): Promise<ExerciseHistory> {
        await this.membership.require({ userId, workspaceId });

        const [exercise] = await this.db
            .select({ id: exercises.id })
            .from(exercises)
            .where(scopedToWorkspaceOrGlobal(exercises, workspaceId, eq(exercises.id, exerciseId)));

        if (!exercise) throw new EntityNotFoundError('Exercise not found');

        // The tenant filter sits on `session_exercises`, which is what makes a catalog exercise's
        // history per-workspace rather than shared.
        const appearances = await this.db
            .select({
                sessionId: workoutSessions.id,
                sessionName: workoutSessions.name,
                startedAt: workoutSessions.startedAt,
                completedAt: workoutSessions.completedAt,
                sessionExerciseId: sessionExercises.id,
                trackingType: sessionExercises.trackingType,
            })
            .from(sessionExercises)
            .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
            .where(
                scopedToWorkspace(
                    sessionExercises,
                    workspaceId,
                    eq(sessionExercises.exerciseId, exerciseId),
                    isNotNull(workoutSessions.completedAt),
                ),
            )
            .orderBy(desc(workoutSessions.startedAt), asc(sessionExercises.position))
            .limit(limit);

        if (appearances.length === 0) return { data: [] };

        const setRows = await this.db
            .select({
                id: setEntries.id,
                sessionExerciseId: setEntries.sessionExerciseId,
                setIndex: setEntries.setIndex,
                completedAt: setEntries.completedAt,
                isWarmup: setEntries.isWarmup,
                rpe: setEntries.rpe,
                weightKg: setEntries.weightKg,
                reps: setEntries.reps,
                durationSeconds: setEntries.durationSeconds,
                distanceM: setEntries.distanceM,
            })
            .from(setEntries)
            .where(
                scopedToWorkspace(
                    setEntries,
                    workspaceId,
                    inArray(
                        setEntries.sessionExerciseId,
                        appearances.map((row) => row.sessionExerciseId),
                    ),
                ),
            )
            .orderBy(asc(setEntries.setIndex));

        const setsByExercise = new Map<string, SessionSet[]>();

        for (const { sessionExerciseId, ...set } of setRows) {
            const sets = setsByExercise.get(sessionExerciseId) ?? [];
            sets.push(set);
            setsByExercise.set(sessionExerciseId, sets);
        }

        return {
            data: appearances.map((row) => ({
                ...row,
                // The `isNotNull` filter guarantees this; the column type does not know it.
                completedAt: row.completedAt as string,
                sets: setsByExercise.get(row.sessionExerciseId) ?? [],
            })),
        };
    }
}
```

- [ ] **Step 4: Export from the package index**

`packages/services/src/index.ts` — append:

```ts
export { ExerciseHistoryService, type ExerciseHistory, type ExerciseHistoryEntry } from './exercise-history.service.js';
```

- [ ] **Step 5: Run the tests, format, typecheck**

Run: `pnpm --filter @app/services test -- exercise-history && pnpm format && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/services
git commit -m "feat(services): add ExerciseHistoryService"
```

---

### Task 6: API — session routes and exercise history

**Files:**

- Create: `apps/api/src/sessions/sessions.providers.ts`
- Create: `apps/api/src/sessions/sessions.controller.ts`
- Create: `apps/api/src/sessions/session-editing.controller.ts`
- Create: `apps/api/src/sessions/sessions.module.ts`
- Create: `apps/api/src/exercises/exercise-history.controller.ts`
- Modify: `apps/api/src/exercises/exercises.providers.ts`
- Modify: `apps/api/src/exercises/exercises.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/route-guard-coverage.e2e.spec.ts` (`MCP_TOKEN_ROUTES` only)
- Create: `apps/api/test/sessions.e2e.spec.ts`

**Interfaces:**

- Consumes: `WorkoutSessionsService`, `ExerciseHistoryService` (Tasks 4–5); contract schemas and paths (Task 3); `DB`, `WORKSPACE_MEMBERSHIP_SERVICE`, `RESOURCE_URL_GENERATOR` from `apps/api/src/providers.ts`.
- Produces: routes under `/api/v1/workspaces/:workspaceId/sessions` (below) and `GET /api/v1/workspaces/:workspaceId/exercises/:exerciseId/history`. PAT-reachable (`SessionOrMcpPatGuard`): `GET sessions`, `GET sessions/active`, `GET sessions/:sessionId`, `POST sessions`, `POST sessions/:sessionId/complete`, `POST sessions/:sessionId/exercises/:sessionExerciseId/sets`. Session-only (`SessionAuthGuard`): `DELETE sessions/:sessionId`, `POST sessions/:sessionId/exercises`, `PATCH sessions/:sessionId/exercises/:sessionExerciseId`, `PUT sessions/:sessionId/exercises/order`, `PATCH .../sets/:setId`, `DELETE .../sets/:setId`, and the history route.

- [ ] **Step 1: Providers**

`apps/api/src/sessions/sessions.providers.ts`:

```ts
import { type Db } from '@app/db';
import { WorkoutSessionsService, type WorkspaceMembershipService } from '@app/services';
import type { Provider } from '@nestjs/common';
import { DB, WORKSPACE_MEMBERSHIP_SERVICE } from '../providers.js';

/** DI token for the `WorkoutSessionsService` factory provider below. */
export const WORKOUT_SESSIONS_SERVICE = Symbol('WORKOUT_SESSIONS_SERVICE');

/** Split out from `sessions.module.ts` to avoid a circular import between that module and its controllers. */
export const sessionServiceProviders: Provider[] = [
    {
        provide: WORKOUT_SESSIONS_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): WorkoutSessionsService =>
            new WorkoutSessionsService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
];
```

- [ ] **Step 2: The PAT-reachable controller**

`apps/api/src/sessions/sessions.controller.ts`:

```ts
import {
    completeSessionRequestSchema,
    guidSchema,
    postSessionRequestSchema,
    postSetRequestSchema,
    sessionListQuerySchema,
    sessionWebPath,
    type ActiveSessionResponse,
    type CompleteSessionRequest,
    type PostSessionRequest,
    type PostSetRequest,
    type SessionDetailResponse,
    type SessionListQuery,
    type SessionListResponse,
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
import type { WorkoutSessionsService } from '@app/services';
import { Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { WORKOUT_SESSIONS_SERVICE } from './sessions.providers.js';

/**
 * Workout sessions. Every route here is one an MCP tool calls — read, start, log a set, complete —
 * so the class-level guard admits a personal access token; the session-only editing routes live in
 * `SessionEditingController`.
 */
@Controller('v1/workspaces/:workspaceId/sessions')
@UseGuards(SessionOrMcpPatGuard)
export class SessionsController {
    constructor(
        @Inject(WORKOUT_SESSIONS_SERVICE) private readonly sessions: WorkoutSessionsService,
        @Inject(RESOURCE_URL_GENERATOR) private readonly urls: ResourceUrlGenerator,
    ) {}

    /** A page of the workspace's sessions, newest started first, the active one included. */
    @Get()
    async listSessions(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedQuery(sessionListQuerySchema) query: SessionListQuery,
    ): Promise<SessionListResponse> {
        return this.sessions.list({
            userId: currentUser.userId,
            workspaceId,
            page: query.page,
            pageSize: query.pageSize,
        });
    }

    /** The live session, or `{ session: null }` — declared before `:sessionId` so the static segment wins. */
    @Get('active')
    async getActiveSession(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
    ): Promise<ActiveSessionResponse> {
        return { session: await this.sessions.getActive({ userId: currentUser.userId, workspaceId }) };
    }

    /** One session with its exercises, sets and state, plus the link to its page in the web app. */
    @Get(':sessionId')
    async getSession(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
    ): Promise<SessionDetailResponse & { webUrl: string }> {
        const session = await this.sessions.get({ userId: currentUser.userId, workspaceId, sessionId });

        return { ...session, webUrl: this.urls.webAppUrl({ path: sessionWebPath({ workspaceId, sessionId }) }) };
    }

    /** Starts a session from a routine, or a blank one. 409 when one is already live. */
    @Post()
    @HttpCode(200)
    async startSession(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedBody(postSessionRequestSchema) body: PostSessionRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.start({ userId: currentUser.userId, workspaceId, ...body });
    }

    /** Marks the session finished, optionally with notes. */
    @Post(':sessionId/complete')
    @HttpCode(200)
    async completeSession(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedBody(completeSessionRequestSchema) body: CompleteSessionRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.complete({ userId: currentUser.userId, workspaceId, sessionId, ...body });
    }

    /** Logs the next set against a session exercise. Returns the whole session. */
    @Post(':sessionId/exercises/:sessionExerciseId/sets')
    @HttpCode(200)
    async logSet(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedParam({ name: 'sessionExerciseId', schema: guidSchema }) sessionExerciseId: string,
        @ValidatedBody(postSetRequestSchema) body: PostSetRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.logSet({ userId: currentUser.userId, workspaceId, sessionId, sessionExerciseId, ...body });
    }
}
```

- [ ] **Step 3: The session-only editing controller**

`apps/api/src/sessions/session-editing.controller.ts`:

```ts
import {
    guidSchema,
    patchSessionExerciseRequestSchema,
    patchSetRequestSchema,
    postSessionExerciseRequestSchema,
    putSessionExerciseOrderRequestSchema,
    type PatchSessionExerciseRequest,
    type PatchSetRequest,
    type PostSessionExerciseRequest,
    type PutSessionExerciseOrderRequest,
    type SessionDetailResponse,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { WorkoutSessionsService } from '@app/services';
import { Controller, Delete, HttpCode, Inject, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { WORKOUT_SESSIONS_SERVICE } from './sessions.providers.js';

/**
 * Mid-workout edits — abandon, add, skip, reorder, correct a set. Session-only: no MCP tool needs
 * these, so a token is not admitted here.
 */
@Controller('v1/workspaces/:workspaceId/sessions/:sessionId')
@UseGuards(SessionAuthGuard)
export class SessionEditingController {
    constructor(@Inject(WORKOUT_SESSIONS_SERVICE) private readonly sessions: WorkoutSessionsService) {}

    /** Abandons the session: deletes it and everything logged against it. */
    @Delete()
    @HttpCode(204)
    async abandonSession(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
    ): Promise<void> {
        await this.sessions.abandon({ userId: currentUser.userId, workspaceId, sessionId });
    }

    /** Appends an ad-hoc exercise to the end of the session. Returns the whole session. */
    @Post('exercises')
    @HttpCode(200)
    async addExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedBody(postSessionExerciseRequestSchema) body: PostSessionExerciseRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.addExercise({ userId: currentUser.userId, workspaceId, sessionId, ...body });
    }

    /** Rewrites the exercise order — declared before `:sessionExerciseId` so the static segment wins. */
    @Put('exercises/order')
    async putExerciseOrder(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedBody(putSessionExerciseOrderRequestSchema) body: PutSessionExerciseOrderRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.reorderExercises({
            userId: currentUser.userId,
            workspaceId,
            sessionId,
            sessionExerciseIds: body.sessionExerciseIds,
        });
    }

    /** Skips or unskips an exercise, and/or edits its targets. Returns the whole session. */
    @Patch('exercises/:sessionExerciseId')
    async patchExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedParam({ name: 'sessionExerciseId', schema: guidSchema }) sessionExerciseId: string,
        @ValidatedBody(patchSessionExerciseRequestSchema) body: PatchSessionExerciseRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.updateExercise({
            userId: currentUser.userId,
            workspaceId,
            sessionId,
            sessionExerciseId,
            ...body,
        });
    }

    /** Corrects a logged set. An omitted key leaves the stored value alone. Returns the whole session. */
    @Patch('exercises/:sessionExerciseId/sets/:setId')
    async patchSet(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedParam({ name: 'sessionExerciseId', schema: guidSchema }) sessionExerciseId: string,
        @ValidatedParam({ name: 'setId', schema: guidSchema }) setId: string,
        @ValidatedBody(patchSetRequestSchema) body: PatchSetRequest,
    ): Promise<SessionDetailResponse> {
        return this.sessions.updateSet({
            userId: currentUser.userId,
            workspaceId,
            sessionId,
            sessionExerciseId,
            setId,
            ...body,
        });
    }

    /** Removes a set and closes the gap. Returns the whole session. */
    @Delete('exercises/:sessionExerciseId/sets/:setId')
    async deleteSet(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'sessionId', schema: guidSchema }) sessionId: string,
        @ValidatedParam({ name: 'sessionExerciseId', schema: guidSchema }) sessionExerciseId: string,
        @ValidatedParam({ name: 'setId', schema: guidSchema }) setId: string,
    ): Promise<SessionDetailResponse> {
        return this.sessions.deleteSet({
            userId: currentUser.userId,
            workspaceId,
            sessionId,
            sessionExerciseId,
            setId,
        });
    }
}
```

- [ ] **Step 4: The module, wired into `AppModule`**

`apps/api/src/sessions/sessions.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SessionEditingController } from './session-editing.controller.js';
import { SessionsController } from './sessions.controller.js';
import { sessionServiceProviders } from './sessions.providers.js';

/** Wires the workspace-scoped `/api/v1/workspaces/:workspaceId/sessions` routes. */
@Module({
    controllers: [SessionsController, SessionEditingController],
    providers: [...sessionServiceProviders],
})
export class SessionsModule {}
```

`apps/api/src/app.module.ts` — add `import { SessionsModule } from './sessions/sessions.module.js';` (alphabetically after `RoutinesModule`'s import) and `SessionsModule,` after `RoutinesModule,` in `imports`.

- [ ] **Step 5: Exercise history route**

`apps/api/src/exercises/exercises.providers.ts` — add the import `ExerciseHistoryService` to the `@app/services` import, a token, and a provider:

```ts
/** DI token for the `ExerciseHistoryService` factory provider below. */
export const EXERCISE_HISTORY_SERVICE = Symbol('EXERCISE_HISTORY_SERVICE');
```

and inside `exerciseServiceProviders`:

```ts
    {
        provide: EXERCISE_HISTORY_SERVICE,
        useFactory: (db: Db, membership: WorkspaceMembershipService): ExerciseHistoryService =>
            new ExerciseHistoryService({ db, membership }),
        inject: [DB, WORKSPACE_MEMBERSHIP_SERVICE],
    },
```

`apps/api/src/exercises/exercise-history.controller.ts`:

```ts
import {
    exerciseHistoryQuerySchema,
    guidSchema,
    type ExerciseHistoryQuery,
    type ExerciseHistoryResponse,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedParam,
    ValidatedQuery,
    type CurrentUserContext,
} from '@app/nest-common';
import type { ExerciseHistoryService } from '@app/services';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { EXERCISE_HISTORY_SERVICE } from './exercises.providers.js';

/** What was logged against an exercise in past sessions. Session-only: no MCP tool reads it. */
@Controller('v1/workspaces/:workspaceId/exercises/:exerciseId/history')
@UseGuards(SessionAuthGuard)
export class ExerciseHistoryController {
    constructor(@Inject(EXERCISE_HISTORY_SERVICE) private readonly history: ExerciseHistoryService) {}

    /** The exercise's most recent appearances in completed sessions, newest first, each with its sets. */
    @Get()
    async getHistory(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'exerciseId', schema: guidSchema }) exerciseId: string,
        @ValidatedQuery(exerciseHistoryQuerySchema) query: ExerciseHistoryQuery,
    ): Promise<ExerciseHistoryResponse> {
        return this.history.recent({ userId: currentUser.userId, workspaceId, exerciseId, limit: query.limit });
    }
}
```

`apps/api/src/exercises/exercises.module.ts` — import `ExerciseHistoryController` and add it to `controllers`.

- [ ] **Step 6: Grow the MCP allowlist — these six routes and nothing else**

`apps/api/test/route-guard-coverage.e2e.spec.ts` — append to `MCP_TOKEN_ROUTES`:

```ts
    // ListSessions
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/sessions' },
    // GetActiveSession
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/sessions/active' },
    // GetSession
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/sessions/:sessionId' },
    // StartSession
    { method: 'POST', path: '/api/v1/workspaces/:workspaceId/sessions' },
    // CompleteSession
    { method: 'POST', path: '/api/v1/workspaces/:workspaceId/sessions/:sessionId/complete' },
    // LogSet. Abandon, add/skip/reorder exercises, and set corrections are session-only
    // (session-editing.controller.ts): no tool edits a session beyond logging and completing.
    { method: 'POST', path: '/api/v1/workspaces/:workspaceId/sessions/:sessionId/exercises/:sessionExerciseId/sets' },
```

- [ ] **Step 7: Write the e2e spec**

`apps/api/test/sessions.e2e.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, TEST_WEB_APP_BASE_URL, type TestApp } from './harness.js';

let app: TestApp;

type Session = {
    id: string;
    name: string;
    completedAt: string | null;
    exercises: {
        id: string;
        position: number;
        skippedAt: string | null;
        exercise: { name: string };
        sets: { id: string; setIndex: number; reps: number | null }[];
    }[];
    state: { currentSessionExerciseId: string | null; nextSetIndex: number | null; canComplete: boolean };
};

async function signUpUser(): Promise<{ cookie: string; workspaceId: string }> {
    const email = `sessions-${randomUUID()}@example.com`;
    const password = 'a-real-password-123';

    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password } });

    const cookie = await signIn(app, { email, password });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const body = JSON.parse(me.body) as { workspaces: { workspaceId: string }[] };

    return { cookie, workspaceId: body.workspaces[0]?.workspaceId as string };
}

async function createExercise({
    cookie,
    workspaceId,
    name,
    trackingType = 'weight_reps',
}: {
    cookie: string;
    workspaceId: string;
    name: string;
    trackingType?: string;
}): Promise<string> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/exercises`,
        headers: { cookie },
        payload: { name, trackingType },
    });

    return (JSON.parse(response.body) as { id: string }).id;
}

/** A routine with Bench (3×8) and Plank (1×60s), so a started session has something to log against. */
async function createRoutine({ cookie, workspaceId }: { cookie: string; workspaceId: string }): Promise<string> {
    const benchId = await createExercise({ cookie, workspaceId, name: 'Bench' });
    const plankId = await createExercise({ cookie, workspaceId, name: 'Plank', trackingType: 'duration' });
    const created = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/routines`,
        headers: { cookie },
        payload: { name: 'Push Day' },
    });
    const routineId = (JSON.parse(created.body) as { id: string }).id;

    await app.inject({
        method: 'PUT',
        url: `/api/v1/workspaces/${workspaceId}/routines/${routineId}/exercises`,
        headers: { cookie },
        payload: {
            exercises: [
                { exerciseId: benchId, targetSets: 3, targetReps: 8, targetWeightKg: 60, restSeconds: 90 },
                { exerciseId: plankId, targetSets: 1, targetDurationSeconds: 60 },
            ],
        },
    });

    return routineId;
}

async function startSession({
    cookie,
    workspaceId,
    routineId,
}: {
    cookie: string;
    workspaceId: string;
    routineId?: string;
}): Promise<Session> {
    const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/sessions`,
        headers: { cookie },
        payload: routineId === undefined ? {} : { routineId },
    });

    expect(response.statusCode).toBe(200);

    return JSON.parse(response.body) as Session;
}

function slot(session: Session, name: string): Session['exercises'][number] {
    return session.exercises.find((exercise) => exercise.exercise.name === name) as Session['exercises'][number];
}

beforeAll(async () => {
    app = await createTestApp();
});

afterAll(async () => {
    await app?.close();
});

describe('session routes', () => {
    it('returns 401 when signed out', async () => {
        const response = await app.inject({ method: 'GET', url: `/api/v1/workspaces/${randomUUID()}/sessions` });

        expect(response.statusCode).toBe(401);
    });

    it('runs a whole workout: start, log, skip, add, reorder, complete, and reads history', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const routineId = await createRoutine({ cookie, workspaceId });
        const base = `/api/v1/workspaces/${workspaceId}/sessions`;

        const started = await startSession({ cookie, workspaceId, routineId });
        expect(started).toMatchObject({
            name: 'Push Day',
            completedAt: null,
            state: { nextSetIndex: 1, canComplete: false },
        });
        expect(started.exercises.map((exercise) => exercise.exercise.name)).toEqual(['Bench', 'Plank']);

        const active = await app.inject({ method: 'GET', url: `${base}/active`, headers: { cookie } });
        expect(active.statusCode).toBe(200);
        expect((JSON.parse(active.body) as { session: Session }).session.id).toBe(started.id);

        const fetched = await app.inject({ method: 'GET', url: `${base}/${started.id}`, headers: { cookie } });
        expect(JSON.parse(fetched.body)).toMatchObject({
            id: started.id,
            webUrl: `${TEST_WEB_APP_BASE_URL}/workspaces/${workspaceId}/sessions/${started.id}`,
        });

        const bench = slot(started, 'Bench');
        let session = started;
        for (const reps of [8, 8, 8]) {
            const logged = await app.inject({
                method: 'POST',
                url: `${base}/${started.id}/exercises/${bench.id}/sets`,
                headers: { cookie },
                payload: { weightKg: 60, reps },
            });
            expect(logged.statusCode).toBe(200);
            session = JSON.parse(logged.body) as Session;
        }
        expect(slot(session, 'Bench').sets.map((set) => set.setIndex)).toEqual([1, 2, 3]);
        expect(session.state).toMatchObject({ currentSessionExerciseId: slot(session, 'Plank').id, canComplete: true });

        const skipped = await app.inject({
            method: 'PATCH',
            url: `${base}/${started.id}/exercises/${slot(session, 'Plank').id}`,
            headers: { cookie },
            payload: { skipped: true },
        });
        expect(skipped.statusCode).toBe(200);
        expect(slot(JSON.parse(skipped.body) as Session, 'Plank').skippedAt).not.toBeNull();

        const runId = await createExercise({ cookie, workspaceId, name: 'Run', trackingType: 'distance_time' });
        const added = await app.inject({
            method: 'POST',
            url: `${base}/${started.id}/exercises`,
            headers: { cookie },
            payload: { exerciseId: runId, targetSets: 1, targetDistanceM: 1000 },
        });
        expect(added.statusCode).toBe(200);
        session = JSON.parse(added.body) as Session;
        expect(slot(session, 'Run').position).toBe(2);

        const reordered = await app.inject({
            method: 'PUT',
            url: `${base}/${started.id}/exercises/order`,
            headers: { cookie },
            payload: {
                sessionExerciseIds: [slot(session, 'Run').id, slot(session, 'Bench').id, slot(session, 'Plank').id],
            },
        });
        expect(reordered.statusCode).toBe(200);
        session = JSON.parse(reordered.body) as Session;
        expect(session.exercises.map((exercise) => exercise.exercise.name)).toEqual(['Run', 'Bench', 'Plank']);

        const secondSet = slot(session, 'Bench').sets[1] as { id: string };
        const edited = await app.inject({
            method: 'PATCH',
            url: `${base}/${started.id}/exercises/${slot(session, 'Bench').id}/sets/${secondSet.id}`,
            headers: { cookie },
            payload: { reps: 9 },
        });
        expect(edited.statusCode).toBe(200);
        expect(slot(JSON.parse(edited.body) as Session, 'Bench').sets[1]?.reps).toBe(9);

        const deleted = await app.inject({
            method: 'DELETE',
            url: `${base}/${started.id}/exercises/${slot(session, 'Bench').id}/sets/${secondSet.id}`,
            headers: { cookie },
        });
        expect(deleted.statusCode).toBe(200);
        expect(slot(JSON.parse(deleted.body) as Session, 'Bench').sets.map((set) => set.setIndex)).toEqual([1, 2]);

        const completed = await app.inject({
            method: 'POST',
            url: `${base}/${started.id}/complete`,
            headers: { cookie },
            payload: { notes: 'Solid' },
        });
        expect(completed.statusCode).toBe(200);
        expect(JSON.parse(completed.body)).toMatchObject({ notes: 'Solid', state: { canComplete: false } });
        expect((JSON.parse(completed.body) as Session).completedAt).not.toBeNull();

        const noneActive = await app.inject({ method: 'GET', url: `${base}/active`, headers: { cookie } });
        expect(JSON.parse(noneActive.body)).toEqual({ session: null });

        const listed = await app.inject({ method: 'GET', url: base, headers: { cookie } });
        expect((JSON.parse(listed.body) as { data: { id: string; setCount: number }[] }).data).toMatchObject([
            { id: started.id, setCount: 2 },
        ]);

        const benchExerciseId = (
            JSON.parse(
                (
                    await app.inject({
                        method: 'GET',
                        url: `/api/v1/workspaces/${workspaceId}/exercises?search=Bench`,
                        headers: { cookie },
                    })
                ).body,
            ) as { data: { id: string }[] }
        ).data[0]?.id as string;
        const history = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/exercises/${benchExerciseId}/history?limit=5`,
            headers: { cookie },
        });
        expect(history.statusCode).toBe(200);
        expect(JSON.parse(history.body)).toMatchObject({
            data: [{ sessionId: started.id, sessionName: 'Push Day', sets: [{ setIndex: 1 }, { setIndex: 2 }] }],
        });
    });

    it('starts a blank session from an empty POST and abandons it with a 204', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const started = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/sessions`,
            headers: { cookie },
        });
        expect(started.statusCode).toBe(200);
        const session = JSON.parse(started.body) as Session;
        expect(session).toMatchObject({ name: 'Workout', exercises: [] });

        const abandoned = await app.inject({
            method: 'DELETE',
            url: `/api/v1/workspaces/${workspaceId}/sessions/${session.id}`,
            headers: { cookie },
        });
        expect(abandoned.statusCode).toBe(204);

        const gone = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/sessions/${session.id}`,
            headers: { cookie },
        });
        expect(gone.statusCode).toBe(404);
    });

    it('returns a 409 ActiveSessionExistsError problem for a second start', async () => {
        const { cookie, workspaceId } = await signUpUser();
        await startSession({ cookie, workspaceId });

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/sessions`,
            headers: { cookie },
            payload: {},
        });

        expect(response.statusCode).toBe(409);
        expect((JSON.parse(response.body) as { type: string }).type).toMatch(/ActiveSessionExistsError$/);
    });

    it('returns a 400 SetShapeMismatchError problem for a set that does not fit', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const routineId = await createRoutine({ cookie, workspaceId });
        const started = await startSession({ cookie, workspaceId, routineId });

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/sessions/${started.id}/exercises/${slot(started, 'Plank').id}/sets`,
            headers: { cookie },
            payload: { reps: 10 },
        });

        expect(response.statusCode).toBe(400);
        expect((JSON.parse(response.body) as { type: string }).type).toMatch(/SetShapeMismatchError$/);
    });

    it('returns a 400 InvalidOperationError problem when completing an empty session', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const started = await startSession({ cookie, workspaceId });

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/workspaces/${workspaceId}/sessions/${started.id}/complete`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(400);
        expect((JSON.parse(response.body) as { type: string }).type).toMatch(/InvalidOperationError$/);
    });

    it('returns 404, not 400, for a malformed session id', async () => {
        const { cookie, workspaceId } = await signUpUser();

        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${workspaceId}/sessions/not-a-uuid`,
            headers: { cookie },
        });

        expect(response.statusCode).toBe(404);
    });

    it("returns 404 for another workspace's session, on read and on every write", async () => {
        const owner = await signUpUser();
        const outsider = await signUpUser();
        const routineId = await createRoutine(owner);
        const started = await startSession({ ...owner, routineId });
        const bench = slot(started, 'Bench');
        const exerciseId = await createExercise({ ...outsider, name: 'Theirs' });
        const base = `/api/v1/workspaces/${outsider.workspaceId}/sessions/${started.id}`;
        const headers = { cookie: outsider.cookie };

        const attempts = [
            app.inject({ method: 'GET', url: base, headers }),
            app.inject({ method: 'POST', url: `${base}/complete`, headers, payload: {} }),
            app.inject({ method: 'DELETE', url: base, headers }),
            app.inject({ method: 'POST', url: `${base}/exercises`, headers, payload: { exerciseId } }),
            app.inject({ method: 'PATCH', url: `${base}/exercises/${bench.id}`, headers, payload: { skipped: true } }),
            app.inject({
                method: 'PUT',
                url: `${base}/exercises/order`,
                headers,
                payload: { sessionExerciseIds: [bench.id] },
            }),
            app.inject({ method: 'POST', url: `${base}/exercises/${bench.id}/sets`, headers, payload: { reps: 8 } }),
            app.inject({
                method: 'PATCH',
                url: `${base}/exercises/${bench.id}/sets/${randomUUID()}`,
                headers,
                payload: { reps: 8 },
            }),
            app.inject({ method: 'DELETE', url: `${base}/exercises/${bench.id}/sets/${randomUUID()}`, headers }),
        ];

        for (const response of await Promise.all(attempts)) {
            expect(response.statusCode).toBe(404);
        }

        // The outsider sees nothing active in their own workspace either.
        const active = await app.inject({
            method: 'GET',
            url: `/api/v1/workspaces/${outsider.workspaceId}/sessions/active`,
            headers,
        });
        expect(JSON.parse(active.body)).toEqual({ session: null });
    });

    it('rejects a body that fails the contract with a 400', async () => {
        const { cookie, workspaceId } = await signUpUser();
        const routineId = await createRoutine({ cookie, workspaceId });
        const started = await startSession({ cookie, workspaceId, routineId });

        const response = await app.inject({
            method: 'PATCH',
            url: `/api/v1/workspaces/${workspaceId}/sessions/${started.id}/exercises/${slot(started, 'Bench').id}`,
            headers: { cookie },
            payload: {},
        });

        expect(response.statusCode).toBe(400);
    });
});
```

- [ ] **Step 8: Run the API suites**

Run: `pnpm --filter @app/api test`
Expected: PASS — including `route-guard-coverage.e2e.spec.ts` (which now sees the twelve new routes: six on the allowlist with exactly `SessionOrMcpPatGuard`, six plus the history route with `SessionAuthGuard`).

- [ ] **Step 9: Format, typecheck, commit**

Run: `pnpm format && pnpm typecheck`
Expected: no errors.

```bash
git add apps/api
git commit -m "feat(api): add session routes and exercise history"
```

---

### Task 7: MCP — workout session tools

**Files:**

- Create: `apps/mcp/src/mcp/tools/workout-session-links.ts`
- Create: `apps/mcp/src/mcp/tools/workout-session.tools.ts`
- Modify: `apps/mcp/src/mcp/tool-registry.ts` (`BEHAVIOR_HINTS`)
- Modify: `apps/mcp/src/mcp/mcp.providers.ts`
- Modify: `apps/mcp/src/mcp/mcp-server.ts` (`buildServerInstructions`)
- Modify: `apps/mcp/test/tool-surface.e2e.spec.ts` (`EXPECTED_TOOL_NAMES`)
- Modify: `apps/mcp/test/mcp-tools.e2e.spec.ts`

**Interfaces:**

- Consumes: the six PAT-reachable routes from Task 6; `listSessionsToolArgsSchema`, `getActiveSessionToolArgsSchema`, `getSessionToolArgsSchema`, `startSessionToolArgsSchema`, `logSetToolArgsSchema`, `completeSessionToolArgsSchema`, `SessionDetailResponse`, `SessionListResponse`, `ActiveSessionResponse`, `sessionWebPath`, `sessionApiPath` (Task 3); `defineTool`, `runToolCaught`, `serializeToolResult`, `ApiClient`, `ResourceUrlGenerator`.
- Produces: tools `list_sessions`, `get_active_session`, `get_session`, `start_session`, `log_set`, `complete_session`. The file is named `workout-session.tools.ts` because `session.tools.ts` already holds the auth-session tools (`get_current_user`, `list_workspaces`).

- [ ] **Step 1: Links**

`apps/mcp/src/mcp/tools/workout-session-links.ts`:

```ts
import { sessionApiPath, sessionWebPath } from '@app/api-contract';
import type { ResourceUrlGenerator, WithResourceUrls } from '@app/nest-common';

/**
 * Attaches a session's two links to a tool result, from the same path definitions `apps/api` uses,
 * so a session reached through a tool carries the identical urls to one reached over REST.
 */
export function attachWorkoutSessionLinks<T extends { id: string }>({
    urls,
    session,
    workspaceId,
}: {
    urls: ResourceUrlGenerator;
    session: T;
    workspaceId: string;
}): WithResourceUrls<T> {
    return urls.attach({
        resource: session,
        webPath: sessionWebPath({ workspaceId, sessionId: session.id }),
        apiPath: sessionApiPath({ workspaceId, sessionId: session.id }),
    });
}
```

- [ ] **Step 2: Tools**

`apps/mcp/src/mcp/tools/workout-session.tools.ts`:

```ts
import {
    completeSessionToolArgsSchema,
    getActiveSessionToolArgsSchema,
    getSessionToolArgsSchema,
    listSessionsToolArgsSchema,
    logSetToolArgsSchema,
    paginationQuerySchema,
    startSessionToolArgsSchema,
    type ActiveSessionResponse,
    type SessionDetailResponse,
    type SessionListResponse,
} from '@app/api-contract';
import type { ApiClient } from '@app/api-client';
import type { Logger } from '@app/logger';
import type { McpContext, ResourceUrlGenerator } from '@app/nest-common';
import { defineTool, type McpToolDefinition } from '../tool-definition.js';
import { runToolCaught, serializeToolResult } from '../tool-execution.js';
import { attachWorkoutSessionLinks } from './workout-session-links.js';

const SET_HELP =
    "Measurements must fit the session exercise's trackingType — weight_reps: reps (required) and weightKg; " +
    'duration: durationSeconds; distance_time: distanceM and durationSeconds. Units are kilograms, metres, ' +
    'and seconds. isWarmup marks a set that does not count toward the target; rpe is 0–10.';

/**
 * Workout sessions, over the same `SessionDetailResponse` wire shape `apps/api` serves. Every
 * response carries `state`: the exercise to do next (currentSessionExerciseId), the next set
 * number, progress, and whether the session can be completed.
 *
 * No tool here takes a `workspaceId`; it comes from the personal access token, same as every other
 * tool in this app - see `item.tools.ts`'s doc comment for why.
 */
export function buildWorkoutSessionTools({
    context,
    client,
    logger,
    urls,
}: {
    context: McpContext;
    client: ApiClient;
    logger: Logger;
    urls: ResourceUrlGenerator;
}): McpToolDefinition[] {
    const basePath = `/workspaces/${context.workspaceId}/sessions`;

    const withLinks = <T extends { id: string }>(session: T): T & { webUrl: string; resourceUrl: string } =>
        attachWorkoutSessionLinks({ urls, session, workspaceId: context.workspaceId });

    return [
        defineTool({
            methodName: 'ListSessions',
            description:
                "Lists the token's workspace workout sessions, newest started first, with paging. Each entry " +
                'carries exerciseCount, setCount, completedAt (null while still in progress) and webUrl. Use ' +
                'get_session for the exercises and sets of one session.',
            inputSchema: listSessionsToolArgsSchema,
            handler: async (args) => {
                const pagination = paginationQuerySchema.parse({
                    page: args.page ?? undefined,
                    pageSize: args.pageSize ?? undefined,
                });

                const page = await client.get<SessionListResponse>({
                    path: basePath,
                    query: { page: pagination.page, pageSize: pagination.pageSize },
                });

                return serializeToolResult({ body: { ...page, data: page.data.map(withLinks) } });
            },
        }),
        defineTool({
            methodName: 'GetActiveSession',
            description:
                'Gets the session currently in progress, if any: its ordered exercises (each with a ' +
                'sessionExerciseId for log_set, targets, and logged sets) and state. Returns active false when ' +
                'nothing is in progress — start_session then.',
            inputSchema: getActiveSessionToolArgsSchema,
            handler: async () => {
                const { session } = await client.get<ActiveSessionResponse>({ path: `${basePath}/active` });

                return serializeToolResult({
                    body: session === null ? { active: false } : { active: true, session: withLinks(session) },
                });
            },
        }),
        defineTool({
            methodName: 'GetSession',
            description:
                'Gets a session by id: name, startedAt, completedAt, notes, its ordered exercises with their ' +
                'targets and logged sets, and state. Includes webUrl.',
            inputSchema: getSessionToolArgsSchema,
            handler: async (args) => {
                const session = await client.get<SessionDetailResponse>({ path: `${basePath}/${args.sessionId}` });

                return serializeToolResult({ body: withLinks(session) });
            },
        }),
        defineTool({
            methodName: 'StartSession',
            description:
                'Starts a workout session from a routine (routineId — use list_routines to find one) or a blank ' +
                'one when routineId is omitted; name overrides the routine name. The routine is copied into the ' +
                'session, so later edits to the routine do not affect it. Returns the session with a ' +
                'sessionExerciseId per exercise, for log_set. Only one session may be active at a time: a 409 ' +
                'means one is already in progress — use get_active_session and continue it, or complete_session.',
            inputSchema: startSessionToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'start_session',
                    logger,
                    action: async () => {
                        const session = await client.post<SessionDetailResponse>({
                            path: basePath,
                            body: {
                                ...(args.routineId === undefined || args.routineId === null
                                    ? {}
                                    : { routineId: args.routineId }),
                                ...(args.name === undefined || args.name === null ? {} : { name: args.name }),
                            },
                        });

                        return serializeToolResult({ body: withLinks(session) });
                    },
                }),
        }),
        defineTool({
            methodName: 'LogSet',
            description:
                'Logs the next set against one exercise in an active session (sessionId plus the ' +
                'sessionExerciseId from the session response). ' +
                SET_HELP +
                ' Returns the whole session; state.currentSessionExerciseId and state.nextSetIndex say what ' +
                'comes next. A set that does not fit the tracking type is rejected with a problem body.',
            inputSchema: logSetToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'log_set',
                    logger,
                    action: async () => {
                        const { sessionId, sessionExerciseId, ...rest } = args;
                        const session = await client.post<SessionDetailResponse>({
                            path: `${basePath}/${sessionId}/exercises/${sessionExerciseId}/sets`,
                            body: dropNullish(rest),
                        });

                        return serializeToolResult({ body: withLinks(session) });
                    },
                }),
        }),
        defineTool({
            methodName: 'CompleteSession',
            description:
                'Marks a session finished, optionally with notes. A session with no working set cannot be ' +
                'completed. Returns the completed session.',
            inputSchema: completeSessionToolArgsSchema,
            handler: async (args) =>
                runToolCaught({
                    toolName: 'complete_session',
                    logger,
                    action: async () => {
                        const session = await client.post<SessionDetailResponse>({
                            path: `${basePath}/${args.sessionId}/complete`,
                            body: args.notes === undefined || args.notes === null ? {} : { notes: args.notes },
                        });

                        return serializeToolResult({ body: withLinks(session) });
                    },
                }),
        }),
    ];
}

/** Drops nullish keys so the API's own defaults (isWarmup false) apply, rather than sending nulls. */
function dropNullish(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}
```

- [ ] **Step 3: Behaviour hints**

`apps/mcp/src/mcp/tool-registry.ts` — append to `BEHAVIOR_HINTS`:

```ts
    ListSessions: READ,
    GetActiveSession: READ,
    GetSession: READ,
    StartSession: CREATE,
    LogSet: CREATE,
    CompleteSession: MUTATE,
```

- [ ] **Step 4: Register the tools and describe them in the server instructions**

`apps/mcp/src/mcp/mcp.providers.ts` — add `import { buildWorkoutSessionTools } from './tools/workout-session.tools.js';` and append `...buildWorkoutSessionTools({ context, client, logger, urls }),` after the routine tools in the returned array.

`apps/mcp/src/mcp/mcp-server.ts` — replace the body of `buildServerInstructions` with:

```ts
return (
    'Workout tracker assistant. Use these tools to read and manage the exercise library, routines ' +
    '(workout templates), and workout sessions in a workspace. A session is started from a routine, sets ' +
    'are logged against its exercises with log_set, and it is finished with complete_session; only one ' +
    'session is active at a time, so check get_active_session before starting one. ' +
    'This server is scoped to one workspace by the MCP URL token, so do not pass workspaceId to tools. ' +
    "Exercise, routine and session responses carry a webUrl for that resource's page in the web app; " +
    `link to that rather than quoting a bare id. The pattern is ${webAppBaseUrl}/workspaces/{workspaceId}/exercises/{exerciseId}, ` +
    `${webAppBaseUrl}/workspaces/{workspaceId}/routines/{routineId} and ` +
    `${webAppBaseUrl}/workspaces/{workspaceId}/sessions/{sessionId}, and list_workspaces returns the ` +
    'workspaceId this token is scoped to.'
);
```

- [ ] **Step 5: Grow the advertised-tools list**

`apps/mcp/test/tool-surface.e2e.spec.ts` — `EXPECTED_TOOL_NAMES` becomes (sorted):

```ts
const EXPECTED_TOOL_NAMES = [
    'add_exercise_link',
    'complete_session',
    'create_exercise',
    'create_item',
    'create_routine',
    'delete_item',
    'get_active_session',
    'get_current_user',
    'get_exercise',
    'get_item',
    'get_routine',
    'get_session',
    'list_exercises',
    'list_items',
    'list_routines',
    'list_sessions',
    'list_workspaces',
    'log_set',
    'start_session',
    'update_exercise',
    'update_item',
    'update_routine',
];
```

- [ ] **Step 6: Run the surface test to see it fail, then pass**

Run: `pnpm --filter @app/mcp test -- tool-surface`
Expected: FAIL before Step 4 is applied (six names missing), PASS after.

- [ ] **Step 7: Write the e2e tests**

`apps/mcp/test/mcp-tools.e2e.spec.ts` — append a `describe` inside the top-level one, after `'routine tools'`:

```ts
describe('workout session tools', () => {
    async function routineWithBench(): Promise<{ routineId: string; benchId: string }> {
        const { id: benchId } = await seedExercise(app.db, { userId, workspaceId, name: 'Session Bench' });
        const created = toolResultBody(
            await client.callTool({
                name: 'create_routine',
                arguments: {
                    name: 'Session Routine',
                    exercises: [{ exerciseId: benchId, targetSets: 2, targetReps: 8, targetWeightKg: 60 }],
                },
            }),
        ) as { id: string };

        return { routineId: created.id, benchId };
    }

    it('reports no active session, then starts one from a routine and finds it active', async () => {
        const before = await client.callTool({ name: 'get_active_session', arguments: {} });
        expect(toolResultBody(before)).toEqual({ active: false });

        const { routineId, benchId } = await routineWithBench();
        const started = await client.callTool({ name: 'start_session', arguments: { routineId } });
        expect(started.isError).toBeFalsy();
        const session = toolResultBody(started) as { id: string; exercises: { id: string }[] };
        expect(session).toMatchObject({
            name: 'Session Routine',
            exercises: [{ position: 0, targetSets: 2, exercise: { id: benchId } }],
            state: { currentSessionExerciseId: session.exercises[0]?.id, nextSetIndex: 1, canComplete: false },
            webUrl: `${TEST_WEB_APP_BASE_URL}/workspaces/${workspaceId}/sessions/${session.id}`,
        });

        const active = await client.callTool({ name: 'get_active_session', arguments: {} });
        expect(toolResultBody(active)).toMatchObject({ active: true, session: { id: session.id } });

        // A second start is a readable 409, not an isError — the model can recover by continuing.
        const again = await client.callTool({ name: 'start_session', arguments: {} });
        expect(again.isError).toBeFalsy();
        expect(toolResultBody(again)).toMatchObject({
            status: 409,
            type: expect.stringMatching(/ActiveSessionExistsError$/),
        });

        // Leave the workspace clean for the next test.
        await client.callTool({
            name: 'log_set',
            arguments: { sessionId: session.id, sessionExerciseId: session.exercises[0]?.id, reps: 8 },
        });
        await client.callTool({ name: 'complete_session', arguments: { sessionId: session.id } });
    });

    it('logs sets, reports what comes next, completes, and lists the session', async () => {
        const { routineId } = await routineWithBench();
        const session = toolResultBody(
            await client.callTool({ name: 'start_session', arguments: { routineId, name: 'Logged' } }),
        ) as { id: string; exercises: { id: string }[] };
        const sessionExerciseId = session.exercises[0]?.id as string;

        const first = await client.callTool({
            name: 'log_set',
            arguments: { sessionId: session.id, sessionExerciseId, weightKg: 60, reps: 8, rpe: 8 },
        });
        expect(first.isError).toBeFalsy();
        expect(toolResultBody(first)).toMatchObject({
            exercises: [{ sets: [{ setIndex: 1, weightKg: 60, reps: 8, rpe: 8 }] }],
            state: { currentSessionExerciseId: sessionExerciseId, nextSetIndex: 2, canComplete: true },
        });

        const second = await client.callTool({
            name: 'log_set',
            arguments: { sessionId: session.id, sessionExerciseId, weightKg: 60, reps: 7 },
        });
        expect(toolResultBody(second)).toMatchObject({
            state: { nextSetIndex: null, progress: { completedExercises: 1 } },
        });

        const completed = await client.callTool({
            name: 'complete_session',
            arguments: { sessionId: session.id, notes: 'Done' },
        });
        expect(completed.isError).toBeFalsy();
        expect(toolResultBody(completed)).toMatchObject({
            id: session.id,
            notes: 'Done',
            completedAt: expect.any(String),
        });

        const fetched = await client.callTool({ name: 'get_session', arguments: { sessionId: session.id } });
        expect(toolResultBody(fetched)).toMatchObject({ id: session.id, name: 'Logged', setCount: 2 });

        const listed = toolResultBody(await client.callTool({ name: 'list_sessions', arguments: {} })) as {
            data: { id: string; webUrl: string }[];
        };
        expect(listed.data.map((row) => row.id)).toContain(session.id);
        expect(listed.data.every((row) => row.webUrl.startsWith(TEST_WEB_APP_BASE_URL))).toBe(true);
    });

    it('returns a tracking-type mismatch as a problem body the model can act on', async () => {
        const { id: plankId } = await seedExercise(app.db, {
            userId,
            workspaceId,
            name: 'Session Plank',
            trackingType: TrackingType.Duration,
        });
        const routine = toolResultBody(
            await client.callTool({
                name: 'create_routine',
                arguments: { name: 'Plank Routine', exercises: [{ exerciseId: plankId, targetDurationSeconds: 60 }] },
            }),
        ) as { id: string };
        const session = toolResultBody(
            await client.callTool({ name: 'start_session', arguments: { routineId: routine.id } }),
        ) as { id: string; exercises: { id: string }[] };

        const result = await client.callTool({
            name: 'log_set',
            arguments: { sessionId: session.id, sessionExerciseId: session.exercises[0]?.id, reps: 10 },
        });

        expect(result.isError).toBeFalsy();
        expect(toolResultBody(result)).toMatchObject({
            status: 400,
            type: expect.stringMatching(/SetShapeMismatchError$/),
        });

        await client.callTool({
            name: 'log_set',
            arguments: { sessionId: session.id, sessionExerciseId: session.exercises[0]?.id, durationSeconds: 60 },
        });
        await client.callTool({ name: 'complete_session', arguments: { sessionId: session.id } });
    });

    // The pin is the point: a token issued for one workspace must not read another's rows even
    // though its owner is a member of both.
    it('cannot reach a session in another workspace the same user owns', async () => {
        const other = await seedWorkspace(app.db, { name: 'Other Sessions', ownerId: userId });
        const service = new WorkoutSessionsService({
            db: app.db,
            membership: new WorkspaceMembershipService({ db: app.db }),
        });
        const { id } = await service.start({ userId, workspaceId: other.id });

        const result = await client.callTool({ name: 'get_session', arguments: { sessionId: id } });

        expect(result.isError).toBe(true);
    });
});
```

Add `WorkoutSessionsService, WorkspaceMembershipService` to an `import { ... } from '@app/services';` line at the top of the spec (`@app/services` is already a devDependency of `apps/mcp`).

- [ ] **Step 8: Run the MCP suites**

Run: `pnpm --filter @app/mcp test`
Expected: PASS.

- [ ] **Step 9: Format, typecheck, lint, commit**

Run: `pnpm format && pnpm typecheck && pnpm lint`
Expected: no errors.

```bash
git add apps/mcp
git commit -m "feat(mcp): add workout session tools"
```

---

## Self-review checklist (run after the last task)

- [ ] `pnpm test` at the root is green, including `route-guard-coverage.e2e.spec.ts` and `tool-surface.e2e.spec.ts`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format` produce no changes or errors.
- [ ] `git diff main --stat -- packages/db/drizzle` shows one new `0005_*.sql` and its snapshot; the SQL contains no `DROP` or `ALTER` of an existing table.
- [ ] `grep -rn "eq(.*\.workspaceId" packages/services/src/workout-sessions.service.ts packages/services/src/exercise-history.service.ts` returns nothing — every tenant filter goes through `scopedToWorkspace` / `scopedToWorkspaceOrGlobal`.
- [ ] `scopedToWorkspaceOrGlobal` appears only on reads of the `exercises` table.
- [ ] Spec coverage: snapshot at start (Task 4 `start`), one transaction (`withTransaction` in `start`), one active session per workspace (index + `ActiveSessionExistsError`), `session_exercises.source`, dense one-based `set_index` renumbered on delete, `session-state.ts` + `rest-timer.ts` pure with a long-background test, `WorkoutSessionsService` + `ExerciseHistoryService`, every session route in the spec's API list plus `exercises/:id/history`, MCP read (`list_sessions`, `get_active_session`, `get_session`) and write (`start_session`, `log_set`, `complete_session`), tenancy tests at service and route level with 404s, and the one end-to-end flow (start → log → skip → add ad hoc → complete) at both levels.
- [ ] `MCP_TOKEN_ROUTES` grew by exactly six entries, each named after the tool that calls it.
