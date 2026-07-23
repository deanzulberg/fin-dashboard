// Cloudflare Worker entry point: runs on a Cron Trigger (see wrangler.toml),
// builds the same data.json as scripts/fetch-data.mjs (shared logic in
// scripts/lib/build-data.mjs), and commits the result straight to GitHub via
// the REST API — GitHub Pages then serves it directly from the repo, with no
// GitHub Actions involved at all.

import metrics from "../../config/metrics.json";
import countries from "../../config/countries.json";
import ratesFallback from "../../config/rates.json";
import { buildData } from "../../scripts/lib/build-data.mjs";

const REPO = "deanzulberg/fin-dashboard";
const BRANCH = "master";
const FILE_PATH = "docs/data.json";

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function commitToGitHub(data, token) {
  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "fin-dashboard-worker",
  };

  const getRes = await fetch(`${apiUrl}?ref=${BRANCH}`, { headers });
  if (!getRes.ok) {
    throw new Error(`Failed to read current ${FILE_PATH}: HTTP ${getRes.status}`);
  }
  const current = await getRes.json();

  const content = JSON.stringify(data, null, 2);
  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: refresh macro indicators",
      content: toBase64Utf8(content),
      sha: current.sha,
      branch: BRANCH,
    }),
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`Failed to commit ${FILE_PATH}: HTTP ${putRes.status} - ${body}`);
  }
}

async function run(env) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN secret is not set (wrangler secret put GITHUB_TOKEN)");
  }
  const data = await buildData({ metrics, countries, ratesFallback });
  await commitToGitHub(data, env.GITHUB_TOKEN);
  return data;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Manual trigger for testing/debugging: visiting the Worker's own URL runs
  // it on demand and reports what happened, instead of waiting for the cron.
  async fetch(request, env, ctx) {
    try {
      const data = await run(env);
      return new Response(
        JSON.stringify({ ok: true, generatedAt: data.generatedAt }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }, null, 2), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
