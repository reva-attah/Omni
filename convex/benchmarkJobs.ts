import { internal } from "./_generated/api";
import { internalQuery, internalMutation, mutation, query } from "./_generated/server";
import { isAuthorizedOmniIdentity } from "./access";
import { v } from "convex/values";

const briefValidator = v.object({ ideaName: v.string(), sector: v.string(), description: v.string(), problem: v.string(), solution: v.string(), targetCustomer: v.string(), monetization: v.string() });

export const getDraft = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    return await ctx.db.query("benchmarkDrafts").withIndex("by_owner", q => q.eq("ownerId", identity.subject)).first();
  },
});

export const saveDraft = mutation({
  args: { updatedAt: v.number(), flowType: v.string(), inputText: v.string(), brief: briefValidator, step: v.number(), documentId: v.optional(v.id("uploadedDocuments")), jobId: v.optional(v.id("benchmarkJobs")), fileName: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    if (args.documentId) {
      const document = await ctx.db.get(args.documentId);
      if (!document || document.ownerId !== identity.subject) throw new Error("Attached document not found.");
    }
    if (args.jobId) {
      const job = await ctx.db.get(args.jobId);
      if (!job || job.ownerId !== identity.subject) throw new Error("Benchmark job not found.");
    }
    const existing = await ctx.db.query("benchmarkDrafts").withIndex("by_owner", q => q.eq("ownerId", identity.subject)).first();
    if (existing && existing.updatedAt >= args.updatedAt) return null;
    if (existing) await ctx.db.patch(existing._id, args);
    else await ctx.db.insert("benchmarkDrafts", { ...args, ownerId: identity.subject });
    return null;
  },
});

export const listMyJobs = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    return await ctx.db.query("benchmarkJobs").withIndex("by_owner_createdAt", q => q.eq("ownerId", identity.subject)).order("desc").take(10);
  },
});

export const getJobForWorker = internalQuery({
  args: { jobId: v.id("benchmarkJobs") },
  handler: (ctx, { jobId }) => ctx.db.get(jobId),
});

export const updateJob = internalMutation({
  args: { jobId: v.id("benchmarkJobs"), status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed")), progress: v.string(), benchmarkId: v.optional(v.id("benchmarks")), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job) await ctx.db.patch(job._id, { status: args.status, progress: args.progress, benchmarkId: args.benchmarkId, error: args.error, updatedAt: Date.now() });
    return null;
  },
});

export const startBenchmark = mutation({
  args: { ideaName: v.string(), sector: v.string(), description: v.string(), problem: v.optional(v.string()), solution: v.optional(v.string()), targetCustomer: v.optional(v.string()), monetization: v.optional(v.string()), flowType: v.optional(v.string()), documentId: v.optional(v.id("uploadedDocuments")), fileName: v.optional(v.string()) },
  returns: v.id("benchmarkJobs"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    if (args.documentId) {
      const document = await ctx.db.get(args.documentId);
      if (!document || document.ownerId !== identity.subject) throw new Error("Attached document not found.");
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("benchmarkJobs", {
      ownerId: identity.subject, status: "queued", progress: "Queued for research",
      ideaName: args.ideaName, sector: args.sector, description: args.description,
      problem: args.problem || "", solution: args.solution || "", targetCustomer: args.targetCustomer || "", monetization: args.monetization || "",
      flowType: args.flowType || "flow4a_benchmark", documentId: args.documentId, fileName: args.fileName,
      createdAt: now, updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.benchmarking.executeBenchmark, { jobId });
    return jobId;
  },
});

export const getMyJob = query({
  args: { jobId: v.id("benchmarkJobs") },
  handler: async (ctx, { jobId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const job = await ctx.db.get(jobId);
    if (!job || job.ownerId !== identity.subject) return null;
    const document = job.documentId ? await ctx.db.get(job.documentId) : null;
    const report = job.benchmarkId ? await ctx.db.get(job.benchmarkId) : null;
    return { ...job, documentName: document?.name ?? job.fileName ?? null, report };
  },
});
