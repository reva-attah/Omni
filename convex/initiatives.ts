import { query, mutation, internalMutation } from "./_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { isAuthorizedOmniIdentity } from "./access";
import schema from "./schema";

export const listInitiativesPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    ownerKind: v.union(v.literal("mine"), v.literal("scout")),
  },
  returns: paginationResultValidator(schema.doc("initiatives")),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const ownerId = args.ownerKind === "mine" ? identity.subject : "reva-scout";
    return await ctx.db
      .query("initiatives")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/**
 * List venture initiatives with optional filtering by status, source type, or grade.
 */
export const listInitiatives = query({
  args: {
    status: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    vantaGrade: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const limit = args.limit ?? 50;
    const [owned, scoutOwned] = await Promise.all([
      ctx.db.query("initiatives").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", identity.subject)).order("desc").take(limit * 2),
      ctx.db.query("initiatives").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", "reva-scout")).order("desc").take(limit * 2),
    ]);
    let items = [...owned, ...scoutOwned].sort((a, b) => b.createdAt - a.createdAt);

    if (args.status) {
      items = items.filter((item) => item.status === args.status);
    }
    if (args.sourceType) {
      items = items.filter((item) => item.sourceType === args.sourceType);
    }
    if (args.vantaGrade) {
      items = items.filter((item) => item.vantaGrade === args.vantaGrade);
    }

    return items.slice(0, limit);
  },
});

/**
 * Get single initiative by ID.
 */
export const getById = query({
  args: { id: v.id("initiatives") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const item = await ctx.db.get(args.id);
    return item?.ownerId === identity.subject ? item : null;
  },
});

/**
 * Get summary metrics across all initiatives for dashboard analytics.
 */
export const getMetrics = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const [owned, scoutOwned] = await Promise.all([
      ctx.db.query("initiatives").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", identity.subject)).take(500),
      ctx.db.query("initiatives").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", "reva-scout")).take(500),
    ]);
    const all = [...owned, ...scoutOwned];

    let passed = 0;
    let reserved = 0;
    let declined = 0;
    let highViability = 0;
    let medViability = 0;
    let droppedExact = 0;
    let emailsSent = 0;

    for (const item of all) {
      if (item.vantaResult === "passed" || ["A*", "A", "B"].includes(item.vantaGrade)) passed++;
      if (item.vantaResult === "reserved" || item.vantaGrade === "C") reserved++;
      if (item.vantaResult === "declined" || item.vantaGrade === "D") declined++;
      if (item.viabilityRating === "High") highViability++;
      if (item.viabilityRating === "Medium") medViability++;
      if (item.dedupeVerdict === "EXACT_DUPLICATE") droppedExact++;
      if (item.emailDispatched) emailsSent++;
    }

    return {
      total: all.length,
      passed,
      reserved,
      declined,
      highViability,
      medViability,
      droppedExact,
      emailsSent,
    };
  },
});

/**
 * Save an evaluated initiative.
 */
export const saveEvaluatedInitiative = internalMutation({
  args: {
    ownerId: v.string(),
    name: v.string(),
    sector: v.optional(v.string()),
    industry: v.optional(v.string()),
    description: v.string(),
    problem: v.string(),
    solution: v.string(),
    targetCustomer: v.string(),
    goToMarket: v.optional(v.string()),
    expectedRevenue: v.optional(v.string()),
    similarSolutions: v.optional(v.string()),

    sourceType: v.string(),
    sourceUrl: v.optional(v.string()),
    screeningKey: v.optional(v.string()),
    modelVersion: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    sourceMarket: v.optional(v.string()),
    policyClause: v.optional(v.string()),

    dedupeVerdict: v.string(),
    dedupeSimilarity: v.number(),
    matchingVantaId: v.optional(v.string()),
    matchingVantaName: v.optional(v.string()),
    dedupeDifferentiator: v.optional(v.string()),
    vantaDuplicateFound: v.optional(v.boolean()),
    vantaDuplicateCount: v.optional(v.number()),
    matchingVantaList: v.optional(v.any()),
    vantaSubmissionStatus: v.optional(v.string()),
    vantaSubmissionId: v.optional(v.string()),

    viabilityRating: v.string(),
    viabilityScore: v.number(),
    viabilityVerdict: v.string(),
    viabilityDimensions: v.optional(
      v.array(
        v.object({
          dimension: v.string(),
          rating: v.string(),
          rationale: v.string(),
        })
      )
    ),

    vantaScore: v.number(),
    vantaGrade: v.string(),
    vantaResult: v.string(),
    overallComments: v.string(),
    keyStrengths: v.array(v.string()),
    keyRisks: v.array(v.string()),
    criteriaScores: v.any(),
    draftSubmission: v.any(),
    tldr: v.optional(v.any()),

    status: v.string(),
    emailDispatched: v.boolean(),
    emailDispatchedAt: v.optional(v.number()),
    emailRecipient: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if duplicate name already exists
    const existing = args.screeningKey
      ? await ctx.db.query("initiatives").withIndex("by_owner_screeningKey", q => q.eq("ownerId", args.ownerId).eq("screeningKey", args.screeningKey)).first()
      : await ctx.db.query("initiatives").withIndex("by_owner_name", q => q.eq("ownerId", args.ownerId).eq("name", args.name)).first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        emailDispatched: existing.emailDispatched || args.emailDispatched,
        emailDispatchedAt: existing.emailDispatchedAt,
        emailRecipient: existing.emailRecipient,
        createdAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("initiatives", {
      ...args,
      createdAt: now,
    });
  },
});

/**
 * Delete an initiative.
 */
export const deleteInitiative = mutation({
  args: { id: v.id("initiatives") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const item = await ctx.db.get(args.id);
    if (!item || item.ownerId !== identity.subject) throw new Error("Initiative not found");
    await ctx.db.delete(args.id);
  },
});
