import { query, mutation, internalMutation, internalQuery, env } from "./_generated/server";
import { v } from "convex/values";
import { isAuthorizedOmniIdentity } from "./access";

const sourceCategory = v.union(
  v.literal("Emerging Market"),
  v.literal("Nigerian Regulatory, Legal and Policy Environment"),
  v.literal("Global Fallback"),
);

function normalizeCategory(value: string) {
  const category = value.trim().toLowerCase();
  if (category.startsWith("emerging market") || category.includes("emerging")) return "Emerging Market" as const;
  if (category.includes("regulat") || category.includes("policy") || category.includes("nigeria")) {
    return "Nigerian Regulatory, Legal and Policy Environment" as const;
  }
  if (category.includes("global")) return "Global Fallback" as const;
  throw new Error(`Unsupported source category: ${value}`);
}

/**
 * List sources registered in the system with optional tier/active filters.
 */
export const listSources = query({
  args: {
    tier: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    let items = await ctx.db.query("sourceRegistry").withIndex("by_name").take(500);

    if (args.tier) {
      items = items.filter((s) => s.tier === args.tier);
    }
    if (args.isActive !== undefined) {
      items = items.filter((s) => s.isActive === args.isActive);
    }

    return items;
  },
});

export const myApprovalRole = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) return null;
    const email = identity.email.toLowerCase();
    return email === env.REVA_ADMIN_EMAIL?.trim().toLowerCase() ? "reva" : null;
  },
});

export const approvalSetup = query({
  args: {},
  returns: v.object({
    authorized: v.boolean(),
    role: v.union(v.literal("reva"), v.null()),
    revaAdminConfigured: v.boolean(),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const authorized = isAuthorizedOmniIdentity(identity);
    const revaEmail = env.REVA_ADMIN_EMAIL?.trim().toLowerCase();
    const email = identity?.email?.trim().toLowerCase();
    const role = authorized && revaEmail && email === revaEmail ? "reva" as const : null;
    return {
      authorized,
      role,
      revaAdminConfigured: Boolean(revaEmail),
    };
  },
});

/**
 * Record the single Reva administrator's approval for a source.
 */
export const signOffSource = internalMutation({
  args: {
    id: v.id("sourceRegistry"),
    adminRole: v.literal("reva"),
    approved: v.boolean(),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.id);
    if (!source) {
      throw new Error("Source not found");
    }

    const patchData = {
      signOffRevaAdmin: args.approved,
      isActive: args.approved,
      approvedAt: args.approved ? Date.now() : undefined,
    };
    await ctx.db.patch(args.id, patchData);
    return { ...source, ...patchData };
  },
});

/**
 * Add a new source to the registry. Requires sign-off before becoming active.
 */
export const addSource = mutation({
  args: {
    name: v.string(),
    url: v.string(),
    feedUrl: v.optional(v.string()),
    region: v.string(),
    tier: v.string(),
    category: sourceCategory,
    sector: v.optional(v.string()),
    industry: v.optional(v.string()),
  },
  returns: v.id("sourceRegistry"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    if (!args.name.trim()) throw new Error("Source name is required.");
    if (!args.url.trim()) throw new Error("Source URL is required.");
    const parsed = new URL(args.url);
    if (parsed.protocol !== "https:") throw new Error("Source URLs must use HTTPS");
    if (args.feedUrl && new URL(args.feedUrl).protocol !== "https:") throw new Error("Feed URLs must use HTTPS");
    const normalizedUrl = parsed.toString().replace(/\/$/, "");
    const existing = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", normalizedUrl)).first();
    if (existing) throw new Error("This source is already registered.");

    const tier = args.category === "Global Fallback" ? "tier_b_global" : args.category === "Emerging Market" ? "tier_a_emerging" : "nigeria_regulator";
    return await ctx.db.insert("sourceRegistry", {
      name: args.name,
      url: normalizedUrl,
      ...(args.feedUrl ? { feedUrl: new URL(args.feedUrl).toString() } : {}),
      region: args.region,
      tier,
      category: args.category,
      sector: args.sector,
      industry: args.industry,
      dateAdded: Date.now(),
      isActive: false,
      lastScrapedAt: undefined,
      failureCount: 0,
      signOffRevaAdmin: false,
    });
  },
});

export const importCuratedSources = mutation({
  args: {
    sources: v.array(v.object({
      name: v.string(),
      url: v.string(),
      region: v.string(),
      category: v.string(),
      tier: v.string(),
      sector: v.optional(v.string()),
      industry: v.optional(v.string()),
    })),
  },
  returns: v.object({ added: v.number(), alreadyPresent: v.number() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    if (args.sources.length > 100) throw new Error("Import the source catalog in batches of 100 or fewer.");
    let added = 0;
    let alreadyPresent = 0;
    for (const source of args.sources) {
      const category = normalizeCategory(source.category);
      if (!source.name.trim()) throw new Error("Every imported source must have a name.");
      const parsed = new URL(source.url);
      if (parsed.protocol !== "https:") throw new Error("Source URLs must use HTTPS");
      const url = parsed.toString().replace(/\/$/, "");
      const existing = await ctx.db.query("sourceRegistry")
        .withIndex("by_url", (q) => q.eq("url", url))
        .first();
      if (existing) {
        alreadyPresent++;
        continue;
      }
      await ctx.db.insert("sourceRegistry", {
        ...source,
        url,
        category,
        tier: category === "Global Fallback" ? "tier_b_global" : category === "Emerging Market" ? "tier_a_emerging" : "nigeria_regulator",
        isActive: false,
        dateAdded: Date.now(),
        failureCount: 0,
        signOffRevaAdmin: false,
      });
      added++;
    }
    return { added, alreadyPresent };
  },
});

/** Approve a source only when the caller is the configured Reva administrator. */
export const approveSource = mutation({
  args: {
    id: v.id("sourceRegistry"),
    approved: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity) || !identity?.email) throw new Error("A Trium account is required");
    const email = identity.email.toLowerCase();
    const revaAdmin = env.REVA_ADMIN_EMAIL?.trim().toLowerCase();
    if (!revaAdmin || email !== revaAdmin) throw new Error("Only the configured Reva administrator can approve sources");

    const source = await ctx.db.get(args.id);
    if (!source) throw new Error("Source not found");
    const patchData = { signOffRevaAdmin: args.approved };
    await ctx.db.patch(args.id, {
      ...patchData,
      isActive: args.approved,
      approvedAt: args.approved ? Date.now() : undefined,
    });
    return { ...source, ...patchData, isActive: args.approved };
  },
});

/**
 * Update scrape timestamp or record failure.
 */
export const recordScrapeAttempt = internalMutation({
  args: {
    id: v.id("sourceRegistry"),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.id);
    if (!source) return;

    if (args.success) {
      await ctx.db.patch(args.id, {
        lastScrapedAt: Date.now(),
        failureCount: 0,
      });
    } else {
      await ctx.db.patch(args.id, {
        failureCount: source.failureCount + 1,
      });
    }
  },
});

export const getActiveSourceDomains = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sourceRegistry").withIndex("by_isActive", q => q.eq("isActive", true)).take(100);
    const domains = new Set<string>();
    for (const s of sources) {
      try { domains.add(new URL(s.url).hostname.replace(/^www\./, "")); } catch {}
    }
    return Array.from(domains);
  }
});



export const seed = internalMutation(async (ctx) => {
  const INITIAL_REGISTRY_SOURCES = [
    { name: "Disrupt Africa", url: "https://disrupt-africa.com", region: "Africa (Pan-African)", category: "Emerging Market", tier: "tier_a_emerging" },
    { name: "WeeTracker", url: "https://weetracker.com", region: "Africa (East & Southern)", category: "Emerging Market", tier: "tier_a_emerging" },
    { name: "Tech in Asia", url: "https://www.techinasia.com", region: "Southeast Asia", category: "Emerging Market", tier: "tier_a_emerging" },
    { name: "DailySocial Indonesia", url: "https://dailysocial.id", region: "Southeast Asia (Indonesia)", category: "Emerging Market", tier: "tier_a_emerging" },
    { name: "Wamda MENA", url: "https://www.wamda.com", region: "MENA", category: "Emerging Market", tier: "tier_a_emerging" },
    { name: "Inc42 India", url: "https://inc42.com", region: "South Asia (India)", category: "Emerging Market", tier: "tier_a_emerging" },
    { name: "Startups Brazil", url: "https://startups.com.br", region: "Latin America (Brazil)", category: "Emerging Market", tier: "tier_a_emerging" },
    { name: "Enterprise News Egypt", url: "https://enterprise.press", region: "MENA (Egypt)", category: "Emerging Market", tier: "tier_a_emerging" },
    { name: "Central Bank of Nigeria (CBN)", url: "https://www.cbn.gov.ng/Documents/circulars.asp", region: "Nigeria", category: "Nigerian Regulatory, Legal and Policy Environment", tier: "nigeria_regulator" },
    { name: "Securities & Exchange Commission (SEC Nigeria)", url: "https://sec.gov.ng/rules-codes-circulars", region: "Nigeria", category: "Nigerian Regulatory, Legal and Policy Environment", tier: "nigeria_regulator" },
    { name: "Nigerian Electricity Regulatory Commission (NERC)", url: "https://nerc.gov.ng/orders", region: "Nigeria", category: "Nigerian Regulatory, Legal and Policy Environment", tier: "nigeria_regulator" },
    { name: "National Info Tech Dev Agency (NITDA)", url: "https://nitda.gov.ng/guidelines", region: "Nigeria", category: "Nigerian Regulatory, Legal and Policy Environment", tier: "nigeria_regulator" },
    { name: "Federal Inland Revenue Service (FIRS)", url: "https://www.firs.gov.ng/tax-resources", region: "Nigeria", category: "Nigerian Regulatory, Legal and Policy Environment", tier: "nigeria_regulator" },
    { name: "Federal Ministry of Communications, Innovation & Digital Economy", url: "https://bmdce.gov.ng", region: "Nigeria", category: "Nigerian Regulatory, Legal and Policy Environment", tier: "nigeria_regulator" },
    { name: "Crunchbase News (Global)", url: "https://news.crunchbase.com", region: "Global", category: "Global Fallback", tier: "tier_b_global" },
    { name: "TechCrunch Emerging", url: "https://techcrunch.com", region: "Global", category: "Global Fallback", tier: "tier_b_global" },
    { name: "Y Combinator Launches", url: "https://www.ycombinator.com/blog", region: "Global", category: "Global Fallback", tier: "tier_b_global" },
  ];
  for (const src of INITIAL_REGISTRY_SOURCES) {
    const existing = await ctx.db.query("sourceRegistry").withIndex("by_name").filter(q => q.eq(q.field("name"), src.name)).first();
    if (!existing) {
      await ctx.db.insert("sourceRegistry", {
        ...src,
        isActive: true,
        signOffRevaAdmin: true,
        failureCount: 0,
        dateAdded: Date.now()
      });
    }
  }
  return "Seeded successfully";
});
