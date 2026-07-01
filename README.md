# Market Dashboard

A mobile dashboard of market/economic indicators + live prices for a watchlist of symbols (ZAR),
auto-refreshed by a scheduled GitHub Actions job and served as a password-gated static site.

No quantities, cost basis, position values, or P&L are stored or shown anywhere — just prices
and daily % change for whatever symbols you list in the config files.

## How it works

1. **`scripts/fetch-data.mjs`** runs server-side (in GitHub Actions, or locally with
   `node scripts/fetch-data.mjs`). It fetches Yahoo Finance quotes, forex, World Bank macro data,
   live SARB policy rates + monthly CPI/PPI, and the IMF's global growth/inflation aggregate —
   for whatever's listed in `config/metrics.json` and `config/watchlist.json` — and writes
   `public/data.json`.
2. **`.github/workflows/fetch-data.yml`** runs that script every 30 minutes, 07:00-23:30 SAST on
   weekdays, and commits `public/data.json` if it changed.
3. **`public/index.html`** is a static page that reads `data.json` and renders the dashboard. It's
   a PWA (manifest + service worker) so Android can "Add to Home screen" and it behaves like an app.
4. Because this repo is **private**, and Yahoo Finance blocks direct browser calls anyway, the
   page must be hosted somewhere that serves your private repo's `public/` folder to *only you*.
   **Cloudflare Pages + Cloudflare Access** does this for free: Pages builds straight from your
   private GitHub repo, and Access puts a login (email one-time-code) in front of the URL.

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

After editing any of these, either wait for the next scheduled run or trigger one manually
(**Actions tab → Fetch market data → Run workflow**) to see the change reflected.

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

## One-time setup

### 1. Push this repo to GitHub (private)

```
cd fin-dashboard
git init
git add .
git commit -m "Initial dashboard"
gh repo create fin-dashboard --private --source=. --remote=origin --push
```

(If you'd rather click through the UI: create a new **private** repo on github.com, then
`git remote add origin <url>` and `git push -u origin main`.)

### 2. Connect Cloudflare Pages

1. Sign up / log in at https://dash.cloudflare.com (free plan is enough).
2. **Workers & Pages → Create → Pages → Connect to Git.**
3. Authorize Cloudflare's GitHub App and grant it access to just the `fin-dashboard` repo
   (not all your repos).
4. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave empty)
   - **Build output directory:** `public`
5. Deploy. You'll get a URL like `https://fin-dashboard-xyz.pages.dev`.

Every time the Actions bot commits a new `data.json` (every 30 min), Cloudflare Pages
auto-redeploys in a few seconds.

### 3. Lock it down with Cloudflare Access

1. In the Cloudflare dashboard: **Zero Trust → Access → Applications → Add an application →
   Self-hosted**.
2. Application domain: your `*.pages.dev` URL from step 2.
3. Add a policy: **Allow**, Include → **Emails** → your own email address only.
4. Save. Now visiting the URL prompts for your email, sends a one-time code, and only lets you in.

This is free for up to 50 users and means the portfolio numbers are not publicly visible to
anyone who guesses or finds the URL.

**Optional — only if you're setting up the KWGT widget below:** add a second Access application
scoped to just the JSON path, so a widget app can fetch it without an interactive login:
1. **Add an application → Self-hosted** again, with path `yourapp.pages.dev/data.json`
   (more specific paths take priority over the broader one from step above).
2. Policy: **Bypass** (not Allow) — this leaves the JSON world-readable while the HTML page
   stays behind the email login. Since `data.json` only ever contains market prices/macro
   stats (no personal amounts), this is a low-risk trade-off.

### 4. Turn on GitHub Actions

Nothing to do — the workflow in `.github/workflows/fetch-data.yml` runs automatically on the
cron schedule once it's pushed to GitHub. You can also trigger it manually: **Actions tab →
Fetch market data → Run workflow**.

### 5. Add to your Android home screen

1. On your phone, open the Cloudflare Pages URL in **Chrome** and log in via the Access email
   prompt (once — Access will remember your device for a while).
2. Tap the **⋮** menu → **Add to Home screen** (Chrome may also show an automatic "Install app"
   banner — either works).
3. Confirm. An icon appears on your home screen that opens the dashboard full-screen, like an app.

If the Access login session expires, opening the home-screen icon will just show the login
prompt again first — tap through it and you're back in.

## About Android/Samsung home-screen widgets

You asked for this to be usable as a widget on a Samsung phone — worth being upfront about what's
actually possible here rather than overpromising:

**A real Android home-screen widget (the kind that sits on your home screen showing live numbers
without opening an app) cannot be created from a website or PWA.** That's an Android platform
limitation, not something skipped for convenience — widgets are backed by a native
`AppWidgetProvider`, which only a compiled native/Kotlin app can register. No amount of PWA
manifest configuration produces one.

What **is** real and already delivered: "Add to Home screen" (see below) gives you a one-tap icon
that opens the full dashboard instantly, feels app-like (no browser chrome), and is the standard,
supported way to get a web app onto an Android home screen.

If you specifically want a *glanceable tile* (not just an icon), the practical option is a
generic third-party widget app that can poll a URL and render the numbers itself — most popular
on Samsung is **KWGT (Kustom Widget Maker)** (free, Play Store), which supports pulling JSON from
a URL and templating text/values onto a home-screen widget you design.

I can't build or test the actual KWGT widget myself — it's configured inside the KWGT app on
your phone, not something scriptable from here. What I *have* done: added a small flattened
`widget` object at the top of `data.json` (see `scripts/fetch-data.mjs`) specifically so KWGT's
formula editor doesn't have to dig through nested arrays — just flat fields:

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

This set (USD/ZAR, JSE Top 40 + its daily move, S&P 500's daily move, SA repo rate, SA's latest
inflation print, and BTC/USD) is a reasonable "at a glance" starting point — edit the `widget:`
block in `scripts/fetch-data.mjs` to swap in whatever handful of numbers you actually want to see
without opening the app.

**Setup once the site is deployed** (needs the Cloudflare Access bypass rule from step 3 above,
so KWGT can fetch the JSON without hitting a login page):

1. Install **KWGT** from the Play Store (also install **KWGT-styled widget pack** if prompted —
   it's the free companion needed to actually place widgets).
2. Long-press your home screen → **Widgets → Kustom Widget → Kustom Widget** → drop it anywhere.
3. In the KWGT editor: **+ → Global → Web**. Set the URL to
   `https://yourapp.pages.dev/data.json`, and set a refresh interval (e.g. every 30 min, to match
   how often the data actually updates).
4. Add a **Text** module for each number you want visible. In each module's formula editor, pull
   the value from the web global using KWGT's JSON path syntax — the exact function name has
   changed across KWGT versions, so check KWGT's own in-app formula help for "web" / "JSON path"
   examples, but the field path itself is simply e.g. `widget.usdZar`, `widget.jseTop40ChangePct`,
   `widget.saInflationLatestPct` (matching the flattened block above one-to-one).
5. Style/position the text modules, save, and resize the widget on your home screen.

The heavy lifting (making the data simple to reach and hosting it somewhere KWGT can actually
fetch it from) is done; the widget's visual layout is a matter of taste you build in the KWGT
app itself.

## Local testing

```
node scripts/fetch-data.mjs      # regenerates public/data.json using live data
python -m http.server 4173 --directory public   # serve locally to preview
```
