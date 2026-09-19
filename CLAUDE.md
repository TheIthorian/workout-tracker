# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Meta:** When the user states a new rule or convention, always add it to this file immediately before continuing with any other work.

## Project Overview

This is a Phase 1 workout tracker built as a TypeScript monorepo. Its core user-facing concepts are
exercises, routines, and workout sessions.

**Workspaces are the unit of multi-tenancy.** A workspace has members with roles (`member`,
`admin`, `owner`). Nearly every query in the system must be scoped to one workspace, and a query
that forgets that filter is a data leak between tenants, not a bug that just returns extra rows.
See "Multi-tenancy" below, which is the most important section in this file.

**Workspaces are an internal implementation detail in Phase 1.** Every workspace has at most one
user, so the consumer app must not show workspace names, switchers, settings, member management, or
workspace ids in browser URLs. Keep the tenancy model and workspace scoping internally so sharing
can return later, but do not expose workspace management API endpoints while this constraint holds.

## Monorepo Overview

Turborepo monorepo managed with **pnpm workspaces**.

```
apps/
  api/              # NestJS + Fastify REST API — controllers/modules only, logic lives in packages
  mcp/              # MCP tools as a separate deployable process, a thin HTTP client of apps/api
  admin/            # Small CLI for one-off operational tasks
  web/              # Vite + React SPA (Tailwind + shadcn/ui, cookie-session client)
packages/
  tsconfig/         # Shared base / nestjs / react tsconfig presets
  config/           # Shared oxlint and oxfmt configuration
  errors/           # Domain error taxonomy, serialised as RFC 7807 problem details
  logger/           # pino logger, redaction, request context
  env/              # Typed environment loader with fail-fast validation
  db/               # Drizzle schema, client, transactions, workspace-scoping helpers
  domain/           # Pure logic, no I/O
  catalog/          # Exercise content file format and loader (reads the filesystem, nothing else)
  services/         # Business logic as plain classes, no framework
  auth/             # Better Auth wiring, sign-in lockout, MCP token issuing
  storage/          # S3/MinIO/R2 access
  image/            # sharp-based catalog image processing; linked by apps/admin and the API's startup seed
  llm/              # OpenAI-compatible client wrapper
  nest-common/      # Zod validation pipe, exception filter, guards, interceptors
  api-contract/     # Zod schemas for every request and response — the keystone package
  api-client/       # Generic bearer-token HTTP client for apps/api, used by apps/mcp
content/exercises/    # Catalog exercises as JSON + images, published by apps/admin seed-exercises
```

Apps are thin composition layers; any code that could live in a package does. `api-contract` is the
single source of truth for the wire format: the API validates against it and clients assert against
it. Adding an endpoint starts with a schema in `api-contract`, not a controller method.

`api-client` is NOT built on `api-contract` — it is a small, generically-typed `fetch` wrapper that
holds an MCP personal access token and forwards it as `Authorization: Bearer`, built for `apps/mcp`.
`apps/web`'s browser client is a separate, cookie-session-based implementation
(`apps/web/src/lib/http-client.ts`), not this package — if a future SPA client is derived from
`api-contract`, it needs its own name; this one is taken.

## Common Commands

```bash
pnpm install                        # Install all workspace dependencies
pnpm dev                            # Start all apps in dev mode (via Turbo)
pnpm build                          # Build all apps
pnpm lint                           # Run oxlint across the workspace
pnpm format                         # Run oxfmt across the workspace
pnpm test                           # Run all tests
pnpm typecheck                      # tsc -b across every project reference

# Scoped to a single package or app
pnpm --filter @app/api dev
pnpm --filter @app/api test
pnpm --filter @app/domain test
```

### Adding a dependency

Pin every dependency to an **exact version** — no `^`, `~`, or floating range in any
`package.json`. Builds must be reproducible from the lockfile alone.

```bash
pnpm add --save-exact <package>          # run inside the workspace that needs it, e.g. apps/api
pnpm install --frozen-lockfile           # verify the lockfile still resolves
```

Commit the updated `pnpm-lock.yaml` with the `package.json` change. If a lockfile edit produces
churn unrelated to the package being added (peer-dependency rewrites from a different pnpm
version), revert it and re-apply only the intended lines.

## Docker (Development)

```bash
docker compose up -d       # Postgres, MinIO
```

This Postgres also backs the test suite: `pnpm test` creates a throwaway database per spec file on
it and drops it afterwards, never touching the `app` database dev data lives in. See "Testing".

Data lives in **bind mounts outside the repo**, never named volumes and never inside the tree, so
neither `docker compose down -v` nor a git purge can wipe it. The location is `DATA_DIR` in the
root `.env` (copy `.env.example`); no path is hard-coded in `docker-compose.yml`. Delete that
directory to reset local state. Each deployable app has its own `Dockerfile`.

## Tech Stack

| Area              | Choice                                                       |
| ----------------- | ------------------------------------------------------------ |
| Runtime           | Node.js 24 LTS                                               |
| Package manager   | pnpm                                                         |
| Monorepo          | Turborepo                                                    |
| Backend framework | NestJS with **Fastify adapter** (`@nestjs/platform-fastify`) |
| Database          | PostgreSQL via Drizzle                                       |
| Auth              | Better Auth                                                  |
| Frontend          | Vite + React, Tailwind, shadcn/ui                            |
| Lint / Format     | oxlint + oxfmt                                               |
| Deploy            | Railway (api, mcp) + Cloudflare Pages (web)                  |

## Multi-tenancy — read this before writing any query

Every workspace-owned row carries a `workspace_id`. Reading or writing one correctly takes **two**
things, and neither is sufficient alone:

1. **The membership check.** `WorkspaceMembershipService.require({ userId, workspaceId })` proves
   the caller may see the workspace at all. `requireRole` additionally enforces a minimum role.
2. **The tenant filter.** `scopedToWorkspace(table, workspaceId, ...filters)` from `@app/db` builds
   the `where` clause with the tenant filter always present and always first.

A correctly scoped query against a workspace the caller does not belong to still leaks that
workspace's rows. A membership check in front of a query that forgets the filter leaks every
tenant's rows. Do both, every time.

**Never write `eq(table.workspaceId, id)` by hand alongside other filters.** Use
`scopedToWorkspace`. Passing the table itself is what makes the filter impossible to omit: there is
no argument order that produces a query without it. If you find yourself reaching for a raw `eq`,
stop — that is exactly the pattern the helper exists to make impossible to get wrong.

**Catalog rows are shared, read-only content.** A row whose `workspace_id` is `NULL` (today: the
exercise catalog) is visible to every workspace. Read it with `scopedToWorkspaceOrGlobal`, which
admits those rows alongside the caller's own. **Never use that helper on a write.** Every
`update`/`delete` keeps `scopedToWorkspace`, so a catalog id through a workspace route finds no row
and returns the same 404 as another tenant's row. Only the seed writes catalog rows - `apps/api`'s startup seed and
`apps/admin seed-exercises`, both through `runCatalogSeed`.

**A caller who may not see a workspace is told it does not exist**, not that they are forbidden. A
403 confirms the id names a real workspace, which is itself a leak. `EntityNotFoundError` is the
right answer for a non-member and for a row in another workspace. `ForbiddenActionError` is only for
a caller who is already a member and merely too junior — they already know the workspace exists.

MCP personal access tokens are **pinned to one workspace**. `McpPatAuthGuard` compares the
`workspaceId` path segment against the token's own and rejects a mismatch, because membership is
scoped by user and an unpinned token would otherwise reach every workspace its owner belongs to.

## Database

**Drizzle authors the schema.** `packages/db/src/schema/` is the source of truth; run
`pnpm --filter @app/db db:generate` after any change and commit the generated SQL in
`packages/db/drizzle/`. Those migration files are what the test fixture applies to each throwaway
test database and what `runMigrations` applies at `apps/api` boot, so a test database cannot drift
from production.

**Deployments migrate themselves.** `apps/api`'s `main.ts` calls `runMigrations` before it listens,
under a Postgres advisory lock so concurrent replicas cannot race; a failed migration fails the boot
and the previous healthy version keeps serving. `DB_MIGRATE_ON_STARTUP=false` opts a deployment out.
Never ask someone to point a local `DATABASE_URL` at a deployed database to ship a schema change.

**The API publishes the catalog on boot too**, after `listen` and unawaited: `content/exercises` is
in the image and `seedCatalogOnStartup` runs the same `runCatalogSeed` the admin CLI does. Content,
unlike schema, must never fail a deploy - the app serves correctly against an unseeded catalog, so
that path logs and moves on. `CATALOG_SEED_ON_STARTUP=false` opts out.

Read the generated SQL before applying it — especially any `DROP`. `drizzle-kit` will happily
generate a destructive migration from an innocent-looking rename.

Naming is **snake_case** throughout, matching Postgres convention.

`packages/db` is the only package allowed to import `drizzle-orm` directly outside of schema files.

## REST Contract

Routes live under `/api/v1`. `packages/api-contract` holds the Zod schema for every request and
response — define or update the schema there first, then implement the controller against it. Never
hand-write an inline response shape in a controller.

**Errors are RFC 7807 problem details, produced by `@app/errors`.** Each error class's
`problem.type` is `${PROBLEM_TYPE_BASE}/${errorName}`. Set `PROBLEM_TYPE_BASE` to your own domain
in each deployment; the packaged default is a placeholder.

A malformed path parameter yields **404, not 400** (`ValidatedParamPipe`): a segment that cannot be
a valid id names no resource, and a 400 would let a caller tell "wrong shape" apart from "no such
row".

## Auth

Better Auth owns its own tables (`user`, `session`, `account`, `verification`) and is the only
credential store.

- `user.id` is `uuid`, not Better Auth's default `text`, so application tables can carry a native
  uuid foreign key into it. `advanced.database.generateId` in `packages/auth/src/auth-options.ts`
  mints uuids to match. **Changing one without the other breaks sign-up.**
- Account creation goes through `UserProvisioningService`, never Better Auth's own
  `/sign-up/email` route — which is why `emailAndPassword.disableSignUp` is set. That service owns
  the transaction, so validation and per-account bootstrapping (the default workspace and its owner
  membership) commit as one unit and a half-created account can never persist.
- Sign-in lockout lives in `user_lockout`, a repo-owned table, because Better Auth regenerates its
  own schema and would drop columns added to `user`. It is wired as top-level `hooks.before` /
  `hooks.after` rather than relying on `rateLimit`, which only covers Better Auth's HTTP router and
  never a direct `auth.api.*` call.

**Every process that touches `session`, `account`, or `verification` must run in UTC.** Better
Auth's generated schema uses naive `timestamp` columns for `expiresAt`/`createdAt`/`updatedAt` — no
`withTimezone: true` — because that is what Better Auth authors for Postgres. A naive timestamp has
no offset recorded, so it is only correct if every writer and reader agrees on one timezone. Do not
"fix" this to `timestamptz`; regenerating the Better Auth schema would undo it. Instead every app
that boots this package (`apps/api`, `apps/admin`, and any future process touching these tables)
must run with `TZ=UTC` in its Docker image and deployment config.

MCP personal-access-token auth is separate: a hashed-token table plus a Nest guard
(`McpPatAuthGuard`, `packages/nest-common`). `apps/mcp` holds no database connection of its own, so
it forwards the token it was given to `apps/api` as `Authorization: Bearer` on every call rather
than validating it locally.

## Architecture

### apps/api

NestJS + Fastify. Controllers and modules only — every handler delegates to a package (`services`,
`domain`, `db`, `storage`, `llm`) for its actual logic. A controller method that contains business
logic instead of calling into a package is a sign the logic landed in the wrong place.

`test/route-guard-coverage.e2e.spec.ts` walks the real running `ModulesContainer` and fails if any
route has no guard, or if an MCP token can reach a route not on its allowlist. This app has no
`APP_GUARD`, so a route added with no `@UseGuards()` is completely unauthenticated. Do not add a
route to that allowlist just to make the test pass.

### apps/mcp

MCP tools as their own deployable process, and **a thin HTTP client of `apps/api`, not a second
process that touches the database.** Every tool calls `apps/api` over REST through
`@app/api-client`'s `ApiClient`, forwarding the caller's personal access token. It holds no database
pool, no object storage client and no LLM client — `@app/db` and `@app/services` are
`devDependencies` only, used by its test harness, never by the running process. Its required
configuration is `PORT`, `NODE_ENV`, the `LOG_*` keys, `WEB_APP_BASE_URL`, `API_BASE_URL`,
`API_INTERNAL_BASE_URL` and `MCP_BASE_URL` — no `DATABASE_URL`, no auth secret, no storage or LLM
credential.

The workspace comes from the token, never from a tool argument. Exposing it as an argument would be
a contract error, not a convenience.

### apps/admin

A small CLI for one-off operational tasks. Keep it narrow — check that a new command actually
belongs here rather than in the API before adding it.

`seed-exercises` publishes `content/exercises/` into the shared catalog. It shares the run itself
with `apps/api`'s startup seed (`runCatalogSeed` in `packages/services`), so the two cannot drift;
between them they are the only writers of catalog rows.

### apps/web

Vite + React SPA with Tailwind and shadcn/ui, talking to `apps/api` through its own cookie-session
client (`src/lib/http-client.ts`) — not `@app/api-client`, which is `apps/mcp`'s bearer-token client
and has no session concept.

The consumer experience is mobile-first and comfortable to use one-handed at the gym. Prioritize
clarity over density, large tap targets, minimal typing, and an unmistakable primary action.
Use a persistent desktop header and mobile bottom navigation. Keep light/dark/system themes and
date preferences remembered, provide actionable empty/error states and brief action feedback,
confirm destructive actions, and protect unsaved exercise-guide edits when navigating away.

### packages/services

Business logic. Depends on `db` and `domain`; knows nothing about HTTP.

- **Services are plain classes.** No Nest decorators, no injected repositories — dependencies
  arrive through a single object argument in the constructor. An app wires one up with a factory
  provider, so the same service is callable from `apps/api`, `apps/admin`, or a script that never
  boots Nest.
- **Never import `@nestjs/*` here.** That is the whole point of the package.
- **Throw typed errors from `@app/errors`.** A shared exception filter maps them to HTTP; a service
  that throws a Nest `HttpException` has an opinion about a transport it should not know exists.

### packages/domain

Pure logic with no framework attached and no I/O. Its unit tests run with no database and no network
by construction; if a domain test needs either, the logic has drifted into the wrong package.

### packages/db

Drizzle schema, the Postgres client, a transaction helper, and the workspace-scoping query helpers.

### packages/nest-common

Cross-cutting Nest pieces: the Zod validation pipe, the exception filter that turns `@app/errors`
instances into RFC 7807 responses, guards (session, MCP PAT, and the either-one guard), and
interceptors. `apps/api`, `apps/mcp`, and `apps/admin` all depend on this rather than each
reimplementing request validation or error mapping.

## Coding Conventions

### TypeScript

- **Never use `any`.** Not in source, not in tests, and never with an `eslint-disable`/
  `oxlint-disable` for the no-explicit-any rule. Avoid `unknown` where possible. When the type is
  not statically known, perform runtime validation (Zod, or a type guard) rather than casting. When
  a cast is genuinely unavoidable, use `as unknown as X` — never `as any`.
- **Prefer `type` over `interface`.** Use `type` aliases by default; only use `interface` when a
  class must implement it.
- **`enum` for closed sets of values.** Use a TypeScript `enum`, not a `const` array with a derived
  literal union. Zod reads an enum directly (`z.enum(MyEnum)`), and the import forces the
  dependency to point at whichever package owns the vocabulary instead of each call site restating
  the literals.
- **Explicit return types** — every function and method must have an explicit return type
  annotation.
- **Object arguments** — when a function has two or more parameters, use a single object argument
  instead of positional params.
- **Docstrings** — add a JSDoc comment to every public method on a class or interface, and every
  exported module-level function. Keep them concise: only document parameters, return value, or
  thrown errors when it genuinely adds information beyond the name.
- **Comments explain why, not how.** The code already says what it does. Comment only what the
  code cannot: the reason for a non-obvious choice, a constraint from outside the file, a trap
  someone would otherwise reintroduce. Keep it to a line or two — if a comment needs a paragraph,
  the reasoning belongs in the spec or the commit message. Never write a comment that describes or
  justifies the change being made; a reader who never saw the diff gains nothing from it. That
  reasoning goes in the PR description. The same goes for design rationale — why a class is plain
  rather than decorated, why a type is an alias rather than a wrapper, why a package is laid out as
  it is. It reads as a defence of a decision to a reviewer who is no longer there. Put it in the
  PR, or in the package README if it is a standing convention.
- **Declaration order** — a helper function is declared _after_ its caller, so a file reads
  top-down from its entry point to its details. Function declarations hoist, so a module-level
  helper can sit at the bottom of the file even when the code above it calls it. Values that are
  not hoisted (`const`, `let`, classes) still have to precede their use.
- **Trailing commas** — always include trailing commas on the last item of multi-line objects,
  arrays, and parameter lists (oxfmt enforces this; see Formatting below).
- **Logging** — always place a blank line before and after a log statement, and a blank line after
  a closing scope brace (where the formatter allows).

### Formatting

oxfmt, configured at the repo root (`.oxfmtrc.json`) and re-exported for packages from
`@app/config`: 4-space indent, single quotes, 120-character print width, trailing commas
everywhere multi-line. Run `pnpm format` rather than hand-formatting; don't fight the formatter's
output in review.

### Testing

- **Do not run UI browser or Playwright assertions.** Use static checks and non-browser automated
  tests for web changes unless the user explicitly asks for browser verification.
- **Co-locate test files** — place `*.spec.ts` files next to the source file they test. The vitest
  config picks up `src/**/*.spec.ts`; the build tsconfig excludes them from the production output.
  `apps/api`'s end-to-end specs live in `apps/api/test/` instead, because they boot the whole app.
- **Integration tests use the real database** — `startTestDatabase` in `@app/db/testing` creates a
  fresh, randomly-named database per spec file and applies the committed migrations to it; never
  mock the database layer. A mocked DB layer cannot tell you whether a query actually matches the
  schema.
- **The test Postgres is already running; the suite does not start one.** `TEST_DATABASE_URL` names
  a server and its `postgres` maintenance database — `docker compose`'s dev Postgres locally (the
  default, so `docker compose up -d` is all a developer needs), a service container in CI. Never
  point it at `DATABASE_URL`: that names the `app` database real dev data lives in, and this fixture
  creates and drops databases on whatever server it is given. A package whose tests need a database
  needs no vitest wiring at all — `startTestDatabase()` is the whole interface.
- **Test the tenancy boundary explicitly.** Every workspace-scoped service and route needs a test
  proving a caller in workspace A cannot read or write workspace B's rows, and that the refusal is a 404.
- **No I/O in `packages/domain`** — its unit tests run with no database and no network by
  construction; if a domain test needs either, the logic has drifted into the wrong package.
- **Libraries never read `process.env`.** A package under `packages/` must receive its
  configuration as constructor or function arguments, never call `process.env` directly — only an
  app's bootstrap (`packages/env`'s loader, invoked from `apps/*`) reads the environment. A library
  that reads `process.env` itself cannot be constructed twice with different settings, cannot be
  tested against a value it wasn't started with, and gives the owning app a second, hidden source
  of truth for its own configuration. `packages/logger` enforces this on itself with a source-scan
  test (`no-env-access.spec.ts`) — follow that pattern in any new package that could be tempted to
  reach for `process.env` as a shortcut. `packages/db/drizzle.config.ts` and
  `packages/db/src/testing/postgres-fixture.ts` are the exceptions: one configures a CLI and the
  other the test runner, and neither has an app to be configured by.

### Error Handling

- **Always use typed errors from `@app/errors`** — never `throw new Error(...)`. Use the matching
  subclass, or add a new one when nothing fits.
- A new error class's `problem.type` is derived from its `errorName`; keep that name identical to
  the class name so a client matching on the URI and a developer reading a stack trace see the same
  string.

## Configuration Management

Critical configuration is managed through `apps/*/.env` files (see each app's `.env.example`) and
validated by `packages/env`'s fail-fast loader — an app that boots with an invalid or missing
required variable should crash on startup, not run in a half-configured state. Sensitive values
(database credentials, the auth secret, LLM API keys, S3/MinIO credentials) belong in environment
variables or a secrets manager, never committed to a config file.

## Git — Conventional Commits

All commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

types: feat | fix | chore | test | docs | refactor | style | perf | build | ci
scope: optional, e.g. api | mcp | web | db | auth
```

## Pull Requests — Title and What / Why / How

**Open a pull request whenever you push a branch**, without waiting to be asked, and always with a
description — a pushed branch with no PR is unfinished work.

**PR titles follow Conventional Commits**, same format as commit messages above:
`<type>(<scope>): <description>`.

PR descriptions use exactly three headings, in this order, and stay concise:

```markdown
## What

## Why

## How
```

- **What** — the change, in a line or two.
- **Why** — the problem it solves.
- **How** — the approach, and any non-obvious decision or deployment hazard.

No other headings. Keep each section short; the diff carries the detail.

This applies to every PR on the repository, however it was opened. A PR created from the Claude
Code UI, a template, or any other tool arrives with whatever description that tool generated —
rewrite the title and body into this format rather than leaving them.
