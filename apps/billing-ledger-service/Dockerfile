FROM node:20-alpine

# OpenSSL is required by the Prisma engines on Alpine (musl + OpenSSL 3.x)
RUN apk add --no-cache openssl

RUN npm install -g pnpm@10.32.1

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared-contracts/package.json ./packages/shared-contracts/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY apps/smart-meter-service/package.json ./apps/smart-meter-service/
COPY apps/pricing-engine-service/package.json ./apps/pricing-engine-service/
COPY apps/trade-matching-service/package.json ./apps/trade-matching-service/
COPY apps/billing-ledger-service/package.json ./apps/billing-ledger-service/

RUN pnpm install --frozen-lockfile

COPY packages/shared-contracts ./packages/shared-contracts/
COPY packages/shared-utils ./packages/shared-utils/
COPY apps/billing-ledger-service ./apps/billing-ledger-service/

RUN pnpm --filter @solar-grid/shared-contracts build
RUN pnpm --filter @solar-grid/shared-utils build

RUN cd apps/billing-ledger-service && npx prisma generate && pnpm build

WORKDIR /app/apps/billing-ledger-service
EXPOSE 3004
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main.js"]
