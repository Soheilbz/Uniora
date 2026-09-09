ARG NODE_IMAGE=node:24.20.0-alpine3.24@sha256:4caaaf42195bcd6f6f3559a413b20cb8f8ad089e231ee874cf7701643966689f
ARG UNIV_PNPM_INSTALL=offline

FROM ${NODE_IMAGE} AS pnpm-toolchain
WORKDIR /opt/pnpm
COPY toolchain/pnpm/11.21.0/ ./
RUN ln -s /opt/pnpm/bin/pnpm.mjs /usr/local/bin/pnpm \
  && node /opt/pnpm/bin/pnpm.mjs --version | grep -Fx '11.21.0'

FROM pnpm-toolchain AS dependencies
ARG UNIV_PNPM_INSTALL=offline
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=bind,from=pnpm-store,target=/mnt/pnpm-store,ro \
  --mount=type=bind,from=pnpm-metadata,target=/root/.cache/pnpm,ro \
  set -eu; \
  mkdir -p /tmp/pnpm-store; \
  cp -a /mnt/pnpm-store/. /tmp/pnpm-store/; \
  if [ "${UNIV_PNPM_INSTALL}" = "offline" ]; then \
    pnpm install --offline --frozen-lockfile --store-dir=/tmp/pnpm-store; \
  else \
    pnpm install --frozen-lockfile --store-dir=/tmp/pnpm-store; \
  fi; \
  # better-auth declares drizzle-kit as an optional peer. pnpm keeps the
  # development peer closure in a production install, but the worker runtime
  # never loads it. Remove only the obsolete esbuild 0.25.12 binary that
  # arrives through that build-only peer; the locked 0.28.2 toolchain remains
  # available to the builder and is not copied into the runtime closure. \
  find node_modules/.pnpm -maxdepth 1 -mindepth 1 \
    \( -name '@esbuild+*0.25.12*' -o -name 'esbuild@0.25.12*' \) \
    -prune -exec rm -rf '{}' +; \
  test -z "$(find node_modules/.pnpm -maxdepth 1 -mindepth 1 \
    \( -name '@esbuild+*0.25.12*' -o -name 'esbuild@0.25.12*' \) -print -quit)"; \
  rm -rf /tmp/pnpm-store

FROM dependencies AS builder
WORKDIR /app
COPY . .
RUN pnpm build && node scripts/prepare-runtime-closures.mjs

FROM dependencies AS worker-dependencies
RUN --mount=type=bind,from=pnpm-store,target=/mnt/pnpm-store,ro \
  --mount=type=bind,from=pnpm-metadata,target=/root/.cache/pnpm,ro \
  set -eu; \
  mkdir -p /tmp/pnpm-store; \
  cp -a /mnt/pnpm-store/. /tmp/pnpm-store/; \
  pnpm install --prod --no-optional --offline --frozen-lockfile --store-dir=/tmp/pnpm-store; \
  pnpm prune --prod --no-optional; \
  # pnpm can retain the dev-only auth CLI as an optional peer closure. It is
  # never imported by a production worker, so remove only that exact package
  # directory and fail closed if it remains. \
  find node_modules/.pnpm -maxdepth 1 -mindepth 1 \
    -name 'auth@*' -prune -exec rm -rf '{}' +; \
  test -z "$(find node_modules/.pnpm -maxdepth 1 -mindepth 1 -name 'auth@*' -print -quit)"; \
  # better-auth declares drizzle-kit as an optional peer. pnpm keeps the
  # development peer closure in a production install, but the worker runtime
  # never loads it. Remove only the obsolete esbuild 0.25.12 binary that
  # arrives through that build-only peer; the locked 0.28.2 toolchain remains
  # available to the builder and is not copied into the runtime closure. \
  find node_modules/.pnpm -maxdepth 1 -mindepth 1 \
    \( -name '@esbuild+*0.25.12*' -o -name 'esbuild@0.25.12*' \) \
    -prune -exec rm -rf '{}' +; \
  test -z "$(find node_modules/.pnpm -maxdepth 1 -mindepth 1 \
    \( -name '@esbuild+*0.25.12*' -o -name 'esbuild@0.25.12*' \) -print -quit)"; \
  rm -rf /tmp/pnpm-store

FROM ${NODE_IMAGE} AS runtime-base
WORKDIR /app
# The pinned Node base already contains the reviewed CA bundle. Do not run an
# unpinned apk upgrade or reacquire it from a live mirror in every target. The
# explicit OpenSSL packages are the current Alpine security fix for the base's
# vulnerable 3.5.7-r0 libraries; their versions stay pinned.
RUN npm uninstall --global npm \
  && apk add --no-cache libcrypto3=3.5.8-r0 libssl3=3.5.8-r0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

FROM runtime-base AS runner
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --chown=node:node scripts/production-check.mjs ./scripts/production-check.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "const port=process.env.PORT||'3000'; fetch('http://127.0.0.1:'+port+'/api/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]

# Tenant jobs get only their transitive runtime source closure. No platform,
# migration, backup or restore code exists in this filesystem boundary.
FROM runtime-base AS tenant-worker
WORKDIR /app
COPY --from=worker-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.runtime-closures/tenant/ ./
USER node
CMD ["node", "scripts/job-worker.mjs"]

# Platform control-plane worker. PostgreSQL client is required for its approved
# backup create/verify operations, but tenant-job-only source is not copied.
FROM runtime-base AS runtime-pg-base
# PostgreSQL client tooling is required only by the platform/operations
# targets; keep the package version explicit rather than resolving a moving
# Alpine repository head.
RUN apk add --no-cache postgresql18-client=18.6-r0

FROM runtime-pg-base AS platform-worker
WORKDIR /app
COPY --from=worker-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.runtime-closures/platform/ ./
USER node
CMD ["node", "scripts/platform-worker.js"]

# One-shot privileged operator tools. This target intentionally contains the
# migration/DR assets that are absent from both long-running worker images.
FROM runtime-pg-base AS operations
WORKDIR /app
COPY --from=worker-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.runtime-closures/operations/ ./
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node db ./db
USER node
CMD ["node", "scripts/production-db-check.mjs"]
