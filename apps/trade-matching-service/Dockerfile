# syntax=docker/dockerfile:1
#
# The stages that matter, all from this one file:
#
#   build    compiles the workspace with every dev dependency; never shipped
#   migrate  applies the migrations and runtime grants as the database owner,
#            then exits (docker compose runs it before the service starts)
#   deploy   copies the service out with only its production dependencies
#   runtime  the service: those dependencies, compiled code, the Prisma query
#            engine - and no compiler, no Prisma CLI, no package manager, no root
#
# Build context is the repository root.

ARG NODE_IMAGE=node:24-alpine

# ---- workspace manifests, shared by the install stages ----------------------
FROM ${NODE_IMAGE} AS manifests
# Prisma picks its engines by the OpenSSL version it detects with the openssl
# binary; without it, it guesses 1.1 and looks for engines that are not there.
RUN apk add --no-cache openssl
# pnpm comes from package.json#packageManager, so the image and a developer's
# machine run the same version.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# Every workspace manifest is needed for a frozen install, even when only one
# service is installed.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared-contracts/package.json ./packages/shared-contracts/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/nest-common/package.json ./packages/nest-common/
COPY apps/smart-meter-service/package.json ./apps/smart-meter-service/
COPY apps/pricing-engine-service/package.json ./apps/pricing-engine-service/
COPY apps/trade-matching-service/package.json ./apps/trade-matching-service/
COPY apps/billing-ledger-service/package.json ./apps/billing-ledger-service/

# ---- build -------------------------------------------------------------------
FROM manifests AS build
# The pnpm store is a build cache shared by every stage of every service, so a
# package is downloaded once rather than once per image. It is never part of
# an image.
RUN --mount=type=cache,id=solar-grid-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store \
      --filter "@solar-grid/trade-matching-service..."

COPY packages/shared-contracts ./packages/shared-contracts/
COPY packages/shared-utils ./packages/shared-utils/
COPY packages/nest-common ./packages/nest-common/
COPY apps/trade-matching-service ./apps/trade-matching-service/

RUN pnpm --filter @solar-grid/shared-contracts build \
 && pnpm --filter @solar-grid/shared-utils build \
 && pnpm --filter @solar-grid/nest-common build

WORKDIR /app/apps/trade-matching-service
RUN pnpm exec prisma generate && pnpm build

# ---- migrate -----------------------------------------------------------------
FROM build AS migrate
# The Prisma CLI would otherwise phone home and check for updates.
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
USER node
# Committed SQL only, never generated from the schema. The grants run after the
# migrations because they name the tables the migrations create.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/runtime-grants.sql && echo 'Runtime grants applied'"]

# ---- deploy: the service with only its own production dependencies -------------
FROM build AS deploy
WORKDIR /app
# `pnpm deploy` copies the service out of the workspace with a node_modules of
# its own production dependencies. The shared packages are copied in rather
# than linked, and get their Nest peers from the service.
RUN --mount=type=cache,id=solar-grid-pnpm-store,target=/pnpm/store \
    pnpm --filter @solar-grid/trade-matching-service deploy --prod --legacy --ignore-scripts \
      --store-dir /pnpm/store /deploy
WORKDIR /deploy
# Sources and build configuration are not needed to run compiled code.
RUN rm -rf src test prisma Dockerfile .env.example nest-cli.json tsconfig*.json \
           node_modules/.pnpm/@solar-grid+*/node_modules/@solar-grid/*/src \
           node_modules/.pnpm/@solar-grid+*/node_modules/@solar-grid/*/tsconfig* \
 # @prisma/client names the CLI as a peer, so the install pulls it and its
 # migration engines in. The service only loads the query engine that
 # `prisma generate` placed in ./generated.
 && rm -rf node_modules/.pnpm/prisma@* node_modules/.pnpm/@prisma+engines@* \
           node_modules/.pnpm/@prisma+engines-version@* node_modules/.pnpm/@prisma+fetch-engine@* \
           node_modules/.pnpm/@prisma+get-platform@* node_modules/.pnpm/@prisma+debug@* \
 # The client also ships WebAssembly engines for edge runtimes; this is not one.
 && rm -f node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime/*.wasm

# ---- runtime -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
# The query engine runs the same OpenSSL detection at startup.
RUN apk add --no-cache openssl \
 # npm, npx, corepack and yarn are build tools. A running service never needs
 # them, and each is attack surface and a source of audit findings.
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app
# Owned by root: the service can read its code but not change it.
COPY --from=deploy /deploy ./

USER node
EXPOSE 3003
# node is PID 1 and receives SIGTERM directly; the service shuts down on it.
CMD ["node", "dist/main.js"]
