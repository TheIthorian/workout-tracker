#!/usr/bin/env bash
# Builds and runs apps/api.
#
# Configuration comes from `apps/api/.env`, which the app loads itself at startup (see
# apps/api/src/config/load-dotenv.ts). A variable already set in the environment always wins, so
# `DATABASE_URL=... ./scripts/run-api.sh` overrides the file for a one-off.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/apps/api/.env" ] && [ -z "${DATABASE_URL:-}" ]; then
    echo "No $ROOT/apps/api/.env and no DATABASE_URL in the environment. The server needs at least" >&2
    echo "DATABASE_URL, AUTH_SECRET, AUTH_BASE_URL, WEB_APP_BASE_URL, API_BASE_URL and" >&2
    echo "MCP_BASE_URL. See apps/api/src/config/load-env.ts for the full schema." >&2
    exit 1
fi

cd "$ROOT"
pnpm build
exec node apps/api/dist/main.js
