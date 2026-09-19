# Solar Grid - Operator Dashboard

A browser console for the people who run the grid: what the meters recorded,
what traded and at what price, whether the ledger balances, and whether every
service is ready. It reads the statistics API ([analytics.md](analytics.md))
and the public readiness and price endpoints, and nothing else. It changes
nothing: there is no button in it that writes.

```text
http://localhost:8080          once the Docker stack is up
```

## Running it

### With the stack

The dashboard is part of `docker compose up`:

```bash
pnpm env:init                                        # once
docker compose -f infrastructure/docker-compose.yml up -d --build --wait
bash scripts/demo.sh                                 # some real data to look at
```

Open http://localhost:8080 and sign in with `OPERATOR_API_TOKEN` from
`infrastructure/.env`.

Use `localhost`, not `127.0.0.1`, unless you have added that origin to
`CORS_ALLOWED_ORIGINS`: the services only answer browser requests from the
origins they allow (see [CORS](#cors) below).

### While developing it

```bash
docker compose -f infrastructure/docker-compose.yml up -d --wait   # the services
pnpm dashboard:dev                                                 # http://localhost:5173
```

The dev server reloads on every save and talks to the services in Docker. The
stack allows its origin (`http://localhost:5173`) by default.

| Command                                            | Does                                    |
| -------------------------------------------------- | --------------------------------------- |
| `pnpm dashboard:dev`                               | dev server on 5173                      |
| `pnpm --filter @solar-grid/dashboard build`        | production build into `frontend/dist`   |
| `pnpm --filter @solar-grid/dashboard preview`      | serves that build on 4173               |
| `pnpm --filter @solar-grid/dashboard test`         | component and unit tests (Vitest)       |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | include the dashboard, like the backend |

## Configuration

| Variable                      | Default                 | Meaning                                        |
| ----------------------------- | ----------------------- | ---------------------------------------------- |
| `VITE_SMART_METER_API_URL`    | `http://localhost:3001` | smart-meter, as the browser reaches it         |
| `VITE_PRICING_API_URL`        | `http://localhost:3002` | pricing                                        |
| `VITE_TRADE_MATCHING_API_URL` | `http://localhost:3003` | trade-matching                                 |
| `VITE_BILLING_API_URL`        | `http://localhost:3004` | billing                                        |
| `VITE_REQUEST_TIMEOUT_MS`     | `10000`                 | how long one request may take                  |
| `VITE_AUTO_REFRESH_MS`        | `30000`                 | how often auto refresh reloads the page’s data |

**Everything prefixed `VITE_` is public.** Vite compiles these values into the
JavaScript every visitor downloads, so they are addresses and timings, never a
token or a password. The defaults match the ports compose publishes, so a
local dev server needs no `.env` at all; `frontend/.env.example` documents
them. In Docker they are build arguments, set by compose from the same
`*_PORT` variables that publish the services. A malformed value stops the app
with a message naming the variable.

## Architecture

```text
browser ──── http://localhost:8080 ────▶ nginx (static files only)
   │
   ├── GET /health/ready, /prices/current ──────────▶ each service (public)
   └── GET /stats/*   Authorization: Bearer <token> ─▶ each service (operator)
```

The browser calls each service directly. There is no proxy or
backend-for-frontend: nginx only serves files, the services already do
authentication, validation, rate limiting and CORS, and a proxy in between would
be one more thing to secure and keep in step with them.

```text
frontend/
  src/
    config/       VITE_* variables, read and checked once
    types/        the API's response shapes, mirroring docs/analytics.md
    services/     ApiClient (the only code that calls fetch) and the typed endpoints
    auth/         the token store and the sign-in session
    hooks/        loading, refreshing and cancelling data; auto refresh; health
    utils/        time windows, decimal and date formatting, chart series
    components/
      ui/         panels, states, badges, buttons, icons
      charts/     the three charts, their tooltip and their table twin
      dashboard/  header, time window, key figures, market, billing, households, health
    layouts/  pages/  styles/
  test/           Vitest and Testing Library against a fake API
  nginx/          server configuration and security headers
  Dockerfile
```

- **One client.** `ApiClient` is the only code that calls `fetch`. It adds the
  token and a fresh `x-correlation-id`, applies the timeout, cancels on request,
  and turns every failure into an `ApiError` whose kind the interface acts on.
  `solar-grid-api.ts` lists every endpoint the dashboard reads.
- **One data layer.** `useDashboardData` loads each service's section for the
  selected window once, in parallel, and every panel reads from it; nothing
  fetches on its own. Households and health have their own small hooks.
- **Sections fail on their own.** If pricing is down, the price panel says so
  and the other panels carry on - the same shape as the backend, where each
  service answers for its own data.
- **No state library.** React state, context for the API and the session, and
  `useSyncExternalStore` for the token. Nothing here needs more.
- **Recharts** for the charts, loaded only after sign-in, so the sign-in page
  is small.

## Sign-in and the session

1. The operator pastes `OPERATOR_API_TOKEN` into the sign-in form.
2. The dashboard asks trade-matching whether it is an operator token, with a
   one-minute `/stats/summary`. If trade-matching cannot be reached it asks
   billing, then smart-meter, then pricing: signing in does not depend on one
   service being up.
3. `200` keeps the token for the tab. `401` says the token was not accepted;
   `403` says it belongs to another role (the internal or metrics token). The
   field is cleared either way.
4. Every request sends the token as `Authorization: Bearer ...`. Any later 401
   or 403 - the token was rotated, say - signs the operator out and says why.
5. **Sign out** removes the token.

There is no login endpoint, user table or session on the backend; the services
check the bearer token on every request, and the dashboard only remembers it.

### Where the token is kept

In the tab's `sessionStorage`, and nowhere else:

- it survives a reload of that tab, and nothing more - closing the tab or
  signing out removes it, and other tabs and browsers never see it
- it is never displayed after sign-in, written to the console, put in a URL or
  copied into an error message; lint forbids `console` in the dashboard
- any script running on the page could read it, which is the trade-off of
  bearer tokens in a browser. The page therefore only runs its own scripts: its
  content security policy allows scripts from its own origin and connections to
  its own origin and the four configured services, and nothing else

An HttpOnly cookie would keep the token from scripts entirely, but the services
authenticate with a bearer header and have no endpoint that could set one;
adding it would be a new authentication system.

## What each part shows

| Part            | From                                           | Notes                                                                                        |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Header          | readiness of all four                          | "4 of 4 services ready", last update, refresh, auto refresh, sign out                        |
| Time window     | -                                              | 24 h and 7 d in hourly buckets, 30 d daily, or custom dates                                  |
| Key figures     | smart-meter, trade-matching, pricing summaries | production, consumption, net, traded energy, volume, volume weighted price                   |
| Energy          | smart-meter trends                             | production and consumption as areas, net as a line around zero                               |
| Market          | trade-matching trends                          | traded energy, volume and average price as three charts sharing one time axis                |
| Price           | pricing summary and trends, `/prices/current`  | average line, lowest-to-highest bar, the band's floor and cap                                |
| Market activity | trade-matching summary                         | offered and requested energy, matched and still open, trade outcomes                         |
| Households      | the three `/stats/households`                  | trading, energy or billing per household, ten per page, filter by id                         |
| Billing         | billing summary                                | settled volume, credits, debits, net ("balanced" only when exactly `0.00`), current balances |
| Service health  | `/health/ready` of each                        | status, dependencies, response time, when it was checked                                     |

### The time window

`from` and `to` are UTC and half open, exactly as the API takes them. The
presets end at the moment of the refresh and slide forward with it; a custom
window stays where it was put and includes both of its dates. A custom window
is checked before it is sent - start before end, not in the future, at most
366 days - so the dashboard never sends a window the API would refuse, and it
picks a bucket (hour, day or week) that stays inside the API's bucket limits.

### Numbers

Every figure is shown as the API returned it. Energy, prices and money arrive
as decimal strings and stay strings: digits are grouped by working on the
text, and nothing is added up, averaged or rounded in the browser. The only
place a value becomes a JavaScript number is the position of a mark on a
chart; the tooltip and the table show the original string.

An average with nothing to average is `null` in the API and a gap in a chart,
never zero. A quiet bucket is zeros because the API says it was zero.

### Loading, errors, empty

- **First load:** placeholders the size of what is coming.
- **Refreshing:** the figures stay on screen, dimmed, until the new ones
  arrive - no flash back to placeholders.
- **A failed section:** says which part failed in plain words ("Unable to load
  market statistics. Trade matching could not be reached.") with the request's
  correlation id, and tries again on the next refresh. No stack traces, SQL or
  raw responses, because none reach the browser.
- **Nothing in the window:** says so ("No trading activity in the selected
  period.") instead of drawing an empty chart.
- **Something unexpected while rendering:** an error boundary replaces the page
  with a plain message and a reload button rather than leaving it blank. The
  error itself stays in the browser's developer tools.

### Refreshing

**Refresh** reloads everything now. **Auto refresh** (on by default) does the
same every 30 seconds, skipping a tick while the previous refresh is still
running and while the tab is hidden. A new refresh or window cancels the
requests it replaces, so answers never arrive out of order.

## Accessibility

- Every chart names its series in words - a legend, or a label beside each of
  the small market charts - and has a **Show table** button that shows every
  value it draws.
- Status is always an icon and a word ("Ready", "Not ready", "Balanced"), never
  colour alone.
- Keyboard: every control is reachable, focus is always visible, the household
  tabs follow the arrow keys, and Enter submits the sign-in form.
- The layout reflows down to a phone's width; wide tables scroll inside their
  panel rather than the page.
- Chart colours were checked for colour-vision deficiency against the panel
  background.

## CORS

The dashboard is on its own origin, so the stack allows it:
`CORS_ALLOWED_ORIGINS` defaults, in `docker-compose.yml`, to
`http://localhost:8080`, `http://127.0.0.1:8080` and `http://localhost:5173`
(the port follows `DASHBOARD_PORT`). Setting the variable replaces the list.
Origins are always explicit - a `*` is ignored by the services - and a service
started outside compose without the variable still allows no browser origin
at all. Serving the dashboard from anywhere else means adding that origin.

## Docker

| Property     | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Image        | `nginxinc/nginx-unprivileged:1.30-alpine` plus the built files |
| Size         | about 90 MB; no Node, no dependencies, no source               |
| User         | `nginx` (uid 101)                                              |
| Filesystem   | read-only, 8 MB `tmpfs` at `/tmp`                              |
| Capabilities | none; `no-new-privileges`                                      |
| Health       | `GET /healthz`                                                 |
| Limits       | 0.5 CPU, 64 MB                                                 |
| Secrets      | none - the container is given no credential of any kind        |

nginx serves `index.html` with `Cache-Control: no-cache`, hashed assets for a
year, and every path it does not know as the app. It adds
`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a
permissions policy and the `frame-ancestors` directive; the rest of the content
security policy is in `index.html`, written at build time from the API
addresses.

The dashboard is additive: the services and their images are unchanged, and
the stack now runs ten long-running containers instead of nine.

## Tests

`pnpm --filter @solar-grid/dashboard test` runs Vitest with Testing Library in
jsdom, against a fake API returning the exact shapes the services return. They
cover the client (headers, correlation ids, every error kind, timeouts,
cancellation, a 5xx that must not leak), sign-in and the session (success, 401,
403, fallback to the next service, sign out, a token rejected mid-session, a
reload), the key figures, each chart's series and table, loading, error and
empty states, the time window, refresh and auto refresh, market, billing,
households and health.

## Known limitations

- **The token is readable by script on the page.** The content security policy
  narrows what could run there; an HttpOnly session would need a backend
  change.
- **API addresses are fixed at build time.** Serving the same image against
  services on other addresses means building it again with other `VITE_*`
  arguments.
- **No live push.** The dashboard polls; there is no WebSocket or server-sent
  event stream.
- **Times are UTC only.** There is no local-time display or time zone setting.
- **Read-only.** Running matching or recalculating a price stays with the API
  and the operator's tools.
- **One operator role.** The backend has one operator token, so there are no
  per-person accounts, audit of who looked at what, or finer permissions.
