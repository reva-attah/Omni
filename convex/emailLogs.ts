import { query, internalMutation, env } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { Resend } from "@convex-dev/resend";
import { v } from "convex/values";
import { isAuthorizedOmniIdentity } from "./access";
import type { DataModel } from "./_generated/dataModel";

const resend = new Resend(components.resend, {
  testMode: false,
  onEmailEvent: internal.emailLogs.updateDeliveryStatus,
});

/**
 * List recent audit logs of emails sent to DIT.
 */
export const listLogs = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const limit = args.limit ?? 50;
    const [owned, scoutOwned] = await Promise.all([
      ctx.db.query("emailLogs").withIndex("by_owner_dispatchedAt", (q) => q.eq("ownerId", identity.subject)).order("desc").take(limit),
      ctx.db.query("emailLogs").withIndex("by_owner_dispatchedAt", (q) => q.eq("ownerId", "reva-scout")).order("desc").take(limit),
    ]);
    return [...owned, ...scoutOwned].sort((a, b) => b.dispatchedAt - a.dispatchedAt).slice(0, limit);
  },
});

/**
 * Record an email notification attempt to the audit log.
 */
export const recordEmail = internalMutation({
  args: {
    ownerId: v.string(),
    initiativeId: v.optional(v.id("initiatives")),
    initiativeName: v.string(),
    recipient: v.string(),
    subject: v.string(),
    vantaGrade: v.string(),
    vantaScore: v.number(),
    status: v.string(),
    provider: v.string(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.initiativeId) {
      const initiative = await ctx.db.get(args.initiativeId);
      if (!initiative || initiative.ownerId !== args.ownerId) throw new Error("Initiative not found");
      if (args.status === "sent") {
        await ctx.db.patch(args.initiativeId, {
          emailDispatched: true,
          emailDispatchedAt: Date.now(),
          emailRecipient: args.recipient,
        });
      }
    }
    return await ctx.db.insert("emailLogs", {
      ...args,
      initiativeId: args.initiativeId ? String(args.initiativeId) : undefined,
      dispatchedAt: Date.now(),
    });
  },
});

export const queueScreeningAlert = internalMutation({
  args: {
    ownerId: v.string(),
    initiativeId: v.id("initiatives"),
    initiativeName: v.string(),
    recipient: v.string(),
    subject: v.string(),
    vantaGrade: v.string(),
    vantaScore: v.number(),
    html: v.string(),
    text: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const initiative = await ctx.db.get(args.initiativeId);
    if (!initiative || initiative.ownerId !== args.ownerId) throw new Error("Initiative not found");
    const previous = await ctx.db.query("emailLogs").withIndex("by_initiativeId", q => q.eq("initiativeId", String(args.initiativeId))).first();
    if (previous && ["queued", "sent", "delivered"].includes(previous.status)) return previous.messageId || "already-queued";
    const from = env.RESEND_FROM_EMAIL;
    if (!env.RESEND_API_KEY || !from) throw new Error("Resend is not configured");
    const emailId = await resend.sendEmail(ctx, {
      from,
      to: args.recipient,
      subject: args.subject,
      html: args.html,
      text: args.text,
      idempotencyKey: `screening-alert:${args.initiativeId}`,
    });
    await ctx.db.insert("emailLogs", {
      ownerId: args.ownerId,
      initiativeId: String(args.initiativeId),
      initiativeName: args.initiativeName,
      recipient: args.recipient,
      subject: args.subject,
      vantaGrade: args.vantaGrade,
      vantaScore: args.vantaScore,
      status: "queued",
      provider: "resend",
      messageId: String(emailId),
      dispatchedAt: Date.now(),
    });
    return String(emailId);
  },
});

export const updateDeliveryStatus = resend.defineOnEmailEvent<DataModel>(async (ctx, { id, event }) => {
  const log = await ctx.db.query("emailLogs").withIndex("by_messageId", (q) => q.eq("messageId", String(id))).first();
  if (!log) return;
  const eventStatus = event.type.replace("email.", "");
  await ctx.db.patch(log._id, {
    status: eventStatus,
    dispatchedAt: Date.now(),
    error: eventStatus === "failed" || eventStatus === "bounced"
      ? ("failed" in event.data ? event.data.failed.reason : "Email delivery failed")
      : undefined,
  });
  if (log.initiativeId) {
    const initiative = await ctx.db.get(log.initiativeId as Id<"initiatives">);
    if (initiative && initiative.ownerId === log.ownerId) {
      await ctx.db.patch(initiative._id, {
        emailDispatched: eventStatus === "delivered",
        emailDispatchedAt: eventStatus === "delivered" ? Date.now() : undefined,
        emailRecipient: log.recipient,
      });
    }
  }
});
