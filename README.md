# node-app-base

A starting point for TypeScript apps: a pnpm/Turborepo monorepo with a NestJS + Fastify REST API, an
MCP server, a Vite + React SPA, Better Auth, Drizzle, and multi-tenancy built in. `apps/api` and
`apps/mcp` deploy to Railway; `apps/web` deploys to Cloudflare Pages.

It ships with one worked example — a workspace-owned `Item` resource — running end to end through
every layer, so the shape to copy is visible rather than described. Rename or delete it once you
know what you are actually building.

## Layout

```
apps/
  api/       NestJS + Fastify REST API. Controllers and modules only.
  mcp/       MCP tools as their own process. A thin HTTP client of apps/api.
  admin/     Small CLI for one-off operational tasks.
  web/       Vite + React SPA (Tailwind + shadcn/ui).
packages/
  api-contract/  Zod schemas for every request and response. The keystone.
  api-client/    Bearer-token HTTP client for apps/api, used by apps/mcp.
  auth/          Better Auth wiring, sign-in lockout, MCP token issuing.
  db/            Drizzle schema, client, transactions, workspace scoping.
  services/      Business logic. Plain classes, no framework.
  domain/        Pure logic, no I/O.
  errors/        Typed error taxonomy, serialised as RFC 7807.
  nest-common/   Validation pipe, exception filter, guards, interceptors.
  env/           Typed environment loader with fail-fast validation.
  logger/        pino logger, redaction, request context.
  llm/           OpenAI-compatible client wrapper.
  storage/       S3/MinIO access.
  config/        Shared oxlint and oxfmt configuration.
  tsconfig/      Shared tsconfig presets.
```

## Getting started

```bash
pnpm install
docker compose up -d                              # Postgres, MinIO
cp apps/api/.env.example apps/api/.env            # then fill in the values
pnpm --filter @app/db db:migrate                  # apply the schema
pnpm dev
```

## Common commands

```bash
pnpm dev                    # every app, via Turbo
pnpm build
pnpm test
pnpm lint                   # oxlint
pnpm format                 # oxfmt
pnpm typecheck

pnpm --filter @app/api dev
pnpm --filter @app/api test
```

## Making it yours

1. Rename the project in the root `package.json`, `.railway/railway.ts` and `docs/deployment.md`.
2. Set `PROBLEM_TYPE_BASE` to your own domain so error `type` URIs are not `example.com`.
3. Replace the `Item` example: `packages/db/src/schema/items.ts`,
   `packages/api-contract/src/item.contract.ts`, `packages/services/src/items.service.ts`,
   `apps/api/src/items/`, and the matching tests and web pages.
4. Regenerate migrations with `pnpm --filter @app/db db:generate` and commit the SQL.
5. Read `CLAUDE.md` — it carries the conventions this repo is built to, and it is what an AI agent
   working in the repo reads first.

## Deployment

See `docs/deployment.md`.
