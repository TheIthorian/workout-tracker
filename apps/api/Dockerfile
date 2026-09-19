# syntax=docker/dockerfile:1
# Production image for apps/api, the REST API.

FROM node:26.7.0-alpine3.23 AS base
RUN apk upgrade --no-cache && npm i -g pnpm@11.1.3

# ---- prune: reduce the workspace to what @app/api needs ----
FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.10.10 prune @app/api --docker

# ---- install: manifests only, so this layer caches until a dependency changes ----
FROM base AS installer
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM installer AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@app/api...
# --legacy: pnpm 11 otherwise refuses `deploy` outside a workspace-root-injected layout.
RUN pnpm --filter @app/api deploy --prod --legacy /out

# ---- runtime ----
FROM base AS runtime
WORKDIR /app

# Better Auth writes naive timestamps, so they are only correct while every process agrees on UTC.
# In the image rather than the platform's per-service env, which a new service can be created
# without.
ENV NODE_ENV=production
ENV TZ=UTC

USER node
COPY --from=builder --chown=node:node /out .

# The exercise catalog the startup seed publishes. `turbo prune` keeps only workspace packages, so
# this comes from the build context directly.
COPY --chown=node:node content ./content

EXPOSE 3000

# Liveness, not readiness. `/api/health/ready` touches the database and gates the DEPLOY
# (railway.api.json); this one must not, because restarting the process does not repair a database
# that went away - it only adds churn to an outage that is already happening.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
