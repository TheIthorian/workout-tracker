# syntax=docker/dockerfile:1
# Production image for apps/mcp, the MCP server.
#
# It holds no database, object store or LLM client - every tool is an HTTP call to apps/api - so
# @app/db, /services and /llm are devDependencies, imported only by the test harness. The
# `deploy --prod` below is what keeps them out of this image.

FROM node:26.7.0-alpine3.23 AS base
RUN apk upgrade --no-cache && npm i -g pnpm@11.1.3

# ---- prune: reduce the workspace to what @app/mcp needs ----
FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.10.10 prune @app/mcp --docker

# ---- install: manifests only, so this layer caches until a dependency changes ----
FROM base AS installer
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM installer AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@app/mcp...
# --legacy: pnpm 11 otherwise refuses `deploy` outside a workspace-root-injected layout.
RUN pnpm --filter @app/mcp deploy --prod --legacy /out

# ---- runtime ----
FROM base AS runtime
WORKDIR /app

# UTC for the same reason apps/api pins it: this process reads sessions Better Auth wrote as naive
# timestamps, and a container on another zone would compare them wrongly.
ENV NODE_ENV=production
ENV TZ=UTC

USER node
COPY --from=builder --chown=node:node /out .

EXPOSE 3100

# Liveness, not readiness. `/health/ready` checks that apps/api is reachable and gates the DEPLOY
# (railway.mcp.json); this one must not, because restarting this process does not repair the API -
# it would take MCP down a second time during someone else's outage.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3100/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
