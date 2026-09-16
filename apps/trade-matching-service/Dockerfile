FROM node:24-alpine

# OpenSSL is required by the Prisma engines on Alpine (musl + OpenSSL 3.x)
RUN apk add --no-cache openssl

# pnpm version comes from package.json#packageManager, so the image and
# the developer machine can never drift apart again.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared-contracts/package.json ./packages/shared-contracts/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/nest-common/package.json ./packages/nest-common/
COPY apps/smart-meter-service/package.json ./apps/smart-meter-service/
COPY apps/pricing-engine-service/package.json ./apps/pricing-engine-service/
COPY apps/trade-matching-service/package.json ./apps/trade-matching-service/
COPY apps/billing-ledger-service/package.json ./apps/billing-ledger-service/

RUN pnpm install --frozen-lockfile

COPY packages/shared-contracts ./packages/shared-contracts/
COPY packages/shared-utils ./packages/shared-utils/
COPY packages/nest-common ./packages/nest-common/
COPY apps/trade-matching-service ./apps/trade-matching-service/

RUN pnpm --filter @solar-grid/shared-contracts build
RUN pnpm --filter @solar-grid/shared-utils build
RUN pnpm --filter @solar-grid/nest-common build

RUN cd apps/trade-matching-service && npx prisma generate && pnpm build

WORKDIR /app/apps/trade-matching-service
EXPOSE 3003
# Migrations are applied from committed SQL, never generated from the
# schema at boot. exec hands PID 1 to node so signals reach it.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
