# Solar Grid - Operator Control Center

A browser console for the people who run the grid. Someone who has never seen
SolarGrid should be able to tell within seconds whether it is working and what
it is doing; an engineer should be able to look into almost everything without
a terminal. It reads the statistics API ([analytics.md](analytics.md)), the
services' own counters (`GET /diagnostics`, [observability.md](observability.md)),
and the public readiness, price, household status and balance endpoints - and
nothing else. It changes nothing: there is no button in it that writes.

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
   ├── GET /health/ready, /prices/current,
   │       /households/:id/status, /balances/:id ───────────▶ each service (public)
   └── GET /stats/*, /diagnostics
           Authorization: Bearer <operator token> ─────────▶ each service (operator)
```

The browser calls each service directly. There is no proxy or
backend-for-frontend: nginx only serves files, the services already do
authentication, validation, rate limiting and CORS, and a proxy in between would
be one more thing to secure and keep in step with them.

```text
frontend/
  src/
    app/          the control center: routes, shared data, page loading
    config/       VITE_* variables, read and checked once
    types/        the API's response shapes, mirroring docs/analytics.md
    services/     ApiClient (the only code that calls fetch) and the typed endpoints
    auth/         the token store and the sign-in session
    hooks/        loading, refreshing and cancelling data; auto refresh; health; counters
    utils/        periods, formatting, chart series, system status, what needs attention
    components/
      shell/      navigation, top bar, period control
      ui/         layout primitives, states, badges, help tooltips, drawer, icons
      charts/     every chart, its tooltip and its table twin
      status/  overview/  market/  trading/  billing/  households/  system/
    pages/        one per navigation entry
  test/           Vitest, Testing Library and axe-core against a fake API
  nginx/          server configuration and security headers
  Dockerfile
```

- **One client.** `ApiClient` is the only code that calls `fetch`. It adds the
  token and a fresh `x-correlation-id`, applies the timeout, cancels on request,
  and turns every failure into an `ApiError` whose kind the interface acts on.
  `solar-grid-api.ts` lists every endpoint the dashboard reads.
- **Load once, share everywhere.** The control center loads each service's
  statistics for the selected period, the four readiness checks and the four
  diagnostics snapshots once per refresh, and every page reads them from one
  context. Moving between pages never fetches again, and every page shows the
  same moment. Only the household lists (paged and searchable), the rankings
  and the household detail load on their own.
- **Sections fail on their own.** If pricing is down, the price figures say so
  and everything else carries on - the same shape as the backend, where each
  service answers for its own data.
- **Pages load when opened.** Each page is its own chunk, and Recharts loads
  only after sign-in, so the sign-in page stays small.
- **Addresses, no router library.** The page is in the hash (`#/market`), so a
  link opens the same page and Back works.
- **No state library.** React state, context, and `useSyncExternalStore` for
  the token and the address.

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

## The pages

The navigation follows the order an operator asks the questions in: is it
working, what is the grid doing, what does energy cost, what traded, was it
billed, who took part, and how are the services doing. Every page opens with
its question, and every figure that needs it has a **?** with one or two
sentences of explanation.

| Page          | Answers                                         | Shows                                                                                                                                                                            |
| ------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview      | Is the grid healthy, and what is it doing?      | system status (all operational, degraded or unavailable; n of 4 ready), what needs attention, the grid in four figures, the energy flow, market, trading and billing at a glance |
| Energy        | How much is produced and used, and when?        | produced, used, net, readings; production and use over time; net energy over time; spare energy, energy needed and energy traded; largest producers                              |
| Market        | What does energy cost, and why?                 | the price now between floor and ceiling; the period's prices; price over time; the supply and demand each price came from; energy, money and average price traded                |
| Trading       | Which offers and requests became trades?        | trades made, energy and money traded, energy reserved but not settled; how every trade ended; offered, matched and still unsold; requested, matched and still unmet              |
| Billing       | What was settled, and do the books balance?     | books balanced or not; money, energy and trades settled; credits, debits and net; balances right now; settled over time                                                          |
| Households    | Who produces, uses, sells and buys?             | households seen by each service; highest trading volume and largest producers; searchable, paged lists; a detail panel per household                                             |
| System health | Is every service working, and what is it doing? | each service's state, purpose, response time and dependencies; the path of a meter event; operations; engineering diagnostics; what is deliberately not shown                    |

### What needs attention

The overview and the system page list what is wrong or waiting, most serious
first, each with what it means and a link to the page to look at. Only signals
the system gives are used - nothing is guessed:

| Signal                                  | From                         | Severity |
| --------------------------------------- | ---------------------------- | -------- |
| a service not ready or not answering    | `/health/ready`              | critical |
| credits and debits differ               | billing summary `ledger.net` | critical |
| a page's statistics could not be loaded | the failed request           | warning  |
| trades refused by billing               | trade summary                | warning  |
| meter events dead-lettered or invalid   | trade-matching diagnostics   | warning  |
| trades waiting for billing              | trade summary                | notice   |
| meter events waiting in the outbox      | smart-meter diagnostics      | notice   |
| a service did not report its counters   | the failed request           | notice   |

"No issues detected" is shown only when none of these applies. The navigation
marks each page with the number of items that point to it.

### Books balanced

"Books balanced" appears only when billing's own `ledger.net` for the period is
exactly zero and there is at least one ledger entry; a period with no entries
says so instead of claiming anything. Balances "right now" are labelled as
current, since the API returns them whatever period is chosen.

### System health and events

The system page reads each service's `GET /diagnostics`: the same counters as
`/metrics`, as JSON, for the operator token. It follows a meter reading from
the smart meter (readings, repeats), through the outbox to the message broker
(created, delivered, failed attempts, waiting now), to trade matching
(processed, duplicates, retries, dead-lettered, invalid). It also shows
matching runs, trades reserved, billing's answers, ledger recordings and price
recalculations, and - folded away for engineers - requests by status class,
average response time and dependency failures per service.

Every counter starts from zero when its service starts; each section says
since when it has been counting. A counter the service did not report is "Not
reported", never zero. The broker's management interface and credentials are
not exposed to the browser, and no broker API was added: the event figures are
what the services counted themselves.

### The period

`from` and `to` are UTC and half open, exactly as the API takes them. The
presets end at the moment of the refresh and slide forward with it; custom
dates stay where they were put and include both days. Custom dates are checked
before they are sent - start before end, not in the future, at most 366 days -
so the dashboard never sends a period the API would refuse, and it picks a
bucket (hour, day or week) that stays inside the API's bucket limits. The
selected period, its bucket and "all times are UTC" are written beside the
control.

### Numbers

Every figure is shown as the API returned it. Energy, prices and money arrive
as decimal strings and stay strings: digits are grouped by working on the
text. The one sum the dashboard makes itself is a household's energy traded
(sold plus bought), added exactly on scaled integers, never in floating point.
The only place a value becomes a JavaScript number is the position of a mark
on a chart; the tooltip and the table show the original string.

An average with nothing to average is `null` in the API and a gap in a chart,
never zero. A quiet bucket is zeros because the API says it was zero.

### Charts

Each chart shows one measure, or measures in one unit, on one axis: there are
no dual axes. Measures in different units sit side by side as separate charts
whose crosshairs move together (price, the supply and demand behind it, and
energy, money and average price traded). Every chart has a title, a legend,
exact values in its tooltip, a **Show table** twin, and an empty state that
says what is missing instead of drawing nothing. Status colours are reserved
for status and always come with an icon and a word.

### Loading, errors, empty

- **First load:** placeholders the size of what is coming.
- **Refreshing:** the figures stay on screen, dimmed, until the new ones
  arrive - no flash back to placeholders.
- **A failed section:** says which part failed in plain words ("Unable to load
  energy statistics. Smart meter could not be reached.") with the request's
  correlation id, and tries again on the next refresh. No stack traces, SQL or
  raw responses, because none reach the browser.
- **Nothing in the period:** says so ("No trades were settled in this
  period.") instead of drawing an empty chart.
- **Something unexpected while rendering:** an error boundary replaces the page
  with a plain message and a reload button rather than leaving it blank.

### Refreshing

**Refresh** reloads everything now. **Auto refresh** (on by default) does the
same every 30 seconds, skipping a tick while the previous refresh is still
running and while the tab is hidden; coming back to a tab that was hidden for
longer than that refreshes at once. A new refresh or period cancels the
requests it replaces, so answers never arrive out of order. The top bar says
how old the figures are ("Updated 12 s ago").

## Accessibility

- Every page is audited with axe-core in the tests (colour contrast is checked
  by hand, since jsdom does not paint).
- Opening a page moves focus to its heading, so screen readers announce it; a
  skip link jumps to the content.
- Every chart has a **Show table** button that shows every value it draws.
- Status is always an icon and a word ("Ready", "Degraded", "Unavailable",
  "Books balanced"), never colour alone; the navigation's counts are read out
  as "2 items to look at".
- Keyboard: every control is reachable, focus is always visible, household
  tabs follow the arrow keys, and the household panel keeps focus inside
  itself, closes on Escape and gives focus back to what opened it.
- The layout reflows down to a phone's width: the sidebar becomes a row of
  tabs, and wide tables scroll inside their card rather than the page.

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
cancellation, a 5xx that must not leak); sign-in and the session; the shell and
navigation (addresses, one load shared by every page, attention badges); the
overview (status, issues, grid figures, energy flow, snapshots); every page's
figures, charts, tables and empty states; the price band, trade outcomes, books
status, household lists and detail panel; the system page's services, event
pipeline, operations and diagnostics, including a service that does not
report; outages; the period; refresh, auto refresh and a hidden tab; the pure
logic (status, attention, counters, formats, addresses); and an axe-core audit
of the sign-in page, every page, the household panel and a chart table.

## Known limitations

- **The token is readable by script on the page.** The content security policy
  narrows what could run there; an HttpOnly session would need a backend
  change.
- **Counters restart with their service.** Event and operation counts on the
  system page are since each service last started, not all time.
- **No queue depths.** The broker's queue lengths and the dead-letter queue's
  contents need broker credentials and stay out of the browser; the dashboard
  shows what the services counted.
- **Rankings follow the services' orders.** Households are ranked only by what
  the API sorts by - money moved in trades, energy produced - never re-ranked in
  the browser from one page of results.
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
