# Workout Tracker — Phase 1 Design

**Date:** 2026-09-10
**Status:** Approved for planning
**Scope:** Exercise library, routines, and workout mode. Built on the `node-app-base` template.

## Context

A personal workout tracker, used on a phone at the gym and on a desktop at home. The product as a
whole covers health goals, exercises, routines, how-to guides, and a workout mode. That is more than
one spec can carry, so it is built in phases. This document specifies Phase 1: the core loop of an
exercise library, routines built from it, and the session screen used mid-workout.

The repository is the unmodified `node-app-base` template — a Turborepo monorepo with a NestJS +
Fastify API, a Vite + React SPA, an MCP process, and a worked `Item` example running through every
layer. Phase 1 follows that example's shape.

### Users and tenancy

Single user in practice. Every row is still workspace-owned and scoped through
`scopedToWorkspace`, exactly as the template requires. There is a one-to-one correspondence between
the user and their workspace, and no sharing UI, no invites, and no visibility rules in Phase 1.

Keeping workspaces is deliberate: it decouples the data from the identity, so opening the product up
to multiple users later is a feature, not a migration.

### Training types

A logged set must be able to record three shapes of work:

- `weight_reps` — load and repetitions (the default, and what workout mode is optimised for)
- `duration` — elapsed seconds
- `distance_time` — distance and elapsed time

Bodyweight movements are `weight_reps` with a zero or omitted load.

### Exercise library

The library starts empty and grows as it is used; an exercise can be created inline from workout
mode the first time it is needed. There is no seeded catalog to maintain or dedupe against.

## Decisions

### Session snapshot, not live reference

Starting a session **copies** the routine's exercises and targets into the session as its own rows.
From that moment the session is self-contained: editing the routine next week does not move last
month's history, and every mid-session deviation is an ordinary edit to the session's own rows
rather than an override layered on a reference.

The alternatives were rejected:

- **Live reference to `routine_exercises`** avoids duplicated target data, but editing a routine
  silently rewrites what past sessions claim was planned, and every deviation needs an override row.
- **Append-only event log** gives a perfect audit trail and is the natural fit for an offline sync
  queue, but every read becomes a projection and Phase 1 has no offline requirement to justify it.

The snapshot also draws a clean aggregate boundary around a session, which is what makes the later
local-first phase tractable.

### Online-only, but portable

Phase 1 is online-only. Requests are ordinary request/response; a failed set write shows an inline
retry on that set row and leaves the rest of the session usable.

The session state machine lives in `packages/domain` as pure logic with no I/O, so a later
local-first web client or a native client reuses it without change. The later offline phase swaps
the transport, not the screen.

### Guides are first-party content

An exercise's how-to guide is stored locally as structured text, with the user's own images and
optional external links (typically to video). Being redirected to a long article mid-rest is the
failure this avoids: the guide must be readable in a few seconds, in the app, over the session
screen.

## Data Model

All tables are workspace-owned, carry `workspace_id`, and are read and written through
`scopedToWorkspace`. Naming is `snake_case`. Drizzle authors the schema in
`packages/db/src/schema/`; generated SQL is committed.

Enums are TypeScript enums (per the repository conventions), mirrored as `pgEnum` and read directly
by Zod via `z.enum(...)`.

### `exercises`

The library, and the guide.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `workspace_id` | uuid | FK → `workspaces.id`, on delete cascade |
| `created_by_user_id` | uuid null | FK → `user.id`, on delete set null |
| `name` | text | |
| `tracking_type` | enum | `weight_reps` \| `duration` \| `distance_time` |
| `notes` | text null | |
| `guide_setup` | text null | |
| `guide_execution` | text null | |
| `guide_cues` | text null | |
| `guide_mistakes` | text null | |
| `archived_at` | timestamptz null | |
| `created_at` / `updated_at` | timestamptz | |

The four `guide_*` fields sit on the exercise rather than in a one-to-one child table. Structure
matters more than richness here: a fixed set of short fields can be laid out for a five-second
glance, and a freeform markdown body cannot.

**`exercise_guide_images`** — `id`, `workspace_id`, `exercise_id`, `storage_key`, `caption`,
`position`. Uploaded through `@app/storage` to S3/MinIO.

**`exercise_links`** — `id`, `workspace_id`, `exercise_id`, `url`, `label`, `position`. External
references, typically video.

### `routines` and `routine_exercises`

`routines`: `id`, `workspace_id`, `created_by_user_id`, `name`, `description`, `archived_at`,
timestamps.

`routine_exercises`: `id`, `workspace_id`, `routine_id`, `exercise_id`, `position`, `target_sets`,
`rest_seconds`, `notes`, and the nullable target fields matching the tracking type —
`target_reps`, `target_weight_kg`, `target_duration_seconds`, `target_distance_m`.

### `workout_sessions`

`id`, `workspace_id`, `user_id` (nullable, FK → `user.id` on delete set null), `routine_id`
(nullable, on delete set null — the snapshot source, kept for provenance only and never read back
for targets), `name` (copied at start), `started_at`, `completed_at` (nullable), `notes`,
timestamps.

Deleting a member or a routine must not take the workspace's session history with it, so both
foreign keys null out rather than cascade. `exercises` and `routines` are archived rather than
deleted for the same reason.

**One active session per workspace**, enforced by a partial unique index on `workspace_id` where
`completed_at is null`. Without it, a backgrounded phone plus an open desktop tab produces two live
sessions writing sets into different rows.

### `session_exercises`

`id`, `workspace_id`, `session_id`, `exercise_id`, `position`, `rest_seconds`, `skipped_at`
(nullable), plus the copied `target_*` fields, plus:

- `source` — enum `from_routine` \| `added_ad_hoc`

This table is the snapshot boundary. After the copy at session start, nothing reads back into
`routines`.

### `set_entries`

`id`, `workspace_id`, `session_exercise_id`, `set_index`, `completed_at`, `is_warmup`, `rpe`
(nullable), and the nullable measurement columns: `weight_kg`, `reps`, `duration_seconds`,
`distance_m`.

`set_index` is dense and one-based, unique per `session_exercise_id`, and renumbered when a set is
deleted so the on-screen numbering never has a gap.

One wide table with nullable measurement columns, rather than a table per tracking type. Which
columns are required is determined by the parent exercise's `tracking_type` through a single pure
function in `packages/domain`, reused as a Zod refinement in `api-contract` and mirrored as a
database check constraint.

### Units

Canonical units only: kilograms, metres, seconds. Unit display and conversion are a client concern.
Mixed units in a column is a bug that surfaces months later, in data that is expensive to correct.

## API

Routes live under `/api/v1/workspaces/:workspaceId/…`. Every request and response schema is defined
in `packages/api-contract` before the controller is written.

- `exercises` — list (with search), create, read, update, archive
- `exercises/:id/images` — upload, delete
- `exercises/:id/links` — create, update, delete
- `exercises/:id/history` — recent sets for this exercise; backs the last-time prefill and, later,
  progress charts
- `routines` — list, create, read, update, archive
- `routines/:id/exercises` — add, update, remove, reorder
- `sessions` — `POST` start (from a routine id, or empty), `GET active`, `GET :id`, list history
- `sessions/:id/complete` — `POST`
- `sessions/:id` — `DELETE` (abandon)
- `sessions/:id/exercises` — add ad-hoc, skip, unskip, reorder
- `sessions/:id/exercises/:sessionExerciseId/sets` — log, edit, delete

Errors are RFC 7807 problem details from `@app/errors`. A malformed path parameter yields 404, not
400, per `ValidatedParamPipe`.

## Packages

### `packages/domain` (pure, no I/O)

- `tracking-type.ts` — which set fields each tracking type requires. Single source for the Zod
  refinement, the shape of the database check constraint, and the client's choice of input widget.
- `session-state.ts` — the session state machine: given the session aggregate, the current exercise,
  the next set index, progress, and whether the session can be completed.
- `rest-timer.ts` — remaining rest computed as arithmetic on a stored `started_at` timestamp, never
  a running interval. A phone that locks or backgrounds kills an interval; timestamp arithmetic
  survives it.

### `packages/services`

`ExercisesService`, `RoutinesService`, `WorkoutSessionsService`, `ExerciseHistoryService`. Plain
classes with dependencies supplied through a single constructor object, no Nest imports, typed
errors from `@app/errors`.

Starting a session writes `workout_sessions` and all its `session_exercises` in **one transaction**.
A half-copied routine is a session that cannot be trusted.

### `apps/api`

Controllers and modules only, one module per resource, following `apps/api/src/items`.

### `apps/mcp`

Read and write tools, all calling `apps/api` over REST through `@app/api-client` with the caller's
personal access token. The process holds no database connection.

- Read: list exercises, read an exercise guide, list routines, recent session history
- Write: create/update an exercise (including guide text and links), create/update a routine, start
  a session, log a set, complete a session

The workspace comes from the token, never from a tool argument. Each route reachable by an MCP token
is added to the allowlist deliberately, as a decision about what a token may do — never to make
`route-guard-coverage.e2e.spec.ts` pass.

## Web UX

Mobile-first, reusing the existing `AppBottomNav`. Five surfaces:

- **Today** — resumes the active session if one exists; otherwise starts a routine or a blank
  session. One tap to the gym.
- **Routines** — list, and an editor with drag-reorder and per-exercise targets.
- **Exercises** — searchable library. The detail page is the guide: structured text, images, links.
- **Session** — workout mode. See below.
- **History** — past sessions, and per-exercise history.

### Workout mode

The session renders as a scrolling list of `session_exercises`. The active exercise's card expands
inline to show its input controls and logged sets; the others stay collapsed. The rest timer is
pinned at the top and `Log set` fills the footer. Skipping, reordering, and adding an exercise are
direct actions on the list.

The guide opens as a **bottom sheet over the session**, never a navigation away. Losing your place
mid-workout is what makes a person close the app.

The input control is chosen by tracking type: `weight_reps` gets two large increment/decrement
dials, `duration` gets a start/stop timer, `distance_time` gets distance plus elapsed time. One
component per type behind a small switch, not one form with hidden fields.

The screen fetches the session aggregate once and mutates it locally. A set write updates local
state immediately and reconciles with the response; a failure shows an inline retry on that set row
while the rest of the session stays usable. This is not offline support, but it is the shape a sync
queue would need.

### Desktop

The same routes at a wider breakpoint. Routine editing and guide writing get real two-column
layouts, because both are genuinely better with a keyboard. Everything else is the mobile layout,
centred.

## Errors

Typed errors from `@app/errors` throughout. Two new classes, each a genuine domain state rather than
a validation accident:

- `ActiveSessionExistsError` — starting a session while one is already live
- `SetShapeMismatchError` — logging reps against a `distance_time` exercise, and equivalents

Each class's `errorName` matches its class name, so `problem.type` and a stack trace read the same
string.

## Testing

- **`packages/domain`** — unit tests, no database and no network. Tracking-type validation, the
  session state machine, and rest-timer arithmetic including a session left backgrounded for a long
  period.
- **`packages/services`** — real Postgres via testcontainers, never mocked. Every workspace-scoped
  service gets an explicit tenancy test proving a caller in workspace A can neither read nor write
  workspace B's rows, and that the refusal is a **404**. `items.service.spec.ts` is the pattern.
- **`apps/api`** — end-to-end specs per resource in `apps/api/test/`. `route-guard-coverage.e2e.spec.ts`
  picks up new routes automatically.
- **One flow gets an integration test of its own:** start a session, log sets, skip an exercise, add
  an ad-hoc exercise, complete. That is the path where a bug costs a real workout.

## Out of Scope for Phase 1

Deferred to later phases, each with its own spec:

- **Phase 2 — health goals and progress.** Goals, progress dashboards, and charts. These need
  history to exist before they mean anything.
- **Phase 3 — offline / PWA.** Installable app, local-first workout mode, a sync queue.

Not planned: plate calculator, 1RM estimates, body measurements, sharing or social features.
