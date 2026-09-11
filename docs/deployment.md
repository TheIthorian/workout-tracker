# Deployment

Three deployables: `apps/api` and `apps/mcp` on **Railway**, `apps/web` on **Cloudflare Pages**.
Postgres is Railway-managed.

Railway infrastructure is defined in code at `.railway/railway.ts` — rename the repo, project and
service names in it before your first apply. See `.railway/README.md` for the `railway config`
workflow.

## Before you start

```bash
railway --version
railway login
npx wrangler login
```

## 1. Secrets

```bash
openssl rand -base64 48   # AUTH_SECRET
```

Keep it out of the repo. Railway holds the value; `.railway/railway.ts` references it with
`preserve()` so applying the config never overwrites or prints it.

## 2. Project and Postgres

```bash
railway init --name node-app-base    # or: railway link <projectId> for an existing project
railway add --database postgres
railway variables --service Postgres # note DATABASE_URL for the next step
```

## 3. Apply the schema

`packages/db` owns the schema. Migrations are generated from the Drizzle schema and committed, then
applied against the deployed database:

```bash
pnpm --filter @app/db db:generate                 # after any schema change; commit the output
DATABASE_URL='<railway postgres url>' pnpm --filter @app/db db:migrate
```

Never point `db:migrate` at a database you have not backed up. `drizzle-kit generate` writes SQL to
`packages/db/drizzle/` — read the generated file before applying it, especially any `DROP`.

## 4. `apps/api`

```bash
railway add --service api
```

Its required variables (`apps/api/src/config/load-env.ts` is the authority — an app that boots
without one of these crashes at startup rather than running half-configured):

| Variable               | Notes                                                    |
| ---------------------- | -------------------------------------------------------- |
| `DATABASE_URL`         | From the Postgres service.                               |
| `AUTH_SECRET`          | The value generated above.                               |
| `AUTH_BASE_URL`        | The API's own public origin.                             |
| `AUTH_TRUSTED_ORIGINS` | Comma-separated. Include the web app's origin.           |
| `AUTH_SECURE_COOKIES`  | `true` behind Railway's TLS-terminating proxy.           |
| `CORS_ORIGIN`          | The web app's origin.                                    |
| `WEB_APP_BASE_URL`     | Used to build every `webUrl` in a response.              |
| `API_BASE_URL`         | Used to build every `resourceUrl`.                       |
| `MCP_BASE_URL`         | The `apps/mcp` origin. Used to build a token's `mcpUrl`. |
| `PROBLEM_TYPE_BASE`    | Optional. Base URI for RFC 7807 `type` values.           |
| `LLM_*`                | Optional. A blank `LLM_API_KEY` disables LLM features.   |
| `S3_*`                 | `S3_BUCKET` and both credentials are required.           |

`TZ=UTC` is set in `apps/api/Dockerfile` and must stay set — see the Auth section of `CLAUDE.md`
for why every process touching the Better Auth tables has to agree on one timezone.

The health check Railway gates the deploy on is `/api/health/ready`, which touches the database.
`/api/health` is liveness only and answers before the database is reachable.

## 5. `apps/mcp`

```bash
railway add --service mcp
```

It holds no database connection. Its variables are `PORT`, `NODE_ENV`, the `LOG_*` keys,
`WEB_APP_BASE_URL`, `API_BASE_URL`, `API_INTERNAL_BASE_URL` and `MCP_BASE_URL` — no `DATABASE_URL`,
no auth secret, no storage or LLM credential.

`API_INTERNAL_BASE_URL` should use Railway's private network endpoint (`http://api.railway.internal:PORT`)
so tool traffic never leaves the project.

Its health check is `/health` (liveness), deliberately not `/health/ready` — that one dials `api`,
and gating this deploy on another service's health means a restarting `api` takes `mcp` down too.

## 6. `apps/web` on Cloudflare Pages

```bash
cd apps/web
pnpm build
npx wrangler pages deploy dist
```

Set `API_ORIGIN` in `apps/web/wrangler.toml` (or as a Pages environment variable) to the deployed
`apps/api` origin. The SPA authenticates with session cookies, so the API origin must be listed in
the API's `AUTH_TRUSTED_ORIGINS` and `CORS_ORIGIN`, and `AUTH_SECURE_COOKIES` must be `true` for the
cookie to survive a cross-origin request over HTTPS.

## 7. Verify

```bash
curl https://<api>/api/health          # -> ok
curl https://<api>/api/health/ready    # -> ok, only once Postgres is reachable
curl https://<mcp>/health              # -> ok
```

Then sign up through the web app, create a workspace, and create an MCP personal access token from
its settings page — the returned `mcpUrl` is what an MCP client connects to.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, build, test and a format check on every push and
pull request, and additionally builds the `api` and `mcp` Docker images on pull requests so a broken
Dockerfile fails there rather than after merge. Nothing is pushed or tagged: Railway builds and
probes readiness itself, and a failed probe stops the deploy.
