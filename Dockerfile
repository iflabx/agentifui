FROM node:24.22.2-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global --ignore-scripts pnpm@10.34.9

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN --mount=type=cache,id=agentifui-pnpm,target=/pnpm/store \
    CI=1 pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM scratch AS runtime-content
COPY messages /messages
COPY content/pages /content/pages

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_BRAND_NAME=AgentifUI
ARG NEXT_PUBLIC_BRAND_DOMAIN=example.com
ARG NEXT_PUBLIC_GITHUB_LOGIN_ENABLED=false
ARG NEXT_PUBLIC_SSO_ONLY_MODE=false
ARG NEXT_PUBLIC_STORAGE_LEGACY_RELAY_ENABLED=false
ARG NEXT_PUBLIC_AUTH_SESSION_CACHE_TTL_MS=5000
ARG NEXT_PUBLIC_AUTH_SESSION_STALE_GRACE_MS=60000
ARG NEXT_PUBLIC_AUTH_SESSION_THROTTLE_BACKOFF_MS=2000
ARG FASTIFY_PROXY_BASE_URL=http://api:3010
RUN --network=none --mount=type=bind,from=runtime-content,target=/opt/runtime-source \
    set -eu; \
    cp -a /opt/runtime-source /tmp/build-runtime; \
    export AGENTIF_RUNTIME_DIR=/tmp/build-runtime; \
    BETTER_AUTH_SECRET=build-only-not-a-runtime-secret-00000000 \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    REDIS_URL=redis://127.0.0.1:1/0 \
    BETTER_AUTH_URL="$NEXT_PUBLIC_APP_URL" \
    NEXT_TELEMETRY_DISABLED=1 pnpm build:all; \
    mkdir -p public
RUN node -e "require('node:fs').rmSync('.next/cache', {recursive: true, force: true})"

FROM dependencies AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV AGENTIF_RUNTIME_DIR=/data/runtime
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --chown=node:node --from=build /app/messages ./messages
COPY --chown=node:node --from=build /app/content ./content
COPY --chown=node:node --from=build /app/lib/config/language-config.ts /app/lib/config/branding.js ./lib/config/
COPY --chown=node:node --from=build /app/output/build-messages ./output/build-messages
COPY --chown=node:node --from=build /app/scripts/prepare-runtime-content.mjs /app/scripts/check-docker-env.mjs /app/scripts/docker-init-db.mjs /app/scripts/docker-entrypoint.sh ./scripts/
COPY --chown=node:node --from=build /app/scripts/lib/page-content-utils.mjs ./scripts/lib/page-content-utils.mjs
COPY --chown=node:node --from=build /app/database/migrations ./database/migrations
RUN mkdir -p /data /app/pm2-logs /app/.next/cache \
    && chown node:node /data /app/pm2-logs /app/.next/cache /app/output/build-messages
ARG SOURCE_COMMIT=unknown
ARG FASTIFY_PROXY_BASE_URL=http://api:3010
LABEL org.opencontainers.image.title=AgentifUI
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
LABEL io.agentifui.fastify-proxy-base-url=$FASTIFY_PROXY_BASE_URL
USER node
EXPOSE 3000 3010
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["web"]
