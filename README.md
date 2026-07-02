# Market Dashboard

A mobile dashboard of market/economic indicators + live prices for a watchlist of symbols (ZAR),
auto-refreshed by a scheduled Cloudflare Worker and served as a static site on GitHub Pages.

No quantities, cost basis, position values, or P&L are stored or shown anywhere — just prices
and daily % change for whatever symbols you list in the config files. The repo is **public**
(confirmed clean of any personal figures, including full git history) — the only thing it
reveals is which tickers are in the watchlist, which you've said is fine.

## ✅ It's live

**https://deanzulberg.github.io/fin-dashboard/**

**Add to your Android home screen:** open that URL in Chrome → tap **⋮** → **Add to Home screen**
(or use the automatic "Install app" banner if Chrome shows one). You now have an app-like icon
that opens the dashboard full-screen. Data refreshes automatically every 30 min during SA market
hours (07:00–23:30 SAST, weekdays) — just reopen the page to see the latest.

Everything below this point is reference material — how it works, how to customize it, and the
full manual steps in case you ever need to redo any part of this.

## How it works

1. **`scripts/lib/build-data.mjs`** is the platform-agnostic core: fetches Yahoo Finance quotes,
   forex, World Bank macro data, live SARB policy rates + monthly CPI/PPI, and the IMF's global
   growth/inflation aggregate, for whatever's listed in `config/metrics.json` and
   `config/watchlist.json`. It has no filesystem/process access, so it runs unchanged in two
   places:
   - **`scripts/fetch-data.mjs`** — Node entry point, for running locally (`node scripts/fetch-data.mjs`).
   - **`worker/src/index.mjs`** — Cloudflare Worker entry point, for the real scheduled job. Runs
     on a Cron Trigger every 30 min (07:00–23:30 SAST, weekdays — see `worker/wrangler.toml`),
     then commits the result straight to `docs/data.json` in this repo via the GitHub API. It
     deploys with `workers_dev = false` — it only needs to run on a schedule, never a public URL.
2. **`docs/index.html`** is a static page that reads `data.json` and renders the dashboard. It's
   a PWA (manifest + service worker) so Android can "Add to Home screen" and it behaves like an
   app. It lives in `docs/` (not `public/`) because that's the folder name GitHub Pages' classic
   branch-source deploy requires.
3. **GitHub Pages** serves the `docs/` folder directly from this repo and auto-redeploys every
   time the Worker commits a new `data.json` (a minute or two after each scheduled run).

### Why a Cloudflare Worker instead of GitHub Actions?

GitHub Actions was the original plan for the scheduled *data-fetch* job, but this GitHub account
has an account-wide $0 budget on Actions with "stop usage" enabled until a payment method is
added — confirmed this blocks custom Actions workflows on *both* private and public repos, it's
not a visibility thing. So that one job moved to a Cloudflare Worker (free plan Cron Triggers)
instead. GitHub Pages' own *build/deploy* still runs through Actions behind the scenes, but that
particular workflow isn't blocked by the same budget setting — only custom workflows are.

## Adding, removing, or changing metrics

Everything shown on the dashboard is driven by three config files — no code changes needed:

- **`config/metrics.json`** — forex currencies, commodities, indices, crypto. Add/remove/edit
  entries as `{ "symbol": "<yahoo ticker>", "name": "<display name>" }` (forex just needs a
  3-letter currency code in the `forexCurrencies` array).
- **`config/watchlist.json`** — the symbols you personally want prices for, grouped under any
  labels you like (e.g. "JSE", "TFSA", "US"). Each group needs `priceUnits` (`"cents"` for JSE
  tickers, since Yahoo returns ZA cents; `"units"` for USD tickers) and a `symbols` array of
  `{ "symbol": "...", "name": "..." }`.
- **`config/rates.json`** — fallback SA policy rates (Prime, Repo, JIBAR 3M), only used if the
  live SARB fetch fails on a given run.

After editing any of these and pushing, either wait for the next scheduled Worker run or trigger
one manually (see "Local testing / manual trigger" below) to see the change reflected.

## Macro indicators

The dashboard shows regional macro data automatically, no manual entry:

- **SA policy rates** (Prime, Repo, JIBAR 3M) — fetched live every run from SARB's free public
  Web API (`custom.resbank.co.za/SarbWebApi`), no key required. Falls back to
  `config/rates.json` if that request fails.
- **South Africa** — inflation is fetched from the same SARB API as a ~3-year monthly series
  (headline CPI, year-on-year), so the dashboard shows the latest month, the current quarter's
  average, and the year-to-date average — not just one annual figure. GDP growth and
  unemployment come from the World Bank (annual). PPI (producer prices) is a bonus, since it's
  in the same SARB payload as CPI.
- **United States / United Kingdom** — inflation, GDP growth, and unemployment, all World Bank
  annual figures.
- **Global** — GDP growth and inflation from the IMF's World Economic Outlook (DataMapper API,
  also free/no-key). World Bank's own global aggregate (`country=WLD`) turned out to return
  HTTP 502 server errors for every growth-rate indicator we tried during testing — a bug on
  their end — so the IMF is used instead for anything "global." Note: the IMF WEO dataset
  always includes a current-year projection, so a Global tile labelled "this year" may in
  practice be a forecast rather than a finalised outturn.
- **Risk & Rates** — VIX, US 10-year Treasury yield, and the US Dollar Index (all Yahoo Finance),
  plus South Africa's 10-year bond yield (bonus from the same free SARB API used for policy rates).

To add another country, add an entry under `macroCountries` in `config/metrics.json` with its
World Bank country code (e.g. `"de": { "label": "Germany", "worldBankCountry": "DE" }`) — it'll
automatically get inflation/GDP growth/unemployment tiles like US/UK. To add or drop a World
Bank indicator across all countries, edit the `worldBankIndicators` array.

**Parked for later:** biggest single-day movers within JSE Top 40 / S&P 500 / Nasdaq. Doable, but
needs a maintained list of index constituents (Yahoo doesn't expose one for free) to scan and
rank — bigger scope than the rest of this dashboard, so it's deliberately not built yet.

## Full manual deployment steps

(Everything here is already done and live — included in case you ever need to redo any part of
it, e.g. after the GitHub token expires or you want to move the Worker to a new account.)

### 1. Generate a GitHub token for the Worker

1. [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Repository access:** Only select repositories → `fin-dashboard`.
3. **Permissions → Repository permissions → Contents:** Read and write.
4. **Expiration:** 90 days is a reasonable default (not indefinite, not so short you're
   renewing constantly) — just remember it'll need regenerating around then.
5. Generate, copy the token (starts with `github_pat_...`) — paste it straight into step 2
   below and don't save it anywhere else.

### 2. Deploy the Worker

```
cd worker
npx wrangler login                        # opens a browser tab to authorize
npx wrangler secret put GITHUB_TOKEN       # paste the token from step 1 when prompted
npx wrangler deploy
```

This registers the Worker and its Cron Trigger on your Cloudflare account — the schedule in
`worker/wrangler.toml` takes over from there automatically. It deploys with no public URL
(`workers_dev = false`), so there's no manual HTTP trigger in production — use
`wrangler dev --local` (see "Local testing" below) to test changes before pushing.

One-time account setup the very first time you ever deploy any Worker: Cloudflare requires
claiming a free `workers.dev` subdomain before it'll accept *any* Worker deploy, even one with
no public route. If `wrangler deploy` errors asking for this and the dashboard toggle for it
doesn't respond (it can be flaky), create a scoped API token at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
("Edit Cloudflare Workers" template) and call the API directly:
`PUT https://api.cloudflare.com/client/v4/accounts/<account_id>/workers/subdomain` with body
`{"subdomain": "<any-name>"}` and `Authorization: Bearer <token>`. One-time only, already done.

### 3. Enable GitHub Pages

```
gh api repos/deanzulberg/fin-dashboard/pages -X POST \
  -f "source[branch]=master" -f "source[path]=/docs"
```

Or via the UI: repo **Settings → Pages → Source: Deploy from a branch → Branch: master, /docs**.
Note: `docs/.nojekyll` must exist (already committed) or the build fails — GitHub's classic Pages
builder runs everything through Jekyll by default, which mangles a plain static site otherwise.

Every time the Worker commits a new `data.json`, GitHub Pages auto-redeploys within a minute or
two (it runs through a first-party GitHub Actions workflow that, unlike custom workflows, isn't
blocked by this account's Actions budget setting).

### 4. Add to your Android home screen

1. On your phone, open **https://deanzulberg.github.io/fin-dashboard/** in **Chrome**.
2. Tap the **⋮** menu → **Add to Home screen** (Chrome may also show an automatic "Install app"
   banner — either works).
3. Confirm. An icon appears on your home screen that opens the dashboard full-screen, like an app.

## Home screen widgets

**A real Android home-screen widget (the kind that sits on your home screen showing live numbers
without opening an app) cannot be created from a website or PWA.** That's an Android platform
limitation — widgets are backed by a native `AppWidgetProvider`, which only a compiled
native/Kotlin app can register. The workaround is a third-party "webpage as widget" app —
**WebsiteWidget** — which screenshots/renders a URL into a home-screen tile on a timer.
`docs/widget.html` is built for exactly this: a compact 2-column tile layout (instead of the
full scrolling dashboard) that reuses the main dashboard's colours, flags, and styling.

**WebsiteWidget setup:**
1. Install **WebsiteWidget** from the Play Store.
2. Long-press your home screen → **Widgets → WebsiteWidget** → drop it anywhere, then resize to
   roughly a 2×2 or 2×3 footprint (the tile layout is designed for that shape).
3. Point it at: `https://deanzulberg.github.io/fin-dashboard/widget.html`
4. Set the refresh interval to **~30 min**, matching how often the Worker updates `data.json` —
   refreshing more often just reloads the same data.

**Multiple widgets for different sections:** `widget.html` reads a `?section=` query parameter,
so you can add several WebsiteWidget instances, each pinned to a different part of the market
picture instead of one page trying to show everything. Supported values:

| `?section=` value | Shows |
|---|---|
| `forex` | USD/EUR/GBP/CNY vs ZAR |
| `commodities` | Gold, silver, Brent crude, platinum, copper, natural gas |
| `indices` | JSE Top 40/All Share, S&P 500, Nasdaq, Dow, FTSE |
| `crypto` | BTC, ETH |
| `risk` | VIX, US 10Y yield, US Dollar Index |
| `rates` | SA prime/repo rate, JIBAR 3M, 10Y bond |
| `inflation` | SA CPI — latest month, quarter average, YTD average |
| `headlines` | Curated mix: USD/GBP, gold/silver/Brent/nat gas, JSE All Share, S&P 500, BTC, SA inflation (default if `?section=` is omitted or unrecognised) |

Example: `https://deanzulberg.github.io/fin-dashboard/widget.html?section=crypto` for a
BTC/ETH-only widget.

> **Deprecated:** an earlier version of this README documented a KWGT (Kustom Widget Maker) setup
> that polled the flattened `widget` object in `data.json` directly and required manually wiring
> up JSON-path text modules per field. `widget.html` replaces that — it's simpler to set up (one
> URL, no per-field formulas) and already styled, so KWGT is no longer the recommended approach.

## Local testing / manual trigger

```
node scripts/fetch-data.mjs                        # regenerates docs/data.json using live data
python -m http.server 4173 --directory docs         # serve locally to preview

cd worker && npx wrangler dev --local               # run the Worker locally (needs .dev.vars
                                                     # with GITHUB_TOKEN=... to test the commit step)
curl http://127.0.0.1:8787/                          # trigger it manually, see the JSON result
```
