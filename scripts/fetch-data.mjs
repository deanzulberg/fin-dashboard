#!/usr/bin/env node
// Node entry point: reads config from disk, builds the data, writes docs/data.json.
// Run locally with `node scripts/fetch-data.mjs`. The Cloudflare Worker
// (worker/src/index.mjs) uses the same buildData() but a different entry point,
// since Workers have no filesystem.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildData } from "./lib/build-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const metrics = JSON.parse(await readFile(path.join(ROOT, "config/metrics.json"), "utf8"));
  const countries = JSON.parse(await readFile(path.join(ROOT, "config/countries.json"), "utf8"));
  const ratesFallback = JSON.parse(await readFile(path.join(ROOT, "config/rates.json"), "utf8"));

  const data = await buildData({ metrics, countries, ratesFallback });

  const outPath = path.join(ROOT, "docs/data.json");
  await writeFile(outPath, JSON.stringify(data, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error in fetch-data.mjs:", err);
  process.exit(1);
});
