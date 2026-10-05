import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const emerging = JSON.parse(readFileSync(new URL("../config/sites_emerging_tech.json", import.meta.url), "utf8"));
const policy = JSON.parse(readFileSync(new URL("../config/sites_nigeria_policy.json", import.meta.url), "utf8"));

const sources = [
  ...emerging.emerging_markets_sources.map((item) => ({
    name: item.name,
    url: item.url,
    region: item.region,
    category: "Emerging Market",
    tier: "tier_a_emerging",
    sector: item.category,
  })),
  ...emerging.global_fallback_sources.map((item) => ({
    name: item.name,
    url: item.url,
    region: item.region,
    category: "Global Fallback",
    tier: "tier_b_global",
    sector: item.category,
  })),
  ...policy.government_and_regulatory_sources.map((item) => ({
    name: item.name,
    url: item.url,
    region: "Nigeria",
    category: "Nigerian Regulatory, Legal and Policy Environment",
    tier: "nigeria_regulator",
    sector: item.sector,
  })),
  ...policy.legal_and_policy_intelligence_sources.map((item) => ({
    name: item.name,
    url: item.url,
    region: "Nigeria",
    category: "Nigerian Regulatory, Legal and Policy Environment",
    tier: "nigeria_legal",
    sector: item.focus,
  })),
];

const uniqueSources = [...new Map(sources.map((item) => [new URL(item.url).toString().replace(/\/$/, ""), item])).values()];
if (uniqueSources.length > 100) throw new Error("The source catalog must be seeded in batches of 100 or fewer.");

const result = spawnSync("npx", [
  "convex", "run", "--deployment", "dev", "seed_sources:seed", JSON.stringify({ sources: uniqueSources }),
], { stdio: "inherit" });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
