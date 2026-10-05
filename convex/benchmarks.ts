import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { isAuthorizedOmniIdentity } from "./access";

/**
 * List recent benchmark reports, ordered by creation date descending.
 */
export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const limit = args.limit ?? 50;
    const items = await ctx.db
      .query("benchmarks")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .take(limit);
    return items;
  },
});

/**
 * Get a specific benchmark report by ID.
 */
export const getById = query({
  args: { id: v.id("benchmarks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const report = await ctx.db.get(args.id);
    return report?.ownerId === identity.subject ? report : null;
  },
});

/**
 * Look up a benchmark report by its concept hash.
 */
export const getByConceptHash = query({
  args: { conceptHash: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    return await ctx.db
      .query("benchmarks")
      .withIndex("by_owner_conceptHash", (q) => q.eq("ownerId", identity.subject).eq("conceptHash", args.conceptHash))
      .first();
  },
});

/**
 * Save a generated comparative benchmark report.
 */
export const saveGenerated = internalMutation({
  args: {
    ownerId: v.string(),
    ideaName: v.string(),
    sector: v.optional(v.string()),
    conceptHash: v.string(),
    modelVersion: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    description: v.string(),
    problem: v.string(),
    solution: v.string(),
    targetCustomer: v.string(),
    monetization: v.optional(v.string()),
    flowType: v.optional(v.string()),
    executiveSummary: v.optional(v.string()),
    marketContext: v.optional(v.string()),
    executionInsights: v.optional(v.array(v.string())),
    marketLessons: v.optional(v.array(v.string())),
    sourcesCrawled: v.optional(v.number()),
    sourceCrawlFailures: v.optional(v.array(v.string())),
    sourceArticles: v.optional(v.array(v.object({
      title: v.string(),
      url: v.string(),
      sourceName: v.string(),
      sourceRegion: v.string(),
      sourceCategory: v.string(),
      summary: v.string(),
      publishedDate: v.optional(v.string()),
      relatedInitiatives: v.optional(v.array(v.string())),
    }))),
    benchmarks: v.array(
      v.object({
        companyName: v.string(),
        country: v.string(),
        regionTier: v.string(),
        launchYear: v.optional(v.string()),
        status: v.string(),
        fundingRaised: v.optional(v.string()),
        operationalScale: v.optional(v.string()),
        businessModel: v.string(),
        customersAndRevenues: v.optional(v.string()),
        roiAndViability: v.optional(v.string()),
        keyPartners: v.optional(v.string()),
        lessonsLearned: v.string(),
        scaleMetrics: v.optional(v.array(v.object({
          metric: v.string(),
          value: v.string(),
          asOf: v.optional(v.string()),
          sourceUrl: v.string(),
        }))),
        executionModel: v.optional(v.string()),
        whatWorked: v.optional(v.string()),
        challenges: v.optional(v.string()),
        sourceUrl: v.string(),
        sourceName: v.string(),
        confidence: v.string(),
      })
    ),
    blueprint: v.optional(v.object({
      whatToApply: v.array(
        v.object({
          title: v.string(),
          recommendation: v.string(),
          parallelBenchmark: v.string(),
        })
      ),
      whatToAvoid: v.array(
        v.object({
          title: v.string(),
          warning: v.string(),
          pitfallReason: v.string(),
        })
      ),
      recurringPatterns: v.array(v.string()),
      triumStrategicVerdict: v.string(),
    })),
    counts: v.object({
      total: v.number(),
      nearbyAfrica: v.number(),
      emergingPeers: v.number(),
      globalLeaders: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("benchmarks")
      .withIndex("by_owner_conceptHash", (q) => q.eq("ownerId", args.ownerId).eq("conceptHash", args.conceptHash))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        createdAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("benchmarks", {
      ...args,
      createdAt: now,
    });
  },
});

/**
 * Delete a benchmark report.
 */
export const deleteBenchmark = mutation({
  args: { id: v.id("benchmarks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const report = await ctx.db.get(args.id);
    if (!report || report.ownerId !== identity.subject) throw new Error("Benchmark report not found");
    await ctx.db.delete(args.id);
  },
});
