# Macro Monitor

A mobile dashboard of **sovereign macroeconomic indicators** across South Africa, the world's
biggest markets, and a set of developing economies — auto-refreshed by a scheduled Cloudflare
Worker **every 3 days** and served as a static site on GitHub Pages.

These are slow-moving structural indicators (GDP, growth, inflation, debt, etc.), not live
trading data — so the whole thing refreshes on a 3-day cadence rather than intraday. No live
forex / commodity / index / crypto tickers, no watchlist, no home-screen widgets (all removed).

The repo is **public** — it reveals nothing personal, only which countries and indicators are
tracked.

## ✅ It's live

**https://deanzulberg.github.io/fin-dashboard/**

**Add to your Android home screen:** open that URL in Chrome → tap **⋮** → **Add to Home screen**
(or use the automatic "Install app" banner if Chrome shows one). You get an app-like icon that
opens the dashboard full-screen. The underlying data refreshes automatically every 3 days — just
reopen the page to see the latest.

## What it shows

For each country, nine indicators:

| Indicator | Source |
|---|---|
| GDP (nominal, USD) | IMF WEO (annual) |
| Real GDP growth — annual | IMF WEO (annual) |
| Real GDP growth — quarter | `config/countries.json` (`gdpQoQ`, optional/manual) |
| Central/reserve bank policy rate | `config/countries.json` (SA is live from SARB) |
| Inflation (avg CPI) | IMF WEO (annual); SA also shows latest month live from SARB |
| Sovereign credit rating (S&P · Moody's · Fitch) | `config/countries.json` (manual) |
| 10-year government bond yield | `config/countries.json` (SA is live from SARB) |
| Current-account balance (% GDP) | IMF WEO (annual) |
| Government budget balance (% GDP) | IMF WEO (annual) — deficit is negative |
| Government debt (% GDP) | IMF WEO (annual) |

Countries are grouped into **Home market** (South Africa), **Major markets** (US, China, Japan,
Germany, UK, India, UAE, Saudi Arabia) and **Emerging & developing markets** (Brazil, Nigeria,
Egypt, Kenya, Zambia, Zimbabwe).

## How it works

1. **`scripts/lib/build-data.mjs`** is the platform-agnostic core: it fetches the six numeric
   annual indicators from the **IMF World Economic Outlook DataMapper** (a free, no-key API —
   one request per indicator returns every economy at once), reads the hand-maintained
   slow-moving fields from `config/countries.json`, and overlays South Africa's live repo rate,
   10y bond yield and latest-month CPI from the **SARB Web API**. It has no filesystem/process
   access, so it runs unchanged in two places:
   - **`scripts/fetch-data.mjs`** — Node entry point, for running locally (`node scripts/fetch-data.mjs`).
   - **`worker/src/index.mjs`** — Cloudflare Worker entry point, the real scheduled job. Runs on a
     Cron Trigger **once every 3 days** at 05:00 UTC (see `worker/wrangler.toml`), then commits the
     result straight to `docs/data.json` via the GitHub API. Deploys with `workers_dev = false` —
     it only runs on a schedule, never needs a public URL.
2. **`docs/index.html`** is a static PWA that reads `data.json` and renders one coloured panel per
   country. It lives in `docs/` because that's the folder GitHub Pages' branch-source deploy uses.
3. **GitHub Pages** serves `docs/` directly and auto-redeploys each time the Worker commits a new
   `data.json`.

### Why a Cloudflare Worker instead of GitHub Actions?

GitHub Actions was the original plan for the scheduled data-fetch job, but this account has an
account-wide $0 Actions budget with "stop usage" enabled, which blocks custom Actions workflows
on both private and public repos. So that job moved to a Cloudflare Worker (free-plan Cron
Triggers). GitHub Pages' own build/deploy still runs through Actions behind the scenes, but that
first-party workflow isn't blocked by the budget setting — only custom workflows are.

## Adding, removing, or changing indicators & countries

Everything is driven by two config files — no code changes needed:

- **`config/countries.json`** — the list of countries (in display order, grouped by `group`:
  `home` / `major` / `emerging`), each with its flag code, panel colour, central-bank name, and
  the **manually-maintained slow-moving fields**: `policyRate`, `creditRating`, `bond10y`, and the
  optional `gdpQoQ` (latest-quarter real GDP growth). These have no reliable free/no-key API, so
  update the values and their `asOf` dates by hand occasionally. Seed values are best-effort recent
  figures — verify before relying on them. For South Africa, `policyRate` and `bond10y` are
  overwritten with live SARB data every run, so the SA seeds are only a fallback.
- **`config/metrics.json`** — the IMF WEO indicators to fetch, as
  `{ "key": "...", "code": "<WEO code>", "label": "..." }`. To add another IMF indicator across all
  countries, add an entry here; to add another country, add it to `config/countries.json` with its
  ISO-3 `code` (the IMF figures are matched by that code).

`config/rates.json` remains only as a last-resort fallback for SA's repo rate if the SARB API is
unreachable.

After editing, either wait for the next scheduled Worker run or trigger one manually (see below).

## Full manual deployment steps

(Everything here is already done and live — included in case you ever need to redo any part of it,
e.g. after the GitHub token expires or you move the Worker to a new account.)

### 1. Generate a GitHub token for the Worker

1. [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Repository access:** Only select repositories → `fin-dashboard`.
3. **Permissions → Repository permissions → Contents:** Read and write.
4. **Expiration:** 90 days is a reasonable default — just remember it'll need regenerating.
5. Generate, copy the token (starts with `github_pat_...`) — paste it into step 2 below and don't
   save it anywhere else.

### 2. Deploy the Worker

```
cd worker
npx wrangler login                        # opens a browser tab to authorize
npx wrangler secret put GITHUB_TOKEN       # paste the token from step 1 when prompted
npx wrangler deploy
```

This registers the Worker and its Cron Trigger on your Cloudflare account — the 3-day schedule in
`worker/wrangler.toml` takes over from there. It deploys with no public URL (`workers_dev = false`).

> **Note:** the schedule and the data pipeline both changed in this revision, so the Worker must be
> re-deployed (`npx wrangler deploy`) for the every-3-days cron and the new IMF/config build to take
> effect. The existing `GITHUB_TOKEN` secret does not need re-entering.

### 3. Enable GitHub Pages

```
gh api repos/deanzulberg/fin-dashboard/pages -X POST \
  -f "source[branch]=master" -f "source[path]=/docs"
```

Or via the UI: repo **Settings → Pages → Source: Deploy from a branch → Branch: master, /docs**.
`docs/.nojekyll` must exist (already committed) or the Jekyll build mangles the static site.

### 4. Add to your Android home screen

1. On your phone, open **https://deanzulberg.github.io/fin-dashboard/** in **Chrome**.
2. Tap **⋮** → **Add to Home screen** (or the automatic "Install app" banner).
3. Confirm — an icon appears that opens the dashboard full-screen, like an app.

## Local testing / manual trigger

```
node scripts/fetch-data.mjs                         # regenerates docs/data.json using live data
python -m http.server 4173 --directory docs          # serve locally to preview

cd worker && npx wrangler dev --local                # run the Worker locally (needs .dev.vars
                                                      # with GITHUB_TOKEN=... to test the commit step)
curl http://127.0.0.1:8787/                           # trigger it manually, see the JSON result
```
