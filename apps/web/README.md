# Web

The Vite + React SPA. Ships the shadcn/ui component set, Tailwind, a theme provider, cookie-session
auth against `apps/api`, workspace switching, and one example resource (`items`) wired end to end.

## Development

```bash
pnpm --filter @app/web dev
```

Runs on <http://localhost:8080>. `/api` is proxied to the API (see `vite.config.ts`), so the
session cookie stays first-party — set `VITE_API_PROXY_TARGET` if your API is not on port 5001.

## Testing and building

```bash
pnpm --filter @app/web test
pnpm --filter @app/web typecheck
pnpm --filter @app/web build
pnpm --filter @app/web preview
```

## Deployment

Deployed to Cloudflare Pages. `wrangler.toml` sets `API_ORIGIN`, which
`functions/api/[[path]].ts` reads at request time to proxy `/api/*` to the API — that proxy is what
keeps the session cookie same-origin in production.

## Where to start in a new project

- `src/constants.ts` — set `APP_NAME`.
- `index.html` — title and social metadata.
- `wrangler.toml` — Pages project name and `API_ORIGIN`.
- `src/pages/items/`, `src/models/item.ts`, `itemsApi` in `src/lib/api.ts` — the example resource
  to rename or replace.
