// Platform-agnostic core: fetches market data + builds the dashboard's data.json
// shape. No filesystem or process access here, so this same module runs unchanged
// under Node (scripts/fetch-data.mjs) and inside a Cloudflare Worker
// (worker/src/index.mjs) — both just call buildData({ metrics, watchlist, ratesFallback })
// and decide separately where the result gets written.

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};

async function fetchJson(url, opts = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) {
        console.error(`FAILED after ${retries + 1} attempts: ${url} -> ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=5d`;
  const json = await fetchJson(url, { headers: YAHOO_HEADERS });
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) {
    console.error(`No usable quote data for ${symbol}`);
    return { symbol, price: null, prevClose: null, changePct: null, currency: null };
  }
  const price = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
  return { symbol, price, prevClose, changePct, currency: meta.currency ?? null };
}

async function fetchAllQuotes(symbols) {
  const unique = [...new Set(symbols)];
  const results = new Map();
  // Sequential with tiny delay: gentler on Yahoo than firing everything at once.
  for (const sym of unique) {
    const q = await fetchYahooQuote(sym);
    results.set(sym, q);
    await new Promise((r) => setTimeout(r, 150));
  }
  return results;
}

async function fetchForex(currencies) {
  const json = await fetchJson("https://open.er-api.com/v6/latest/USD");
  if (!json || json.result !== "success") {
    console.error("Forex fetch failed, forex data will be null");
    return null;
  }
  const r = json.rates; // r.X = units of X per 1 USD
  const zarPerUsd = r.ZAR;
  const zarPer = (code) => (code === "USD" ? zarPerUsd : zarPerUsd / r[code]);
  const out = { asOf: json.time_last_update_utc };
  for (const code of currencies) out[code] = zarPer(code);
  return out;
}

async function fetchWorldBank(countryCode, indicator) {
  const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicator}?format=json&mrv=1`;
  const json = await fetchJson(url);
  const entry = json?.[1]?.[0];
  if (!entry || entry.value == null) return { value: null, year: null };
  return { value: entry.value, year: entry.date };
}

async function fetchWorldBankRegion(countryCode, indicators) {
  const out = {};
  for (const ind of indicators) {
    const { value, year } = await fetchWorldBank(countryCode, ind.code);
    out[ind.key] = round(value);
    out[ind.key.replace(/Pct$/, "Year")] = yearRelative(year);
  }
  return out;
}

// IMF World Economic Outlook DataMapper: the only reliable free "whole world" aggregate
// we found. World Bank's own WLD aggregate returns HTTP 502 for every growth-rate/ratio
// indicator we tried (population-style level indicators work, rates don't) — a server-side
// bug on their end, not a client issue, so we don't rely on it here.
async function fetchImfWorld(code) {
  const json = await fetchJson(`https://www.imf.org/external/datamapper/api/v1/${code}/WEOWORLD`);
  const series = json?.values?.[code]?.WEOWORLD;
  if (!series) return { value: null, year: null };
  const currentYear = new Date().getUTCFullYear();
  const years = Object.keys(series)
    .map(Number)
    .filter((y) => y <= currentYear)
    .sort((a, b) => a - b);
  if (!years.length) return { value: null, year: null };
  const year = years[years.length - 1];
  // Note: IMF WEO always includes a current-year projection, so "this year" here
  // may in practice be a forecast rather than an outturn.
  return { value: series[String(year)], year: yearRelative(year) };
}

// SARB Web API (custom.resbank.co.za) is a free, unauthenticated, no-key JSON API — no
// scraping needed. Used for live policy rates and monthly CPI/PPI (World Bank only has
// annual figures, too coarse for the quarterly/YTD inflation breakdown).
const SARB_BASE = "https://custom.resbank.co.za/SarbWebApi";

async function fetchSarbRates(fallback) {
  const json = await fetchJson(`${SARB_BASE}/WebIndicators/CurrentMarketRates`);
  const find = (code) => json?.find((r) => r.TimeseriesCode === code)?.Value;
  const primeRate = find("MMRD000A");
  const repoRate = find("MMRD002A");
  const jibar3m = find("MMRD403A");
  const bond10y = find("CMJD004A"); // "10 years and longer" daily average bond yield — a bonus, not in the fallback
  if (primeRate == null || repoRate == null || jibar3m == null) {
    console.error("SARB live rates unavailable, using config/rates.json fallback");
    return { ...fallback, source: "config fallback" };
  }
  return {
    primeRate: round(primeRate),
    repoRate: round(repoRate),
    jibar3m: round(jibar3m),
    bond10y: round(bond10y),
    asOf: new Date().toISOString().slice(0, 10),
    source: "SARB live",
  };
}

// Summarizes a monthly year-on-year % series (e.g. CPI) into latest/quarter/YTD averages.
function summarizeMonthlySeries(rows) {
  if (!rows.length) return null;
  const avg = (arr) => arr.reduce((s, r) => s + r.value, 0) / arr.length;

  const latest = rows[rows.length - 1];
  const year = latest.period.getUTCFullYear();
  const quarter = Math.floor(latest.period.getUTCMonth() / 3);
  const quarterMonths = [quarter * 3, quarter * 3 + 1, quarter * 3 + 2];
  const quarterRows = rows.filter(
    (r) => r.period.getUTCFullYear() === year && quarterMonths.includes(r.period.getUTCMonth())
  );
  const ytdRows = rows.filter((r) => r.period.getUTCFullYear() === year);

  return {
    latestPct: round(latest.value),
    quarterAvgPct: round(avg(quarterRows)),
    quarterNum: quarter + 1, // 1-4, always derived from the latest data point, never hardcoded
    ytdAvgPct: round(avg(ytdRows)),
    yearLabel: yearRelative(year),
  };
}

async function fetchSarbCpiPpi() {
  // Graph #4 on SARB's "release of selected data" page happens to be headline CPI + PPI,
  // 12-term (year-on-year) % change, ~3 years of monthly history.
  const json = await fetchJson(`${SARB_BASE}/WebIndicators/ReleaseOfSelectedData/EconomicIndicators/4`);
  if (!json) return { cpi: null, ppi: null };
  const seriesRows = (code) =>
    json
      .filter((r) => r.TimeseriesCode === code)
      .map((r) => ({ period: new Date(r.Period), value: r.Value }))
      .sort((a, b) => a.period - b.period);
  return {
    cpi: summarizeMonthlySeries(seriesRows("CPI1000F")),
    ppi: summarizeMonthlySeries(seriesRows("PPI1000F")),
  };
}

function round(n, dp = 2) {
  if (n == null || Number.isNaN(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Keeps macro tile labels simple: "this year" / "last year" instead of a literal year number.
function yearRelative(year) {
  if (year == null) return null;
  const y = typeof year === "number" ? year : parseInt(year, 10);
  if (Number.isNaN(y)) return null;
  const current = new Date().getUTCFullYear();
  if (y === current) return "this year";
  if (y === current - 1) return "last year";
  return String(y);
}

function buildWatchlistGroup(group, quotes, usdZar) {
  const symbols = group.symbols.map((s) => {
    const q = quotes.get(s.symbol) || {};
    let price = q.price;
    if (price != null && group.priceUnits === "cents") {
      price = price / 100; // Yahoo returns JSE prices in ZA cents
    }
    const priceZAR =
      group.priceUnits === "units" && price != null && usdZar ? price * usdZar : null;
    return {
      symbol: s.symbol,
      name: s.name,
      price: round(price),
      changePct: round(q.changePct),
      priceZAR: round(priceZAR),
    };
  });
  return { label: group.label, priceUnits: group.priceUnits, symbols };
}

export async function buildData({ metrics, watchlist, ratesFallback }) {
  const watchlistGroups = Object.entries(watchlist).filter(([key]) => key !== "_comment");

  const allSymbols = [
    ...metrics.commodities.map((s) => s.symbol),
    ...metrics.indices.map((s) => s.symbol),
    ...metrics.crypto.map((s) => s.symbol),
    ...(metrics.riskIndicators ?? []).map((s) => s.symbol),
    ...watchlistGroups.flatMap(([, g]) => g.symbols.map((s) => s.symbol)),
  ];

  console.log(`Fetching ${new Set(allSymbols).size} unique symbols from Yahoo Finance...`);
  const [quotes, forex, rates, sarbCpiPpi, saWb, usWb, ukWb, globalGdp, globalInflation] =
    await Promise.all([
      fetchAllQuotes(allSymbols),
      fetchForex(metrics.forexCurrencies),
      fetchSarbRates(ratesFallback),
      fetchSarbCpiPpi(),
      fetchWorldBankRegion(metrics.macroCountries.sa.worldBankCountry, metrics.worldBankIndicators),
      fetchWorldBankRegion(metrics.macroCountries.us.worldBankCountry, metrics.worldBankIndicators),
      fetchWorldBankRegion(metrics.macroCountries.uk.worldBankCountry, metrics.worldBankIndicators),
      fetchImfWorld("NGDP_RPCH"),
      fetchImfWorld("PCPIPCH"),
    ]);

  const mapIndicator = (list) =>
    list.map(({ symbol, name }) => {
      const q = quotes.get(symbol) || {};
      return { symbol, name, price: round(q.price), changePct: round(q.changePct) };
    });

  const usdZar = forex?.USD ?? null;

  const watchlistOut = {};
  for (const [key, group] of watchlistGroups) {
    watchlistOut[key] = buildWatchlistGroup(group, quotes, usdZar);
  }

  // SA inflation is replaced with the live monthly SARB series (latest/quarter/YTD) instead
  // of the coarser World Bank annual figure; GDP growth and unemployment stay World Bank.
  const { inflationPct: _saInflationPct, inflationYear: _saInflationYear, ...saRest } = saWb;
  const regions = {
    sa: {
      label: metrics.macroCountries.sa.label,
      ...saRest,
      inflation: sarbCpiPpi.cpi,
      ppi: sarbCpiPpi.ppi,
    },
    us: { label: metrics.macroCountries.us.label, ...usWb },
    uk: { label: metrics.macroCountries.uk.label, ...ukWb },
    global: {
      label: "Global",
      gdpGrowthPct: round(globalGdp.value),
      gdpGrowthYear: globalGdp.year,
      inflationPct: round(globalInflation.value),
      inflationYear: globalInflation.year,
    },
  };

  const commodities = mapIndicator(metrics.commodities);
  const indices = mapIndicator(metrics.indices);
  const crypto = mapIndicator(metrics.crypto);
  const findBy = (list, symbol) => list.find((x) => x.symbol === symbol);
  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    forex,
    commodities,
    indices,
    crypto,
    riskIndicators: mapIndicator(metrics.riskIndicators ?? []),
    regions,
    rates,
    watchlist: watchlistOut,
    // A handful of flattened, top-level headline figures — no nested arrays to
    // traverse — meant for glanceable Android home-screen widgets (e.g. KWGT)
    // that fetch this JSON directly, rather than the full dashboard.
    widget: {
      generatedAt,
      usdZar: round(usdZar),
      jseTop40: findBy(indices, "^J200.JO")?.price ?? null,
      jseTop40ChangePct: findBy(indices, "^J200.JO")?.changePct ?? null,
      spx500ChangePct: findBy(indices, "^GSPC")?.changePct ?? null,
      saRepoRate: rates.repoRate ?? null,
      saInflationLatestPct: regions.sa.inflation?.latestPct ?? null,
      btcUsd: findBy(crypto, "BTC-USD")?.price ?? null,
    },
  };
}
