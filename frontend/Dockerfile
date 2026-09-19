# syntax=docker/dockerfile:1
#
# The operator dashboard: built by Vite, served as static files by nginx.
#
#   build    installs the dashboard's own dependencies and runs `vite build`
#   runtime  nginx, unprivileged, with the built files and nothing else: no
#            Node, no package manager, no source, no dependencies
#
# The API addresses are build arguments because Vite compiles them into the
# JavaScript. They are addresses, not secrets: the operator token is typed into
# the sign-in form at runtime and is never part of the image.
#
# Build context is the repository root.

ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30-alpine

# ---- build -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# The workspace root and the dashboard's own manifest are all a frozen install
# of the dashboard needs; the services' manifests are not.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
RUN --mount=type=cache,id=solar-grid-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@solar-grid/dashboard..."

COPY frontend ./frontend/

ARG VITE_SMART_METER_API_URL=http://localhost:3001
ARG VITE_PRICING_API_URL=http://localhost:3002
ARG VITE_TRADE_MATCHING_API_URL=http://localhost:3003
ARG VITE_BILLING_API_URL=http://localhost:3004
ARG VITE_REQUEST_TIMEOUT_MS=10000
ARG VITE_AUTO_REFRESH_MS=30000
ENV VITE_SMART_METER_API_URL=${VITE_SMART_METER_API_URL} \
    VITE_PRICING_API_URL=${VITE_PRICING_API_URL} \
    VITE_TRADE_MATCHING_API_URL=${VITE_TRADE_MATCHING_API_URL} \
    VITE_BILLING_API_URL=${VITE_BILLING_API_URL} \
    VITE_REQUEST_TIMEOUT_MS=${VITE_REQUEST_TIMEOUT_MS} \
    VITE_AUTO_REFRESH_MS=${VITE_AUTO_REFRESH_MS}
RUN pnpm --filter @solar-grid/dashboard build

# ---- runtime -----------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
# The base image runs as uid 101 and listens on 8080, so it needs no root and
# no capability to bind a port. Its pid file and temporary files go to /tmp,
# the one writable path compose gives it.
COPY frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
# nginx directly, without the image's entrypoint scripts: they rewrite the
# configuration at start, which a read-only filesystem does not allow and this
# configuration does not need.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
