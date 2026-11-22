# Workout Tracker

A mobile-first workout tracker built to be used one-handed at the gym. Build an exercise library,
group exercises into routines, and log sets as you go. The app recommends which routine to do next,
and an MCP server lets an AI assistant read and log your workouts for you.

**Try it:** <https://workout-tracker-app-web.pages.dev>

## Features

- **Exercise library** — a shared catalog of exercises with guides and images, plus your own
  custom exercises, each tagged with the muscles it works and with an optional target to aim for.
- **Routines** — reusable workout templates built from your exercises.
- **Workout sessions** — start a session from a routine, log each set, and finish it. Your history
  is kept per session.
- **Next-routine recommendation** — the home page suggests the routine you are most due for.
- **MCP integration** — connect an MCP client (such as Claude) to manage exercises, routines and
  sessions in conversation.

## Connecting an AI assistant (MCP)

The live MCP server is at:

```
https://mcp-production-af34.up.railway.app/mcp
```

Add it as a remote MCP server in your client. The client sends you to the web app to sign in and
approve the connection over OAuth 2.1; no API key is needed. Each connection reaches only your own
data.

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
  auth/          Better Auth wiring, sign-in lockout, MCP OAuth tokens.
  catalog/       Exercise content file format and loader.
  db/            Drizzle schema, client, transactions, workspace scoping.
  services/      Business logic. Plain classes, no framework.
  domain/        Pure logic, no I/O.
  errors/        Typed error taxonomy, serialised as RFC 7807.
  nest-common/   Validation pipe, exception filter, guards, interceptors.
  env/           Typed environment loader with fail-fast validation.
  logger/        pino logger, redaction, request context.
  ssrf/          Outbound fetch for caller-supplied URLs.
  image/         Catalog image processing.
  llm/           OpenAI-compatible client wrapper.
  storage/       S3/MinIO/R2 access.
  config/        Shared oxlint and oxfmt configuration.
  tsconfig/      Shared tsconfig presets.
content/
  exercises/     Catalog exercises as JSON and images.
```

`CLAUDE.md` describes the conventions the codebase follows.

## Running locally

```bash
pnpm install
cp .env.example .env                              # set DATA_DIR
docker compose up -d                              # Postgres, MinIO
cp apps/api/.env.example apps/api/.env            # then fill in the values
cp apps/mcp/.env.example apps/mcp/.env
pnpm dev
```

The API applies migrations and publishes the exercise catalog when it starts.

## Common commands

```bash
pnpm dev                    # every app, via Turbo
pnpm build
pnpm test                   # needs the docker compose Postgres running
pnpm lint                   # oxlint
pnpm format                 # oxfmt
pnpm typecheck

pnpm --filter @app/api dev
pnpm --filter @app/api test
```

## Deployment

`apps/api` and `apps/mcp` run on Railway; `apps/web` runs on Cloudflare Pages. See
`docs/deployment.md`.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE): free to use, study and modify for noncommercial purposes.
Commercial use is not permitted. Third-party material is listed in [NOTICE.md](NOTICE.md).
