import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const source = v.object({
  name: v.string(),
  url: v.string(),
  region: v.string(),
  category: v.string(),
  tier: v.string(),
  sector: v.optional(v.string()),
});

/** Idempotently load the curated source lists from config into an empty/new deployment. */
export const seed = internalMutation({
  args: { sources: v.array(source) },
  returns: v.object({ added: v.number(), alreadyPresent: v.number() }),
  handler: async (ctx, args) => {
    if (args.sources.length > 100) throw new Error("Seed sources in batches of 100 or fewer.");
    let added = 0;
    let alreadyPresent = 0;
    for (const item of args.sources) {
      const parsed = new URL(item.url);
      if (parsed.protocol !== "https:") throw new Error(`Source URL must use HTTPS: ${item.url}`);
      const url = parsed.toString().replace(/\/$/, "");
      const existing = await ctx.db.query("sourceRegistry")
        .withIndex("by_url", (q) => q.eq("url", url))
        .first();
      if (existing) {
        alreadyPresent++;
        continue;
      }
      await ctx.db.insert("sourceRegistry", {
        ...item,
        url,
        isActive: true,
        dateAdded: Date.now(),
        failureCount: 0,
        signOffRevaAdmin: true,
      });
      added++;
    }
    return { added, alreadyPresent };
  },
});
