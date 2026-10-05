import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { isAuthorizedOmniIdentity } from "./access";
import type { Id } from "./_generated/dataModel";

const actionType = v.union(v.literal("both_scouts"), v.literal("emerging_scout"), v.literal("policy_scout"));
const actionLabels = {
  both_scouts: "Run both emerging-market and Nigerian policy scouts",
  emerging_scout: "Run the emerging-market scout",
  policy_scout: "Run the Nigerian policy scout",
} as const;

function formatInterval(minutes: number) {
  if (minutes % 10080 === 0) {
    const weeks = minutes / 10080;
    return `Every ${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `Every ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `Every ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `Every ${minutes} minutes`;
}

export const listAutomations = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    return await ctx.db.query("automations").withIndex("by_createdAt").order("desc").take(100);
  },
});

export const toggleAutomation = mutation({
  args: { id: v.id("automations"), isActive: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const automation = await ctx.db.get(args.id);
    if (!automation) throw new Error("Automation was not found.");
    if (automation.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(automation.scheduledFunctionId);
      } catch {
        // The scheduled function may already be running.
      }
    }
    let scheduledFunctionId: Id<"_scheduled_functions"> | undefined;
    if (args.isActive && automation.actionType && automation.intervalMinutes) {
      scheduledFunctionId = await ctx.scheduler.runAfter(
        automation.intervalMinutes * 60 * 1000,
        internal.scouting.runCustomScoutSchedule,
        { id: args.id },
      );
    }
    await ctx.db.patch(args.id, {
      isActive: args.isActive,
      status: args.isActive ? (scheduledFunctionId ? "scheduled" : "configured") : "paused",
      scheduledFunctionId,
    });
    return null;
  },
});

export const createAutomation = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    trigger: v.string(),
    action: v.string(),
    category: v.string(),
    actionType,
    intervalMinutes: v.number(),
  },
  returns: v.id("automations"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    if (!Number.isInteger(args.intervalMinutes) || args.intervalMinutes < 60 || args.intervalMinutes > 43200) {
      throw new Error("Custom scout schedules must run between once per hour and once every 30 days.");
    }
    const key = `custom_${crypto.randomUUID()}`;
    const id = await ctx.db.insert("automations", {
      key,
      title: args.title,
      description: args.description,
      trigger: formatInterval(args.intervalMinutes),
      action: actionLabels[args.actionType],
      actionType: args.actionType,
      intervalMinutes: args.intervalMinutes,
      category: args.category || "Custom",
      isActive: true,
      executionCount: 0,
      status: "scheduled",
      createdAt: Date.now(),
    });
    const scheduledFunctionId = await ctx.scheduler.runAfter(
      args.intervalMinutes * 60 * 1000,
      internal.scouting.runCustomScoutSchedule,
      { id },
    );
    await ctx.db.patch(id, { scheduledFunctionId });
    return id;
  },
});

export const getAutomationForExecution = internalQuery({
  args: { id: v.id("automations") },
  returns: v.any(),
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const recordScheduledExecution = internalMutation({
  args: { id: v.id("automations"), succeeded: v.boolean(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.id);
    if (!automation) return null;
    const patch: { lastRunAt: number; executionCount: number; status: string; lastError?: string; scheduledFunctionId?: Id<"_scheduled_functions"> } = {
      lastRunAt: Date.now(),
      executionCount: automation.executionCount + 1,
      status: args.succeeded ? "scheduled" : "failed",
      lastError: args.error,
      scheduledFunctionId: undefined,
    };
    if (automation.isActive && automation.actionType && automation.intervalMinutes) {
      patch.scheduledFunctionId = await ctx.scheduler.runAfter(
        automation.intervalMinutes * 60 * 1000,
        internal.scouting.runCustomScoutSchedule,
        { id: args.id },
      );
    }
    await ctx.db.patch(args.id, patch);
    return null;
  },
});
