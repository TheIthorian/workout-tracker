FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN corepack enable && pnpm install --frozen-lockfile

COPY apps/web apps/web

WORKDIR /app/apps/web

ARG VITE_API_BASE_URL=
ARG VITE_IS_DEV_MODE=false
ARG VITE_PUBLIC_POSTHOG_KEY=
ARG VITE_PUBLIC_POSTHOG_HOST=

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_IS_DEV_MODE=${VITE_IS_DEV_MODE}
ENV VITE_PUBLIC_POSTHOG_KEY=${VITE_PUBLIC_POSTHOG_KEY}
ENV VITE_PUBLIC_POSTHOG_HOST=${VITE_PUBLIC_POSTHOG_HOST}

RUN pnpm build

FROM caddy:2-alpine AS runtime

RUN apk add --no-cache curl
COPY --from=build /app/apps/web/dist /usr/share/caddy
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD curl -fsS http://127.0.0.1/ || exit 1
