# Market Dashboard

A mobile dashboard of market/economic indicators + live prices for a watchlist of symbols (ZAR),
auto-refreshed by a scheduled Cloudflare Worker and served as a static site.

No quantities, cost basis, position values, or P&L are stored or shown anywhere — just prices
and daily % change for whatever symbols you list in the config files. The repo is **public**
(confirmed clean of any personal figures, including full git history) — the only thing it
reveals is which tickers are in the watchlist, which you've said is fine.

## 🚀 Finish setup — do these in order

Everything code-side is done, tested, and pushed. Only one step is left, and it needs your own
account (Cloudflare doesn't let me create it for you — sign-up needs your own email/password):

1. **Create a Cloudflare account** — [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up),
   free plan is enough. Reply once you're logged in.
2. From there I'll run `wrangler login` (opens a browser tab for you to authorize), generate a
   fresh GitHub token scoped to just this repo's contents (your email's already verified for
   this — I confirmed the "sudo mode" check passed), pipe it straight into
   `wrangler secret put GITHUB_TOKEN` without it ever being displayed or saved anywhere, deploy
   the Worker, connect Cloudflare Pages to this GitHub repo, and give you the final URL.
3. **Add to your phone** — open that URL on Android Chrome, tap ⋮ → **Add to Home screen**. Done.
   (See "Home screen & widgets" below for what's realistic re: a true widget vs. an app icon.)

*(Note: I did generate one token earlier to test the flow, then deleted it unused rather than
store it anywhere — Claude Code's own safety checks correctly blocked me from writing a raw
credential to disk "just in case." A fresh one gets created and consumed in a single step once
Cloudflare's ready, which is the right way to do it anyway.)*

Everything below this point is reference material — how it works, how to customize it, and the
full manual steps in case you'd rather drive any part of this yourself.

## How it works

1. **`scripts/lib/build-data.mjs`** is the platform-agnostic core: fetches Yahoo Finance quotes,
   forex, World Bank macro data, live SARB policy rates + monthly CPI/PPI, and the IMF's global
   growth/inflation aggregate, for whatever's listed in `config/metrics.json` and
   `config/watchlist.json`. It has no filesystem/process access, so it runs unchanged in two
   places:
   - **`scripts/fetch-data.mjs`** — Node entry point, for running locally (`node scripts/fetch-data.mjs`).
   - **`worker/src/index.mjs`** — Cloudflare Worker entry point, for the real scheduled job. Runs
     on a Cron Trigger every 30 min (07:00–23:30 SAST, weekdays — see `worker/wrangler.toml`),
     then commits the result straight to `public/data.json` in this repo via the GitHub API.
2. **`public/index.html`** is a static page that reads `data.json` and renders the dashboard. It's
   a PWA (manifest + service worker) so Android can "Add to Home screen" and it behaves like an app.
3. **Cloudflare Pages** serves the `public/` folder and auto-redeploys every time the Worker
   commits a new `data.json` (a few seconds after each scheduled run).

### Why a Cloudflare Worker instead of GitHub Actions?

GitHub Actions was the original plan, but this GitHub account has an account-wide $0 budget on
Actions with "stop usage" enabled until a payment method is added — confirmed this blocks Actions
on *both* private and public repos, it's not a visibility thing. Rather than requiring a card on
file, the scheduled job moved to a Cloudflare Worker instead, since Cloudflare Pages was already
in the plan for hosting. Free plan Cron Triggers cover this comfortably.

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

(This is what I'll drive once you've completed the Cloudflare signup above — included here in
case you'd rather do any of it yourself.)

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
`worker/wrangler.toml` takes over from there automatically.

To trigger it once by hand (e.g. to verify it works, or to refresh data immediately after
editing a config file): visit the Worker's `*.workers.dev` URL that `wrangler deploy` prints —
opening it in a browser (or `curl`) runs the fetch-and-commit job on demand and returns
`{"ok":true,...}` or an error.

### 3. Connect Cloudflare Pages

1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git.**
2. Authorize Cloudflare's GitHub App and grant it access to the `fin-dashboard` repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave empty)
   - **Build output directory:** `public`
4. Deploy. You'll get a URL like `https://fin-dashboard-xyz.pages.dev`.

Every time the Worker commits a new `data.json` (every 30 min), Cloudflare Pages auto-redeploys
in a few seconds.

### 4. (Optional) Lock the page behind a login

The repo and its data are already public/non-sensitive, so this is optional polish, not a
requirement. If you'd still like a login prompt on the page itself:
1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Application domain: your `*.pages.dev` URL.
3. Policy: **Allow**, Include → **Emails** → your own address only.

### 5. Add to your Android home screen

1. On your phone, open the Cloudflare Pages URL in **Chrome**.
2. Tap the **⋮** menu → **Add to Home screen** (Chrome may also show an automatic "Install app"
   banner — either works).
3. Confirm. An icon appears on your home screen that opens the dashboard full-screen, like an app.

## Home screen & widgets — what's realistic

**A real Android home-screen widget (the kind that sits on your home screen showing live numbers
without opening an app) cannot be created from a website or PWA.** That's an Android platform
limitation — widgets are backed by a native `AppWidgetProvider`, which only a compiled
native/Kotlin app can register. What's real and already built: "Add to Home screen" above, which
gives a one-tap app-like icon.

If you want an actual glanceable tile, use a third-party widget app — **KWGT (Kustom Widget
Maker)** (free, Play Store) is the most popular on Samsung, and can poll a URL and template
values onto a home-screen widget you design. `data.json` has a flattened `widget` object made
for exactly this (no nested arrays to dig through):

```json
"widget": {
  "generatedAt": "2026-07-01T20:13:00.642Z",
  "usdZar": 16.38,
  "jseTop40": 101276.41,
  "jseTop40ChangePct": -1.31,
  "spx500ChangePct": 1.70,
  "saRepoRate": 7,
  "saInflationLatestPct": 4.5,
  "btcUsd": 59862.78
}
```

Edit the `widget:` block in `scripts/lib/build-data.mjs` to change which figures are included.

**KWGT setup** (once Pages is deployed — the repo being public means `data.json` is reachable
with no login, so this needs no special bypass config):
1. Install **KWGT** from the Play Store (and the free KWGT companion pack if prompted).
2. Long-press your home screen → **Widgets → Kustom Widget** → drop it anywhere.
3. In the KWGT editor: **+ → Global → Web**. URL: `https://yourapp.pages.dev/data.json`, refresh
   interval ~30 min.
4. Add a **Text** module per number you want visible; pull each value via KWGT's JSON path syntax
   (check KWGT's in-app formula help for exact function names, they vary by version) — the field
   paths themselves are simply `widget.usdZar`, `widget.jseTop40ChangePct`, etc., matching the
   block above one-to-one.
5. Style/position, save, resize on your home screen.

I can't build/test the actual widget myself since it's configured entirely inside the KWGT app
on your phone — everything on the data/hosting side is done to make that step as easy as possible.

## Local testing / manual trigger

```
node scripts/fetch-data.mjs                        # regenerates public/data.json using live data
python -m http.server 4173 --directory public       # serve locally to preview

cd worker && npx wrangler dev --local               # run the Worker locally
curl http://127.0.0.1:8787/                          # trigger it manually, see the JSON result
```
