// Platform-agnostic core: fetches sovereign macro data + builds the dashboard's
// data.json shape. No filesystem or process access here, so this same module runs
// unchanged under Node (scripts/fetch-data.mjs) and inside a Cloudflare Worker
// (worker/src/index.mjs) — both just call buildData({ metrics, countries, ratesFallback })
// and decide separately where the result gets written.
//
// Data sources (all free, no API key):
//   - IMF World Economic Outlook (WEO) DataMapper: the six annual numeric macro
//     indicators (GDP, real growth, inflation, current account, budget balance, debt),
//     one request per indicator covering every economy at once.
//   - SARB Web API: live South African repo rate and 10y bond yield (overrides the
//     hand-maintained seeds in config/countries.json for SA only), plus monthly CPI
//     detail for a South Africa latest-month inflation figure.
// Everything else on a country (central-bank policy rate, credit rating, bond yield,
// quarterly GDP) has no reliable free feed and is read straight from config/countries.json.

async function fetchJson(url, opts = {}, retries = 0) {
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

// IMF WEO DataMapper returns EVERY economy for a given indicator in one response
// (the country path segment is ignored server-side), so we fetch once per indicator
// and index into it per country — 6 requests total, well within the Worker's budget.
// Shape: { values: { CODE: { ISO3: { "1980": n, ..., "2031": n } } } }.
async function fetchImfIndicator(code) {
  const json = await fetchJson(`https://www.imf.org/external/datamapper/api/v1/${code}`);
  return json?.values?.[code] ?? null;
}

// Latest year at or before the current calendar year. WEO always carries current-year
// estimates and future-year projections; clamping to <= current year prefers the
// nearest-to-actual figure rather than a multi-year-out forecast.
function latestValue(series) {
  if (!series) return { value: null, year: null };
  const currentYear = new Date().getUTCFullYear();
  const years = Object.keys(series)
    .map(Number)
    .filter((y) => y <= currentYear)
    .sort((a, b) => a - b);
  if (!years.length) return { value: null, year: null };
  const year = years[years.length - 1];
  return { value: round(series[String(year)]), year };
}

// SARB Web API (custom.resbank.co.za) is a free, unauthenticated, no-key JSON API.
// Used for South Africa's live policy rate + 10y bond yield and monthly CPI.
const SARB_BASE = "https://custom.resbank.co.za/SarbWebApi";

async function fetchSarbRates() {
  const json = await fetchJson(`${SARB_BASE}/WebIndicators/CurrentMarketRates`);
  if (!json) return null;
  const find = (code) => json.find((r) => r.TimeseriesCode === code)?.Value;
  const repoRate = find("MMRD002A");
  const bond10y = find("CMJD004A"); // "10 years and longer" daily average bond yield
  if (repoRate == null && bond10y == null) return null;
  return { repoRate: round(repoRate), bond10y: round(bond10y) };
}

// Summarizes a monthly year-on-year % series (CPI) into a latest-month figure.
async function fetchSaInflationLatest() {
  const json = await fetchJson(`${SARB_BASE}/WebIndicators/ReleaseOfSelectedData/EconomicIndicators/4`);
  if (!json) return null;
  const rows = json
    .filter((r) => r.TimeseriesCode === "CPI1000F")
    .map((r) => ({ period: new Date(r.Period), value: r.Value }))
    .sort((a, b) => a.period - b.period);
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  return {
    latestPct: round(latest.value),
    monthLabel: latest.period.toLocaleString("en-ZA", { month: "short", year: "numeric", timeZone: "UTC" }),
  };
}

function round(n, dp = 2) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const f = 10 ** dp;
  return Math.round(Number(n) * f) / f;
}

export async function buildData({ metrics, countries, ratesFallback }) {
  const list = countries.countries;
  const indicators = metrics.imfIndicators;

  console.log(`Fetching ${indicators.length} IMF WEO indicators for ${list.length} countries...`);
  const [imfResults, sarbRates, saInflation] = await Promise.all([
    Promise.all(indicators.map((ind) => fetchImfIndicator(ind.code))),
    fetchSarbRates(),
    fetchSaInflationLatest(),
  ]);

  // code -> { ISO3: series } for each indicator, keyed by our internal `key`.
  const imfByKey = {};
  indicators.forEach((ind, i) => {
    imfByKey[ind.key] = imfResults[i];
  });

  const outCountries = list.map((c) => {
    const out = {
      code: c.code,
      iso2: c.iso2,
      label: c.label,
      group: c.group,
      color: c.color,
      centralBank: c.centralBank,
      policyRateName: c.policyRate?.name ?? null,
      policyRatePct: c.policyRate?.value ?? null,
      policyRateAsOf: c.policyRate?.asOf ?? null,
      creditRating: c.creditRating ?? null,
      bond10yPct: c.bond10y?.value ?? null,
      bond10yAsOf: c.bond10y?.asOf ?? null,
      gdpQoQPct: c.gdpQoQ?.value ?? null,
      gdpQoQAsOf: c.gdpQoQ?.asOf ?? null,
    };

    for (const ind of indicators) {
      const series = imfByKey[ind.key]?.[c.code];
      const { value, year } = latestValue(series);
      out[ind.key] = value;
      out[`${ind.key}Year`] = year;
    }

    return out;
  });

  // South Africa: overlay live SARB figures on top of the hand-maintained seeds.
  const sa = outCountries.find((c) => c.code === "ZAF");
  if (sa) {
    if (sarbRates?.repoRate != null) {
      sa.policyRatePct = sarbRates.repoRate;
      sa.policyRateAsOf = "live (SARB)";
    }
    if (sarbRates?.bond10y != null) {
      sa.bond10yPct = sarbRates.bond10y;
      sa.bond10yAsOf = "live (SARB)";
    }
    if (saInflation?.latestPct != null) {
      sa.inflationLatestMonthPct = saInflation.latestPct;
      sa.inflationMonthLabel = saInflation.monthLabel;
    }
    if (sarbRates == null) {
      // SARB unreachable this run — fall back to the config repo-rate seed.
      sa.policyRatePct = ratesFallback?.repoRate ?? sa.policyRatePct;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    refreshIntervalDays: 3,
    indicators: indicators.map((i) => ({ key: i.key, label: i.label })),
    countries: outCountries,
  };
}
