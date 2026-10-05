import { action, env } from "./_generated/server";
import { v } from "convex/values";
import { isAuthorizedOmniIdentity } from "./access";

function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3));
  const words2 = new Set(str2.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3));
  if (!words1.size || !words2.size) return 0;
  let matches = 0;
  for (const w of words1) {
    if (words2.has(w)) matches++;
  }
  return Number((matches / Math.max(words1.size, words2.size)).toFixed(2));
}

/**
 * Check an initiative against the Vanta portfolio and idea bank for duplicates.
 * Returns explicit duplicate outcome: found/not found, count, and list of matching concepts with descriptions.
 */
export const checkDuplicates = action({
  args: {
    ideaName: v.string(),
    description: v.string(),
    sector: v.optional(v.string()),
  },
  returns: v.object({
    duplicateFound: v.boolean(),
    duplicateCount: v.number(),
    verdict: v.string(),
    highestSimilarity: v.number(),
    matchingDuplicates: v.array(v.object({
      name: v.string(),
      similarity: v.number(),
      description: v.string(),
      status: v.string(),
    })),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const key = env.VANTA_API_KEY;
    const base = env.VANTA_API_BASE_URL;
    if (!key || !base) throw new Error("Vanta duplicate checking is not configured; no duplicate verdict was produced.");

    const url = new URL("/api/v1/portfolio?limit=500", base);
    if (url.protocol !== "https:") throw new Error("Vanta API must use HTTPS.");
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Vanta API returned HTTP ${response.status}; no duplicate verdict was produced.`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("items" in payload) || !Array.isArray(payload.items)) {
      throw new Error("Vanta returned an unexpected portfolio response; no duplicate verdict was produced.");
    }
    const vantaItems = payload.items.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : typeof record.title === "string" ? record.title : "";
      if (!name.trim()) return [];
      return [{
        name,
        sector: typeof record.sector === "string" ? record.sector : "",
        description: typeof record.description === "string" ? record.description : typeof record.summary === "string" ? record.summary : "",
        status: typeof record.status === "string" ? record.status : typeof record.portfolioTab === "string" ? record.portfolioTab : "Unknown",
      }];
    });

    const queryTarget = `${args.ideaName} ${args.description}`;
    const normalizedIdeaName = args.ideaName.trim().toLowerCase();
    const matches: Array<{ name: string; similarity: number; description: string; status: string }> = [];

    for (const item of vantaItems) {
      const score = calculateSimilarity(queryTarget, `${item.name} ${item.description}`);
      const sameNameContains = normalizedIdeaName.length >= 4 && item.name.toLowerCase().includes(normalizedIdeaName);
      if (score >= 0.25 || sameNameContains) {
        matches.push({
          name: item.name.slice(0, 180),
          similarity: Math.min(1.0, score + (item.sector === args.sector ? 0.15 : 0)),
          description: item.description.slice(0, 1000),
          status: item.status,
        });
      }
    }

    matches.sort((a, b) => b.similarity - a.similarity);
    const highestSimilarity = matches[0]?.similarity || 0;
    const duplicateMatches = matches.filter((match) => match.similarity >= 0.45);
    const duplicateFound = duplicateMatches.length > 0;
    const verdict = highestSimilarity >= 0.85 ? "EXACT_DUPLICATE" : highestSimilarity >= 0.45 ? "NEAR_SIMILAR" : "NEW";

    return {
      duplicateFound,
      duplicateCount: duplicateMatches.length,
      verdict,
      highestSimilarity,
      matchingDuplicates: duplicateMatches,
      message: duplicateFound
        ? `Found ${matches.length} matching concept(s) in Vanta Idea Bank (Highest similarity: ${Math.round(highestSimilarity * 100)}%).`
        : "No matching portfolio record crossed the similarity threshold. This is not proof that the concept is unique.",
    };
  },
});

/** Read-only connectivity check. */
export const checkConnection = action({
  args: {},
  returns: v.object({ connected: v.boolean(), checkedAt: v.number(), ideaBankRecords: v.number(), message: v.string() }),
  handler: async (ctx) => {
    const key = env.VANTA_API_KEY;
    const base = env.VANTA_API_BASE_URL;
    if (!key || !base) {
      return { connected: false, checkedAt: Date.now(), ideaBankRecords: 0, message: "Vanta read API is not configured; live portfolio checks are unavailable." };
    }
    try {
      const url = new URL("/api/v1/portfolio?limit=1000", base);
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return { connected: false, checkedAt: Date.now(), ideaBankRecords: 0, message: `Vanta API returned HTTP ${response.status}.` };
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !("items" in payload) || !Array.isArray(payload.items)) {
        return { connected: false, checkedAt: Date.now(), ideaBankRecords: 0, message: "Vanta returned an unexpected response." };
      }
      const ideaBankRecords = payload.items.filter((item: unknown) => item && typeof item === "object" && "portfolioTab" in item && item.portfolioTab === "bank").length;
      return { connected: true, checkedAt: Date.now(), ideaBankRecords, message: "Vanta portfolio read is active and connected." };
    } catch {
      return { connected: false, checkedAt: Date.now(), ideaBankRecords: 0, message: "Could not reach Vanta; no local portfolio fallback is available." };
    }
  },
});
