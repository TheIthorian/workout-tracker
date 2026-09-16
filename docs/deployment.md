# Production deployment

The production topology is:

- `apps/api`, `apps/mcp` and Postgres on Railway.
- `apps/web` on Cloudflare Pages.
- Catalog images in a Cloudflare R2 bucket, served publicly through Cloudflare's CDN.
- `/api/*` on Pages proxied to the public Railway API, keeping browser sessions first-party.

Railway infrastructure is defined in `.railway/railway.ts`. It points at the GitHub repository and
preserves values entered in Railway. Railway's GitHub source deploys API and MCP automatically when
the configured branch changes; `.github/workflows/railway.yml` reviews and applies infrastructure
changes separately.

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

Create a production-environment project token and add it to GitHub repository secrets as
`RAILWAY_TOKEN`. This is needed by `.github/workflows/railway.yml`; never commit it.

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

## 3. Apply database migrations

Run from a trusted machine after Postgres exists and before serving users:

```bash
pnpm install --frozen-lockfile
DATABASE_URL='<production DATABASE_URL>' pnpm --filter @app/db db:migrate
```

There is intentionally no migration-on-boot: a failed migration must not prevent a previous healthy
version from starting. Generate and review migrations locally before committing them:

```bash
pnpm --filter @app/db db:generate
```

## 4. Publish the exercise catalog

The catalog seed is idempotent and must be run manually after catalog content changes. It converts
each source image to WebP (longest side 1200 px, quality 80) on the machine running the seed — the
API never processes images — and uploads only objects that are not already in the bucket:

```bash
pnpm --filter @app/admin build
DATABASE_URL='<production DATABASE_URL>' \
S3_ENDPOINT='https://<account id>.r2.cloudflarestorage.com' S3_REGION='auto' S3_BUCKET='<bucket>' \
S3_ACCESS_KEY_ID='<access key>' S3_SECRET_ACCESS_KEY='<secret key>' S3_FORCE_PATH_STYLE=false \
pnpm --filter @app/admin start seed-exercises
```

Sources over 10 MB or 6000 px on a side are rejected and the seed stops before writing anything.

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

Create a Cloudflare API token with the **Cloudflare Pages: Edit** permission on this account and add
it, along with the account id, to GitHub repository secrets as `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. The deploy job cannot run without them; never commit either value.

If the app is built with PostHog, add `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST` as
repository secrets too. Unlike `API_ORIGIN`, these are read through `import.meta.env` and are baked
into the bundle at build time, so a Pages variable cannot supply them — left unset, the deployed app
simply runs without analytics.

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

`.github/workflows/railway.yml` handles infrastructure changes only:

1. A pull request changing `.railway/**` receives a pinned Railway plan as a PR comment.
2. When that PR merges, the exact reviewed plan is applied.

Fork pull requests are skipped because they cannot receive production secrets. Direct edits to
Railway infrastructure should go through a pull request; direct pushes have no reviewed plan.

Code deployment is automatic from `main` for all three apps: Railway builds and deploys `api` and
`mcp` from its GitHub source, and `deploy-web` publishes the SPA to Pages. Database migrations and
catalog publishing remain manual because they change production data and should be run after
reviewing the release.
