# Production deployment

The production topology is:

- `apps/api`, `apps/mcp` and Postgres on Railway.
- `apps/web` on Cloudflare Pages.
- Catalog images in a Cloudflare R2 bucket, served publicly through Cloudflare's CDN.
- `/api/*` on Pages proxied to the public Railway API, keeping browser sessions first-party.

Railway infrastructure is defined in `.railway/railway.ts`. It points at the GitHub repository and
preserves values entered in Railway. Railway's GitHub source deploys API and MCP automatically when
the configured branch changes; infrastructure changes are applied by hand with the Railway CLI, see
"Changing infrastructure" below.

## Before you start

```bash
railway --version
railway login
npx wrangler login
```

Use Node 24 and pnpm 11, as declared by `.nvmrc` and `package.json`.

## 1. Create or link Railway

```bash
railway init --name workout-tracker       # or: railway link <project-id>
railway environment new production       # skip if it already exists
railway environment link production
railway config plan
railway config apply
```

Review the plan before applying it. If services already exist, import or migrate them before using
`.railway/railway.ts`; do not let IaC accidentally replace an existing production topology.

In Railway, connect both `api` and `mcp` to `TheIthorian/workout-tracker`, branch `main`, and confirm
the Dockerfile paths from `.railway/railway.ts`. Generate a public domain for `api` and, only if
external MCP clients need it, for `mcp`.

No Railway token is stored in GitHub: infrastructure is applied from a trusted machine, so the
credential never leaves it.

## 1b. Create the R2 image bucket

Catalog images are published by `apps/admin seed-exercises` into an R2 bucket and read by browsers
straight from Cloudflare, never through the API. R2's free tier (10 GB, 10 million reads a month)
covers this comfortably.

1. In the Cloudflare dashboard, R2 → Create bucket. Name it (e.g. `workout-tracker-images`), leave
   the location automatic.
2. Bucket → Settings → Public access. Either connect a custom domain (`images.<your domain>`, if the
   domain is on Cloudflare — this is the only way to get CDN caching and no rate limit) or enable
   the `r2.dev` subdomain. The `r2.dev` URL is rate-limited and uncached, but fine until there is a
   domain. Note the resulting public URL: that is `CATALOG_IMAGE_BASE_URL`.
3. R2 → Manage API tokens → Create API token with **Object Read & Write** on this one bucket. Note
   the access key ID and secret access key; the token page also shows the S3 endpoint
   (`https://<account id>.r2.cloudflarestorage.com`).

Every object is written with `Cache-Control: public, max-age=31536000, immutable` — safe because
keys are content-addressed, so a changed image is a new URL. Nothing in the bucket is private:
`catalog/` is public by design, and there are no user uploads.

## 2. Configure Railway variables

Generate a strong auth secret locally, then enter it only in Railway:

```bash
openssl rand -base64 48
```

Set these on `api`:

| Variable                                   | Value                                                  |
| ------------------------------------------ | ------------------------------------------------------ |
| `NODE_ENV`                                 | `production`                                           |
| `AUTH_SECRET`                              | Generated value                                        |
| `AUTH_BASE_URL`                            | Public API origin, e.g. `https://api.example.com`      |
| `AUTH_TRUSTED_ORIGINS`                     | Pages/custom web origin                                |
| `AUTH_SECURE_COOKIES`                      | `true`                                                 |
| `CORS_ORIGIN`                              | Pages/custom web origin                                |
| `WEB_APP_BASE_URL`                         | Pages/custom web origin                                |
| `API_BASE_URL`                             | Public API origin                                      |
| `MCP_BASE_URL`                             | Public MCP origin                                      |
| `PROBLEM_TYPE_BASE`                        | Stable URI base, e.g. `https://api.example.com/errors` |
| `S3_ENDPOINT`                              | `https://<account id>.r2.cloudflarestorage.com`        |
| `S3_REGION`                                | `auto` (R2 accepts nothing else)                       |
| `S3_BUCKET`                                | The R2 bucket name from step 1b                        |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | The R2 API token from step 1b                          |
| `S3_FORCE_PATH_STYLE`                      | `false`                                                |
| `CATALOG_IMAGE_BASE_URL`                   | The bucket's public URL from step 1b, no trailing `/`  |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | Optional; blank key disables LLM features              |

Set `DATABASE_URL` on `api` as a Railway reference to Postgres' private URL, using the dashboard
variable picker or `${{Postgres.DATABASE_URL}}`. Do not expose Postgres publicly.

Set these on `mcp`:

| Variable                | Value                                    |
| ----------------------- | ---------------------------------------- |
| `NODE_ENV`              | `production`                             |
| `WEB_APP_BASE_URL`      | Pages/custom web origin                  |
| `API_BASE_URL`          | Public API origin used in resource links |
| `API_INTERNAL_BASE_URL` | `http://api.railway.internal:3000`       |
| `MCP_BASE_URL`          | Public MCP origin                        |
| `PROBLEM_TYPE_BASE`     | Same value as `api`                      |

Set `LOG_PRETTY=false` and `LOG_REDACT=true`. Railway supplies `PORT`. The API health check is
`/api/health/ready`; MCP uses `/health`. Keep these paths unchanged.

## 3. Database migrations

`apps/api` applies the committed `packages/db/drizzle` migrations on boot, before it listens, so a
release ships its own schema and nobody needs a psql session or a production `DATABASE_URL` on a
laptop. Concurrent replicas are serialised by a Postgres advisory lock, and a migration that fails
fails the boot: the deploy's readiness probe never passes, Railway keeps the previous healthy
version serving, and the bad release is rolled back rather than half-applied.

The consequence to plan for is that a destructive or long-running migration blocks the new version
from starting, so generate and _read_ the SQL locally before committing it:

```bash
pnpm --filter @app/db db:generate
```

Set `DB_MIGRATE_ON_STARTUP=false` on a deployment that would rather run migrations as its own step;
the manual command is then:

```bash
pnpm install --frozen-lockfile
DATABASE_URL='<production DATABASE_URL>' pnpm --filter @app/db db:migrate
```

## 4. The exercise catalog

`apps/api` publishes `content/exercises` into the catalog itself, once the server is listening. The
content ships inside the image, and the seed is idempotent, so a boot that changes nothing costs a
directory read and a few queries over the private network — the database never needs a public
endpoint. The run is deliberately _not_ awaited and never fails the boot: an unseeded or
half-seeded catalog still serves correctly, so a slow bucket must not turn into a failed deploy.
Watch the `api` deploy logs for `Exercise catalog seeded`, or for the error line if it did not.

Catalog content changes therefore ship as a deploy: `content/**` is in the `api` service's
`watchPatterns`, so merging new content to `main` rebuilds and reseeds.

`CATALOG_SEED_ON_STARTUP=false` turns it off. The same run is still available from a trusted
machine, which needs a reachable database and converts each source image to WebP (longest side
1200 px, quality 80) locally — the API does the identical conversion at boot, and uploads only
objects the bucket does not already hold:

```bash
pnpm --filter @app/admin build
DATABASE_URL='<production DATABASE_URL>' \
S3_ENDPOINT='https://<account id>.r2.cloudflarestorage.com' S3_REGION='auto' S3_BUCKET='<bucket>' \
S3_ACCESS_KEY_ID='<access key>' S3_SECRET_ACCESS_KEY='<secret key>' S3_FORCE_PATH_STYLE=false \
pnpm --filter @app/admin start seed-exercises
```

Sources over 10 MB or 6000 px on a side are rejected and the seed stops before writing anything.

## 4b. Changing infrastructure

`.railway/railway.ts` is declarative, so anything removed or renamed in it is removed or renamed on
Railway — a renamed volume plans as delete-then-create, which is the Postgres disk. Read the plan
before applying, from a machine that is already logged in:

```bash
railway config plan          # read this: it is the diff against live infrastructure
railway config apply         # previews again and asks before changing anything
```

This is a local step on purpose. Planning needs a Railway token and executes `.railway/railway.ts`,
so running it in CI would mean handing a production credential to branch code on every pull request
— a poor trade for a change made a few times a year. Apply after merging, so what is applied is what
was reviewed.

## 5. Deploy the web app to Cloudflare Pages

Create the Pages project once:

```bash
npx wrangler pages project create workout-tracker-app-web       # first deployment only
```

After that every merge to `main` deploys the web app automatically — see CI/CD below. The project
name and build output directory come from `apps/web/wrangler.toml`, so a manual deploy runs the same
command CI does:

```bash
pnpm --filter @app/web build
pnpm --filter @app/web exec wrangler pages deploy --branch=main
```

Set the Pages production variable `API_ORIGIN` to the public API origin. Do not leave the
`your-api.up.railway.app` placeholder in `apps/web/wrangler.toml`. The Pages function proxy is
required; `VITE_API_BASE_URL` alone does not replace it.

Add the exact Pages/custom web origin to the API's `AUTH_TRUSTED_ORIGINS` and `CORS_ORIGIN`.

### 5a. GitHub secrets for the automated deploy

The `deploy-web` job reads four repository secrets. The two Cloudflare ones are required; without
them the job fails at the deploy step.

| Secret                     | Required | Used for                        |
| -------------------------- | -------- | ------------------------------- |
| `CLOUDFLARE_API_TOKEN`     | Yes      | Authenticating `wrangler`       |
| `CLOUDFLARE_ACCOUNT_ID`    | Yes      | Selecting the account           |
| `VITE_PUBLIC_POSTHOG_KEY`  | No       | Analytics, baked into the build |
| `VITE_PUBLIC_POSTHOG_HOST` | No       | Analytics, baked into the build |

**Get `CLOUDFLARE_API_TOKEN`**

1. Sign in to <https://dash.cloudflare.com>, open the account menu (top right) → **Profile** → **API
   Tokens**, or go straight to <https://dash.cloudflare.com/profile/api-tokens>.
2. **Create Token** → **Create Custom Token** (**Get started**).
3. Name it, e.g. `github-actions-pages-deploy`.
4. Under **Permissions**, select **Account** · **Cloudflare Pages** · **Edit**. Add nothing else —
   this token only needs to publish Pages deployments.
5. Under **Account Resources**, restrict it to the one account holding the Pages project.
6. **Continue to summary** → **Create Token**, then copy the value. Cloudflare shows it once.

**Get `CLOUDFLARE_ACCOUNT_ID`**

```bash
npx wrangler login      # first time only
npx wrangler whoami     # prints the account name and its 32-character id
```

It is also on the account's **Workers & Pages** overview page in the dashboard. It is an identifier,
not a credential, but keep it in secrets alongside the token.

**Get the PostHog values (optional)**

1. In PostHog, **Settings** → **Project** → **Project API key** — the value starting `phc_`. That is
   `VITE_PUBLIC_POSTHOG_KEY`; it is a write-only public key, safe to ship in a browser bundle.
2. `VITE_PUBLIC_POSTHOG_HOST` is your region's ingestion host, shown on the same page:
   `https://us.i.posthog.com` or `https://eu.i.posthog.com`.

Unlike `API_ORIGIN`, these are read through `import.meta.env` and baked into the bundle at build
time, so a Pages variable cannot supply them. Left unset, the deployed app simply runs without
analytics.

**Add them to GitHub**

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add
each name exactly as spelled above. Never commit any of these values.

## 6. Verify

```bash
curl -fsS https://<api>/api/health
curl -fsS https://<api>/api/health/ready
curl -fsS https://<mcp>/health
curl -I https://<web>/
```

Then sign up through the web app, create a workspace, and create an MCP personal access token from
Settings. The returned `mcpUrl` is the URL an MCP client connects to.

## CI/CD

`.github/workflows/ci.yml` runs lint, typecheck, build, tests, formatting, and Docker image builds on
pull requests. `checkSuites: true` makes Railway wait for repository checks before deploying API and
MCP from `main`.

Its `deploy-web` job publishes `apps/web` to Cloudflare Pages on every push to `main`, after those
same checks pass. It deploys with the wrangler version pinned in the lockfile, so CI and a manual
deploy run identical code, and it is serialised on a `deploy-web` concurrency group so two merges
landing together cannot race. Nothing deploys from a pull request.

Infrastructure is deliberately _not_ in CI — see "Changing infrastructure" above.

Code deployment is automatic from `main` for all three apps: Railway builds and deploys `api` and
`mcp` from its GitHub source, and `deploy-web` publishes the SPA to Pages. Migrations and the
catalog seed both ride the `api` deploy, so neither needs credentials outside Railway — the review
that matters is the one on the pull request that introduces the migration SQL or the content.
