import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { isAuthorizedOmniIdentity } from "./access";
import schema from "./schema";

const screeningSourceType = v.union(v.literal("emerging_tech"), v.literal("nigeria_policy"), v.literal("benchmark"));

export const createScreeningBatch = internalMutation({
  args: { ownerId: v.string(), scoutType: screeningSourceType, total: v.number() },
  returns: v.id("screeningBatches"),
  handler: async (ctx, args) => await ctx.db.insert("screeningBatches", {
    ...args,
    completed: 0,
    processed: 0,
    failed: 0,
    status: "queued",
    errors: [],
    queuedAt: Date.now(),
  }),
});

export const recordScreeningBatchChunk = internalMutation({
  args: {
    batchId: v.id("screeningBatches"),
    completed: v.number(),
    processed: v.number(),
    failed: v.number(),
    errors: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.status === "completed") return null;
    const completed = Math.min(batch.total, batch.completed + args.completed);
    const done = completed >= batch.total;
    await ctx.db.patch(batch._id, {
      completed,
      processed: Math.min(batch.total, batch.processed + args.processed),
      failed: Math.min(batch.total, batch.failed + args.failed),
      errors: [...batch.errors, ...args.errors.map((error) => error.slice(0, 500))].slice(0, 20),
      status: done ? "completed" : "processing",
      ...(done ? { completedAt: Date.now() } : {}),
    });
    return null;
  },
});

export const listRecentBatches = query({
  args: {},
  returns: v.array(schema.doc("screeningBatches")),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const [owned, scoutOwned] = await Promise.all([
      ctx.db.query("screeningBatches")
        .withIndex("by_owner_queuedAt", (q) => q.eq("ownerId", identity.subject))
        .order("desc")
        .take(10),
      ctx.db.query("screeningBatches")
        .withIndex("by_owner_queuedAt", (q) => q.eq("ownerId", "reva-scout"))
        .order("desc")
        .take(10),
    ]);
    return [...owned, ...scoutOwned].sort((a, b) => b.queuedAt - a.queuedAt).slice(0, 20);
  },
});
