import { action, internalAction, internalMutation, internalQuery, mutation, query, env } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isAuthorizedOmniIdentity } from "./access";
import { waitForGeminiSlot } from "./geminiQueue";

const scoutType = v.union(v.literal("emerging_tech"), v.literal("nigeria_policy"));
const runScoutType = v.union(v.literal("emerging_tech"), v.literal("nigeria_policy"), v.literal("full_patrol"));
const triggerType = v.union(v.literal("scheduled"), v.literal("manual"));
const runStatus = v.union(v.literal("running"), v.literal("completed"), v.literal("partial"), v.literal("failed"));
const sourceDoc = v.object({
  _id: v.id("sourceRegistry"), _creationTime: v.number(), name: v.string(), url: v.string(),
  feedUrl: v.optional(v.string()), region: v.string(), tier: v.string(), category: v.string(),
  sector: v.optional(v.string()), industry: v.optional(v.string()), dateAdded: v.optional(v.number()),
  isActive: v.boolean(), lastScrapedAt: v.optional(v.number()), failureCount: v.number(),
  signOffRevaAdmin: v.boolean(), signOffVantaAdmin: v.optional(v.boolean()), approvedAt: v.optional(v.number()),
});
const runDoc = v.object({
  _id: v.id("scoutRuns"), _creationTime: v.number(), scoutType: runScoutType, trigger: triggerType, status: runStatus,
  startedAt: v.number(), completedAt: v.optional(v.number()), sourcesChecked: v.number(),
  articlesFound: v.number(), newArticles: v.number(), ideasFound: v.number(), error: v.optional(v.string()),
});
const findingDoc = v.object({
  _id: v.id("scoutFindings"), _creationTime: v.number(), runId: v.id("scoutRuns"), scoutType,
  articleTitle: v.string(), articleUrl: v.string(), sourceName: v.string(), sourceUrl: v.string(),
  publishedAt: v.optional(v.string()), ideaName: v.string(), sector: v.string(), summary: v.string(),
  industry: v.optional(v.string()), isNewInSession: v.optional(v.boolean()), sessionDate: v.optional(v.string()), sessionId: v.optional(v.string()),
  status: v.union(v.literal("new"), v.literal("reviewed"), v.literal("dismissed")), createdAt: v.number(),
});
const articleValidator = v.object({
  urlHash: v.string(), url: v.string(), title: v.string(), sourceName: v.string(), sourceType: v.string(),
  contentHash: v.string(), content: v.optional(v.string()), aiSummary: v.optional(v.string()),
  potentialIdea: v.optional(v.string()), aiSector: v.optional(v.string()), industry: v.optional(v.string()),
  isNewInSession: v.optional(v.boolean()), sessionDate: v.optional(v.string()), sessionId: v.optional(v.string()),
  processedAt: v.number(), status: v.string(), publishedDate: v.optional(v.string()),
});
const articleDoc = v.object({ _id: v.id("scrapedItems"), _creationTime: v.number(), ...articleValidator.fields });
const articleArchiveDoc = v.object({
  _id: v.id("scrapedItems"), _creationTime: v.number(), urlHash: v.string(), url: v.string(), title: v.string(),
  sourceName: v.string(), sourceType: v.string(), contentHash: v.string(), aiSummary: v.optional(v.string()),
  potentialIdea: v.optional(v.string()), aiSector: v.optional(v.string()), industry: v.optional(v.string()),
  isNewInSession: v.boolean(), sessionDate: v.string(), sessionId: v.string(),
  processedAt: v.number(), status: v.string(), publishedDate: v.optional(v.string()),
});

export const activeSources = internalQuery({
  args: { scoutType },
  returns: v.object({ sources: v.array(sourceDoc), usingGlobalFallback: v.boolean() }),
  handler: async (ctx, args) => {
    const active: Doc<"sourceRegistry">[] = await ctx.db.query("sourceRegistry")
      .withIndex("by_isActive", (q) => q.eq("isActive", true)).take(100);
    if (args.scoutType === "nigeria_policy") {
      return { sources: active.filter((source) => source.tier === "nigeria_regulator" || source.tier === "nigeria_legal"), usingGlobalFallback: false };
    }
    const tierA = active.filter((source) => source.tier === "tier_a_emerging");
    const tierB = active.filter((source) => source.tier === "tier_b_global");
    const usingGlobalFallback = tierA.length < 30;
    return { sources: (usingGlobalFallback ? [...tierA, ...tierB] : tierA).slice(0, 50), usingGlobalFallback };
  },
});

export const benchmarkSources = internalQuery({
  args: {},
  returns: v.array(sourceDoc),
  handler: async (ctx) => await ctx.db.query("sourceRegistry")
    .withIndex("by_isActive", (q) => q.eq("isActive", true))
    .take(500),
});

export const collectBenchmarkArticles = internalAction({
  args: {},
  returns: v.object({
    sourcesAttempted: v.number(),
    sourcesSucceeded: v.number(),
    failedSources: v.array(v.string()),
    articles: v.array(v.object({
      title: v.string(), url: v.string(), sourceName: v.string(), sourceRegion: v.string(),
      sourceCategory: v.string(), content: v.string(), publishedDate: v.optional(v.string()),
    })),
  }),
  handler: async (ctx) => {
    const sources: Doc<"sourceRegistry">[] = await ctx.runQuery(internal.scouting.benchmarkSources, {});
    if (!sources.length) throw new Error("Benchmark research requires active sources in the Source Registry.");
    const articles: Array<{
      title: string; url: string; sourceName: string; sourceRegion: string; sourceCategory: string;
      content: string; publishedDate?: string;
    }> = [];
    const failedSources: string[] = [];
    let sourcesSucceeded = 0;
    for (let offset = 0; offset < sources.length; offset += 5) {
      const batch = sources.slice(offset, offset + 5);
      const results = await Promise.all(batch.map(async (source) => {
        const type: ScoutType = source.tier.startsWith("nigeria") ? "nigeria_policy" : "emerging_tech";
        try {
          return { source, items: await scrapeSource(source, type) };
        } catch (error) {
          return { source, error: error instanceof Error ? error.message : "Source crawl failed." };
        }
      }));
      for (const result of results) {
        if ("error" in result) {
          failedSources.push(`${result.source.name}: ${result.error}`);
          continue;
        }
        if (!result.items.length) {
          failedSources.push(`${result.source.name}: no article records could be extracted.`);
          continue;
        }
        sourcesSucceeded++;
        for (const item of result.items.slice(0, 3)) {
          articles.push({
            title: item.title,
            url: item.url,
            sourceName: item.sourceName,
            sourceRegion: result.source.region,
            sourceCategory: result.source.category,
            content: item.content.slice(0, 1200),
            ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
          });
        }
      }
    }
    if (!sourcesSucceeded || !articles.length) {
      throw new Error(`Could not crawl any active registry sources (${failedSources.length} failed). Check source URLs and feeds.`);
    }
    return {
      sourcesAttempted: sources.length,
      sourcesSucceeded,
      failedSources: failedSources.slice(0, 50),
      articles: articles.slice(0, 180),
    };
  },
});

export const listRecentRuns = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(runDoc),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    return await ctx.db.query("scoutRuns").withIndex("by_startedAt").order("desc").take(Math.max(1, Math.min(args.limit ?? 20, 50)));
  },
});

export const listFindingsPage = query({
  args: { paginationOpts: paginationOptsValidator, typeFilter: v.optional(v.union(v.literal("emerging_tech"), v.literal("nigeria_policy"))) },
  returns: paginationResultValidator(findingDoc),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    let q = ctx.db.query("scoutFindings");
    if (args.typeFilter) {
      return await q.withIndex("by_scoutType_createdAt", q => q.eq("scoutType", args.typeFilter!)).order("desc").paginate(args.paginationOpts);
    } else {
      return await q.withIndex("by_createdAt").order("desc").paginate(args.paginationOpts);
    }
  }
});

export const listRecentFindings = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(findingDoc),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    return await ctx.db.query("scoutFindings").withIndex("by_createdAt").order("desc").take(Math.max(1, Math.min(args.limit ?? 40, 100)));
  },
});

export const listRecentArticles = query({
  args: { limit: v.optional(v.number()) }, returns: v.array(articleDoc),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const sessions = await ctx.db.query("scoutArticleSessions").withIndex("by_processedAt").order("desc").take(Math.max(1, Math.min(args.limit ?? 60, 100)));
    const rows = await Promise.all(sessions.map(async (session) => {
      const article = await ctx.db.get(session.articleId);
      if (!article) return null;
      return {
        ...article,
        isNewInSession: session.isNewInSession,
        sessionDate: session.sessionDate,
        sessionId: String(session.runId),
        processedAt: session.processedAt,
      };
    }));
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

export const listRecentArticlesPage = query({
  args: { paginationOpts: paginationOptsValidator, isArchived: v.optional(v.boolean()) },
  returns: paginationResultValidator(articleArchiveDoc),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const sessions = ctx.db.query("scoutArticleSessions");
    const filteredSessions = args.isArchived === true
      ? sessions.withIndex("by_isArchived_processedAt", (q) => q.eq("isArchived", true))
      : sessions.withIndex("by_isArchived_processedAt", (q) => q.eq("isArchived", undefined));
    const page = await filteredSessions.order("desc").paginate(args.paginationOpts);
    const rows = await Promise.all(page.page.map(async (session) => {
      const article = await ctx.db.get(session.articleId);
      if (!article) return null;
      return {
        _id: article._id,
        _creationTime: article._creationTime,
        urlHash: article.urlHash,
        url: article.url,
        title: article.title,
        sourceName: article.sourceName,
        sourceType: article.sourceType,
        contentHash: article.contentHash,
        aiSummary: article.aiSummary,
        potentialIdea: article.potentialIdea,
        aiSector: article.aiSector,
        industry: article.industry,
        isNewInSession: session.isNewInSession,
        sessionDate: session.sessionDate,
        sessionId: String(session.runId),
        processedAt: session.processedAt,
        status: article.status,
        publishedDate: article.publishedDate,
      };
    }));
    return { ...page, page: rows.filter((row): row is NonNullable<typeof row> => row !== null) };
  },
});

export const archiveArticles = mutation({
  args: { olderThanDays: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    if (!Number.isFinite(args.olderThanDays) || args.olderThanDays < 0) {
      throw new Error("Archive age must be a non-negative number of days.");
    }

    const cutoff = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;
    const sessions = await ctx.db.query("scoutArticleSessions")
      .withIndex("by_isArchived_processedAt", (q) => q.eq("isArchived", undefined).lte("processedAt", cutoff))
      .take(100);

    for (const session of sessions) {
      await ctx.db.patch(session._id, { isArchived: true });
    }
    return sessions.length;
  },
});

export const recoverStaleRuns = mutation({
  args: { now: v.number() }, returns: v.number(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const cutoff = args.now - 10 * 60 * 1000;
    const candidates = await ctx.db.query("scoutRuns").withIndex("by_startedAt", (q) => q.lte("startedAt", cutoff)).order("asc").take(50);
    let recovered = 0;
    for (const run of candidates) {
      if (run.status !== "running") continue;
      await ctx.db.patch(run._id, { status: "failed", completedAt: args.now, error: "This run did not finish updating its status and was closed as failed. Start a new run to retry." });
      recovered++;
    }
    return recovered;
  },
});

export const getOverview = query({
  args: { now: v.number() },
  returns: v.object({
    activeEmergingSources: v.number(), activePolicySources: v.number(), registeredSources: v.number(),
    articlesLastDay: v.number(), ideasLastDay: v.number(), geminiConfigured: v.boolean(), totalFindingsAllTime: v.number(), totalArticlesAllTime: v.number(),
    firecrawlConfigured: v.boolean(), vantaReadApiConfigured: v.boolean(), resendConfigured: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const [sources, recentArticles, recentIdeas]: [Doc<"sourceRegistry">[], Doc<"scrapedItems">[], Doc<"scoutFindings">[]] = await Promise.all([
      ctx.db.query("sourceRegistry").withIndex("by_name").take(500),
      ctx.db.query("scrapedItems").withIndex("by_processedAt", (q) => q.gte("processedAt", args.now - 24 * 60 * 60 * 1000)).take(1000),
      ctx.db.query("scoutFindings").withIndex("by_createdAt", (q) => q.gte("createdAt", args.now - 24 * 60 * 60 * 1000)).take(500),
    ]);
    const active = sources.filter((source) => source.isActive);
    return {
      activeEmergingSources: active.filter((source) => source.tier === "tier_a_emerging" || source.tier === "tier_b_global").length,
      activePolicySources: active.filter((source) => source.tier === "nigeria_regulator" || source.tier === "nigeria_legal").length,
      registeredSources: sources.length,
      // Dashboard totals are bounded to avoid a full-table scan on every reactive refresh.
      totalFindingsAllTime: (await ctx.db.query("scoutFindings").withIndex("by_createdAt").take(1000)).length,
      totalArticlesAllTime: (await ctx.db.query("scoutArticleSessions").withIndex("by_isArchived_processedAt", q => q.eq("isArchived", undefined)).take(1000)).length,
        articlesLastDay: recentArticles.length,
      ideasLastDay: recentIdeas.length,
      geminiConfigured: Boolean(env.GEMINI_API_KEY),
      firecrawlConfigured: Boolean(env.FIRECRAWL_API_KEY),
      vantaReadApiConfigured: Boolean(env.VANTA_API_KEY && env.VANTA_API_BASE_URL),
      resendConfigured: Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL),
    };
  },
});

export const runNow = action({
  args: { scoutType },
  returns: v.object({ runId: v.id("scoutRuns"), status: runStatus, articlesFound: v.number(), newArticles: v.number(), ideasFound: v.number(), message: v.string() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    return await executeScout(ctx, args.scoutType, "manual");
  },
});

export const analyzeArticle = action({
  args: { id: v.id("scrapedItems") },
  returns: v.object({ summary: v.string(), potentialIdea: v.string(), sector: v.string(), industry: v.string() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const article: Doc<"scrapedItems"> | null = await ctx.runQuery(internal.scouting.getArticleById, { id: args.id });
    if (!article) throw new Error("Article was not found");
    let articleContent = article.content?.trim() || "";
    if (!articleContent) {
      try {
        const url = new URL(article.url);
        if (url.protocol !== "https:") throw new Error("Only HTTPS article sources can be fetched.");
        const response = await fetch(url, { headers: { "user-agent": "Reva-Research-Bot/1.0", accept: "text/html,text/plain" }, signal: AbortSignal.timeout(15000) });
        if (response.ok) articleContent = stripMarkup((await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")).slice(0, 7000);
      } catch { /* Firecrawl fallback below. */ }
      if (articleContent.length < 200) {
        try { articleContent = (await firecrawlPage(article.url, false)).markdown.replace(/\s+/g, " ").trim().slice(0, 7000); } catch { /* Report extraction failure below. */ }
      }
    }
    if (articleContent.length < 80) throw new Error("Reva could not extract enough article text. Open the original article and try again later.");
    const key = env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini is not configured for this Reva deployment.");
    const prompt = `Analyze this public article for a Nigerian venture scouting team. Return only JSON with summary (2-4 factual sentences), potentialIdea (one plausible initiative grounded in the text, or empty string if none), sector (closest canonical sector or Uncategorized), and industry (specific industry grounded in the text, or Uncategorized). Do not invent facts or claim Nigerian fit has been assessed.\n\nTitle: ${article.title}\nSource: ${article.sourceName}\nURL: ${article.url}\nArticle text:\n${articleContent}`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await waitForGeminiSlot(ctx);
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ model: env.GEMINI_MODEL || "gemini-3.8-flash", input: prompt,
          response_format: { type: "text", mime_type: "application/json" }, generation_config: { thinking_level: "low", max_output_tokens: 1200 } }),
        signal: AbortSignal.timeout(60000),
      });
      if (response.ok) break;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 4) throw new Error(`Gemini article analysis returned HTTP ${response.status}. The article is still available below.`);
      const delay = response.status === 429 ? 60000 : 2000;
      await new Promise(r => setTimeout(r, delay));
    }
    if (!response?.ok) throw new Error("Gemini article analysis failed after retrying.");
    const payload: unknown = await response.json();
    const text = getGeminiText(payload);
    const parsed = parseJson(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Gemini returned an unreadable article analysis.");
    const result = parsed as Record<string, unknown>;
    const summary = typeof result.summary === "string" ? result.summary.slice(0, 2500) : "";
    const potentialIdea = typeof result.potentialIdea === "string" ? result.potentialIdea.slice(0, 1000) : "";
    const sector = typeof result.sector === "string" ? result.sector.slice(0, 100) : "";
    const industry = typeof result.industry === "string" ? result.industry.slice(0, 100) : "Uncategorized";
    if (!summary) throw new Error("Gemini returned no article summary.");
    await ctx.runMutation(internal.scouting.saveArticleAnalysis, { id: args.id, summary, potentialIdea, sector, industry, content: articleContent });
    return { summary, potentialIdea, sector, industry };
  },
});

export const runEmergingScheduled = internalAction({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const selected: { sources: Doc<"sourceRegistry">[]; usingGlobalFallback: boolean } = await ctx.runQuery(internal.scouting.activeSources, { scoutType: "emerging_tech" });
    if (selected.sources.length) await executeScout(ctx, "emerging_tech", "scheduled");
    return null;
  },
});

export const runPolicyScheduled = internalAction({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const selected: { sources: Doc<"sourceRegistry">[]; usingGlobalFallback: boolean } = await ctx.runQuery(internal.scouting.activeSources, { scoutType: "nigeria_policy" });
    if (selected.sources.length) await executeScout(ctx, "nigeria_policy", "scheduled");
    return null;
  },
});

export const runCustomScoutSchedule = internalAction({
  args: { id: v.id("automations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const automation = await ctx.runQuery(internal.automations.getAutomationForExecution, { id: args.id });
    if (!automation || !automation.isActive || !automation.actionType) return null;
    const scoutTypes: ScoutType[] = automation.actionType === "both_scouts"
      ? ["emerging_tech", "nigeria_policy"]
      : automation.actionType === "emerging_scout"
      ? ["emerging_tech"]
      : ["nigeria_policy"];
    const results = await Promise.all(scoutTypes.map((type) => executeScout(ctx, type, "scheduled")));
    const failures = results.filter((result) => result.status !== "completed");
    await ctx.runMutation(internal.automations.recordScheduledExecution, {
      id: args.id,
      succeeded: failures.length === 0,
      ...(failures.length ? { error: failures.map((result) => result.message).join(" ").slice(0, 1000) } : {}),
    });
    return null;
  },
});

export const saveArticles = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    scoutType,
    articles: v.array(articleValidator),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let inserted = 0;
    for (const article of args.articles) {
      const exists = await ctx.db.query("scrapedItems").withIndex("by_urlHash", (q) => q.eq("urlHash", article.urlHash)).first();
      let articleId;
      if (exists) {
        if (!exists.content && article.content) await ctx.db.patch(exists._id, { content: article.content });
        articleId = exists._id;
      } else {
        articleId = await ctx.db.insert("scrapedItems", article);
        inserted++;
      }
      const sessionExists = await ctx.db.query("scoutArticleSessions")
        .withIndex("by_runId_and_urlHash", (q) => q.eq("runId", args.runId).eq("urlHash", article.urlHash))
        .first();
      if (!sessionExists) {
        await ctx.db.insert("scoutArticleSessions", {
          runId: args.runId,
          articleId,
          urlHash: article.urlHash,
          scoutType: args.scoutType,
          isNewInSession: article.isNewInSession ?? false,
          sessionDate: article.sessionDate || new Date().toISOString().slice(0, 10),
          processedAt: Date.now(),
        });
      }
    }
    return inserted;
  },
});

export const saveArticleAnalyses = internalMutation({
  args: { articles: v.array(v.object({
    urlHash: v.string(), aiSummary: v.string(), aiSector: v.string(), industry: v.string(), potentialIdea: v.optional(v.string()),
  })) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const analysis of args.articles) {
      const article = await ctx.db.query("scrapedItems").withIndex("by_urlHash", (q) => q.eq("urlHash", analysis.urlHash)).first();
      if (!article) continue;
      await ctx.db.patch(article._id, {
        aiSummary: analysis.aiSummary,
        aiSector: analysis.aiSector,
        industry: analysis.industry,
        potentialIdea: analysis.potentialIdea,
      });
    }
    return null;
  },
});

export const saveFindings = internalMutation({
  args: { runId: v.id("scoutRuns"), scoutType, findings: v.array(v.object({
    articleUrl: v.string(), ideaName: v.string(), sector: v.string(), industry: v.optional(v.string()), summary: v.string(),
  })) },
  returns: v.number(),
  handler: async (ctx, args) => {
    let inserted = 0;
    for (const finding of args.findings) {
      const articleUrl = new URL(finding.articleUrl).toString();
      const existing = await ctx.db.query("scoutFindings").withIndex("by_articleUrl", (q) => q.eq("articleUrl", articleUrl)).first();
      if (existing) continue;
      const urlHash = await hash(articleUrl);
      const article = await ctx.db.query("scrapedItems").withIndex("by_urlHash", (q) => q.eq("urlHash", urlHash)).first();
      await ctx.db.insert("scoutFindings", {
        runId: args.runId, scoutType: args.scoutType,
        articleTitle: article?.title || "Source article", articleUrl,
        sourceName: article?.sourceName || new URL(articleUrl).hostname,
        sourceUrl: articleUrl, publishedAt: article?.publishedDate,
        ideaName: finding.ideaName.slice(0, 180), sector: finding.sector.slice(0, 100),
        industry: finding.industry?.slice(0, 100), isNewInSession: true,
        sessionDate: new Date().toISOString().slice(0, 10), sessionId: args.runId,
        summary: finding.summary.slice(0, 3000), status: "new", createdAt: Date.now(),
      });
      inserted++;
    }
    return inserted;
  },
});

export const finishRun = internalMutation({
  args: {
    id: v.id("scoutRuns"), status: v.union(v.literal("completed"), v.literal("partial"), v.literal("failed")),
    sourcesChecked: v.number(), articlesFound: v.number(), newArticles: v.number(), ideasFound: v.number(), error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, { ...fields, completedAt: Date.now() });
    return null;
  },
});

export const updateSourceHealth = internalMutation({
  args: { attempts: v.array(v.object({ id: v.id("sourceRegistry"), succeeded: v.boolean() })) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const attempt of args.attempts) {
      const source = await ctx.db.get(attempt.id);
      if (!source) continue;
      const failureCount = attempt.succeeded ? 0 : source.failureCount + 1;
      await ctx.db.patch(attempt.id, { lastScrapedAt: Date.now(), failureCount });
    }
    return null;
  },
});

type ScoutType = "emerging_tech" | "nigeria_policy";
type RunTrigger = "manual" | "scheduled";
type ScoutArticle = {
  urlHash: string; url: string; title: string; sourceName: string; sourceType: string;
  contentHash: string; processedAt: number; status: string; publishedDate?: string; content: string;
};
type ParsedScoutArticle = Pick<ScoutArticle, "url" | "title" | "sourceName" | "content" | "publishedDate">;
type ScoutRunResult = { runId: Id<"scoutRuns">; status: "completed" | "partial" | "failed"; articlesFound: number; newArticles: number; ideasFound: number; message: string };

async function executeScout(ctx: ActionCtx, type: ScoutType, trigger: RunTrigger): Promise<ScoutRunResult> {
  const runId: Id<"scoutRuns"> = await ctx.runMutation(internal.scouting.createRun, { scoutType: type, trigger });
  const errors: string[] = [];
  try {
    const selected: { sources: Doc<"sourceRegistry">[]; usingGlobalFallback: boolean } = await ctx.runQuery(internal.scouting.activeSources, { scoutType: type });
    if (!selected.sources.length) throw new Error("No active, Reva-approved sources are configured for this scout.");
    const articleBatches: { source: Doc<"sourceRegistry">; articles: ScoutArticle[] }[] = [];
    const attempts: { id: Id<"sourceRegistry">; succeeded: boolean }[] = [];
    for (let i = 0; i < selected.sources.length; i += 5) {
      const batch = selected.sources.slice(i, i + 5);
      const results = await Promise.all(batch.map(async (source) => {
        try { return { source, articles: await scrapeSource(source, type) }; }
        catch { return { source, articles: [], failed: true }; }
      }));
      for (const result of results) {
        const failed = "failed" in result;
        attempts.push({ id: result.source._id, succeeded: !failed });
        if (!failed) articleBatches.push(result);
      }
    }
    await ctx.runMutation(internal.scouting.updateSourceHealth, { attempts });
    const allArticles = [...new Map(articleBatches.flatMap((batch) => batch.articles).map((article) => [article.urlHash, article])).values()].slice(0, 200);
    const known = await getKnownArticleHashes(ctx, allArticles);
    const fresh = allArticles.filter((article) => !known.has(article.urlHash));
    const sessionDate = new Date().toISOString().slice(0, 10);
    const articlesToSave = allArticles.map((article) => known.has(article.urlHash)
      ? article
      : { ...article, isNewInSession: true, sessionDate, sessionId: runId });
    let newArticles = 0;
    for (let offset = 0; offset < articlesToSave.length; offset += 50) {
      newArticles += await ctx.runMutation(internal.scouting.saveArticles, {
        runId,
        scoutType: type,
        articles: articlesToSave.slice(offset, offset + 50),
      });
    }
    let ideasFound = 0;
    if (fresh.length && env.GEMINI_API_KEY) {
      for (let offset = 0; offset < fresh.length; offset += 20) {
        const batch = fresh.slice(offset, offset + 20);
        try {
          const analyses = await classifyScoutedArticles(batch, type, () => waitForGeminiSlot(ctx));
          await ctx.runMutation(internal.scouting.saveArticleAnalyses, {
            articles: analyses.map((analysis) => ({
              urlHash: batch.find((article) => article.url === analysis.articleUrl)!.urlHash,
              aiSummary: analysis.summary,
              aiSector: analysis.sector,
              industry: analysis.industry,
              ...(analysis.ideaName ? { potentialIdea: analysis.ideaName } : {}),
            })),
          });
          const candidates = analyses.filter((analysis) => analysis.ideaName && analysis.opportunitySummary).map((analysis) => ({
            articleUrl: analysis.articleUrl,
            ideaName: analysis.ideaName,
            sector: analysis.sector,
            industry: analysis.industry,
            summary: analysis.opportunitySummary,
          }));
          ideasFound += await ctx.runMutation(internal.scouting.saveFindings, { runId, scoutType: type, findings: candidates });
          if (candidates.length) {
            const screened: { processed: number; errors: string[] } = await ctx.runAction(internal.screening.processScoutCandidates, {
              scoutType: type, candidates,
            });
            errors.push(...screened.errors);
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Unknown Gemini error";
          errors.push(`Article batch beginning at ${offset + 1} was saved but not fully classified or screened: ${reason}`);
        }
      }
    } else if (!env.GEMINI_API_KEY && newArticles) {
      errors.push("Articles were saved; configure Gemini to turn them into venture idea findings.");
    }
    if (selected.usingGlobalFallback) errors.push("Fewer than 30 active Tier A feeds; the Tier B global fallback was included.");
    const status: "partial" | "completed" = errors.length ? "partial" : "completed";
    await ctx.runMutation(internal.scouting.finishRun, {
      id: runId, status, sourcesChecked: selected.sources.length, articlesFound: allArticles.length,
      newArticles, ideasFound, error: errors.length ? errors.join(" ").slice(0, 1000) : undefined,
    });
    return { runId, status, articlesFound: allArticles.length, newArticles, ideasFound,
      message: errors.join(" ") || `Checked ${selected.sources.length} approved sources.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout run failed.";
    await ctx.runMutation(internal.scouting.finishRun, {
      id: runId, status: "failed", sourcesChecked: 0, articlesFound: 0, newArticles: 0, ideasFound: 0, error: message.slice(0, 1000),
    });
    return { runId, status: "failed" as const, articlesFound: 0, newArticles: 0, ideasFound: 0, message };
  }
}

export const createRun = internalMutation({
  args: { scoutType, trigger: triggerType }, returns: v.id("scoutRuns"),
  handler: async (ctx, args) => await ctx.db.insert("scoutRuns", {
    ...args, status: "running", startedAt: Date.now(), sourcesChecked: 0, articlesFound: 0, newArticles: 0, ideasFound: 0,
  }),
});

async function scrapeSource(source: Doc<"sourceRegistry">, type: ScoutType): Promise<ScoutArticle[]> {
  let response: Response;
  try {
    response = await fetch(source.feedUrl || source.url, {
      headers: { "user-agent": "Reva-Research-Bot/1.0 (+https://trium.ng; source-feed-reader)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return await scrapeWithFirecrawl(source, type);
  }
  if (!response.ok) return await scrapeWithFirecrawl(source, type);
  let feedUrl = source.feedUrl || "";
  let body = await response.text();
  if (!feedUrl && /<html[\s>]/i.test(body)) {
    feedUrl = discoverFeedUrl(body, source.url) || new URL("/feed/", source.url).toString();
    if (feedUrl !== source.url) {
      const feedResponse = await fetch(feedUrl, { headers: { "user-agent": "Reva-Research-Bot/1.0", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
      if (feedResponse.ok) body = await feedResponse.text();
    }
  }
  let entries = parseFeed(body, source);
  if (!entries.length && /<html[\s>]/i.test(body)) entries = parseArticleCards(body, source);
  if (!entries.length && /<html[\s>]/i.test(body)) return await scrapeWithFirecrawl(source, type);
  const now = Date.now();
  const fresh = entries.filter((entry) => {
    if (entry.publishedDate) {
      const timestamp = Date.parse(entry.publishedDate);
      if (Number.isFinite(timestamp) && timestamp < now - 45 * 24 * 60 * 60 * 1000) return false;
    }
    return type !== "emerging_tech" || !/\bNigeria(?:n)?\b/i.test(`${entry.title} ${entry.content}`);
  }).slice(0, 8);
  return await Promise.all(fresh.map(async (entry) => ({
    ...entry,
    urlHash: await hash(entry.url),
    contentHash: await hash(`${entry.title}\n${entry.content}`),
    sourceType: type,
    processedAt: now,
    status: "scraped",
  })));
}

/** Firecrawl fallback for JS-rendered or blocked source pages. */
async function scrapeWithFirecrawl(source: Doc<"sourceRegistry">, type: ScoutType): Promise<ScoutArticle[]> {
  const page = await firecrawlPage(source.url, true);
  const origin = new URL(source.url).origin;
  const candidates = [...new Set(page.links)]
    .filter((link) => {
      try {
        const url = new URL(link);
        return url.protocol === "https:" && url.origin === origin && /\/(news|article|blog|insight|post|policy|regulat|publication|press|innovation|startup|venture)/i.test(url.pathname);
      } catch { return false; }
    }).slice(0, 3);
  const pages = candidates.length
    ? await Promise.all(candidates.map(async (url) => {
      try { return { url, ...(await firecrawlPage(url, false)) }; } catch { return null; }
    }))
    : [{ url: source.url, title: page.title || source.name, markdown: page.markdown, links: [] }];
  const now = Date.now();
  return await Promise.all(pages.flatMap((item) => {
    if (!item || !item.markdown.trim()) return [];
    const content = item.markdown.replace(/\s+/g, " ").trim().slice(0, 7000);
    const title = (item.title || content.split(/[.!?]/)[0] || source.name).slice(0, 300);
    if (type === "emerging_tech" && /\bNigeria(?:n)?\b/i.test(`${title} ${content}`)) return [];
    return [{ url: item.url, title, content, sourceName: source.name, urlHash: "", contentHash: "", sourceType: type, processedAt: now, status: "scraped" }];
  }).map(async (article) => ({ ...article, urlHash: await hash(article.url), contentHash: await hash(`${article.title}\n${article.content}`) })));
}

async function firecrawlPage(url: string, includeLinks: boolean): Promise<{ title: string; markdown: string; links: string[] }> {
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("Firecrawl is not configured. Set FIRECRAWL_API_KEY on this Convex deployment.");
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: includeLinks ? ["markdown", "links"] : ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Firecrawl returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("success" in payload) || payload.success !== true || !("data" in payload) || !payload.data || typeof payload.data !== "object") {
    throw new Error("Firecrawl could not extract this source.");
  }
  const data = payload.data as Record<string, unknown>;
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {};
  return {
    title: typeof metadata.title === "string" ? metadata.title : "",
    markdown: typeof data.markdown === "string" ? data.markdown : "",
    links: Array.isArray(data.links) ? data.links.filter((link): link is string => typeof link === "string") : [],
  };
}

function discoverFeedUrl(html: string, baseUrl: string) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    if (!/rss|atom|xml/i.test(tag) || !/alternate/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)/i)?.[1];
    if (!href) continue;
    try { return new URL(decodeEntities(href), baseUrl).toString(); } catch { continue; }
  }
  return "";
}

function parseFeed(xml: string, source: Doc<"sourceRegistry">): ParsedScoutArticle[] {
  const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return entries.map((entry) => {
    const title = xmlTag(entry, "title");
    const url = xmlTag(entry, "link") || entry.match(/<link\b[^>]*href=["']([^"']+)/i)?.[1] || "";
    const content = xmlTag(entry, "description") || xmlTag(entry, "summary") || xmlTag(entry, "content:encoded") || xmlTag(entry, "content");
    const publishedDate = xmlTag(entry, "pubDate") || xmlTag(entry, "published") || xmlTag(entry, "updated");
    try {
      const absolute = new URL(decodeEntities(url), source.url);
      if (absolute.protocol !== "https:" || !title.trim()) return null;
      return {
        url: absolute.toString(), title: stripMarkup(title).slice(0, 300), sourceName: source.name,
        content: stripMarkup(content).slice(0, 7000), publishedDate: publishedDate ? stripMarkup(publishedDate).slice(0, 80) : undefined,
      };
    } catch { return null; }
  }).filter((item): item is NonNullable<typeof item> => item !== null);
}

function parseArticleCards(html: string, source: Doc<"sourceRegistry">): ParsedScoutArticle[] {
  const cards = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((match) => match[1]);
  return cards.map((card) => {
    const title = card.match(/<(?:h[1-6]|title)\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|title)>/i)?.[1] || "";
    const href = card.match(/<a\b[^>]*href=["']([^"']+)/i)?.[1] || "";
    const content = card.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
    try {
      const url = new URL(decodeEntities(href), source.url);
      if (url.protocol !== "https:" || !title.trim()) return null;
      return { url: url.toString(), title: stripMarkup(title).slice(0, 300), sourceName: source.name, content: stripMarkup(content).slice(0, 7000) };
    } catch { return null; }
  }).filter((item): item is NonNullable<typeof item> => item !== null);
}

function xmlTag(entry: string, name: string) {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = entry.match(new RegExp(`<${safeName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${safeName}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1") || "";
}

function stripMarkup(value: string) { return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim(); }
function decodeEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => {
    if (entity.toLowerCase() === "amp") return "&";
    if (entity.toLowerCase() === "lt") return "<";
    if (entity.toLowerCase() === "gt") return ">";
    if (entity.toLowerCase() === "quot") return '"';
    if (entity.toLowerCase() === "apos") return "'";
    const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

function parseJson(text: string) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as unknown;
}

function getGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("steps" in payload) || !Array.isArray(payload.steps)) return "";
  const output = payload.steps.find((step) => step && typeof step === "object" && "type" in step && step.type === "model_output");
  if (!output || typeof output !== "object" || !("content" in output) || !Array.isArray(output.content)) return "";
  return output.content.flatMap((part: unknown) => part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []).join("");
}

type ScoutAnalysis = {
  articleUrl: string;
  summary: string;
  sector: string;
  industry: string;
  ideaName: string;
  opportunitySummary: string;
};

async function classifyScoutedArticles(articles: ScoutArticle[], type: ScoutType, reserve: () => Promise<void>): Promise<ScoutAnalysis[]> {
  const key = env.GEMINI_API_KEY;
  if (!key || !articles.length) return [];
  const prompt = `Classify every public ${type === "emerging_tech" ? "technology and startup" : "Nigerian regulatory and policy"} article below. Return exactly one JSON array item for each input URL, including articles with no venture opportunity. Each item must contain articleUrl, summary (factual, 2-4 sentences), sector (one of Fintech & Financial Inclusion, AgriTech & Supply Chain, GovTech & Regulatory Tech, CleanTech & Energy Software, HealthTech & Life Sciences, Commerce, Retail & Logistics, InsurTech & Risk Analytics, Mobility & Smart Transit, Enterprise & Emerging Tech, or Uncategorized), industry (specific label grounded in the text, or Uncategorized), ideaName (empty string if no clear opportunity), and opportunitySummary (empty string if no clear opportunity). Never invent policy details, market statistics, companies, or facts.\n\n${articles.map((article, index) => `ARTICLE ${index + 1}\nTitle: ${article.title}\nURL: ${article.url}\nText: ${article.content}`).join("\n\n")}`;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await reserve();
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ model: env.GEMINI_MODEL || "gemini-3.8-flash", input: prompt,
        response_format: { type: "text", mime_type: "application/json" }, generation_config: { thinking_level: "low", max_output_tokens: 5000 } }),
    });
    if (response.ok) break;
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 4) throw new Error(`Gemini scout classification returned HTTP ${response.status}`);
    const delay = response.status === 429 ? 60000 : 2000;
    await new Promise(r => setTimeout(r, delay));
  }
  if (!response?.ok) throw new Error("Gemini scout classification failed.");
  const payload: unknown = await response.json();
  const text = getGeminiText(payload);
  if (!text) throw new Error("Gemini returned no article classifications.");
  const result = parseJson(text);
  if (!Array.isArray(result)) throw new Error("Gemini returned an invalid article classification list.");
  const analyses = result.flatMap((item: any) => {
    if (!item || typeof item.articleUrl !== "string" || typeof item.summary !== "string") return [];
    try {
      const articleUrl = new URL(item.articleUrl).toString();
      if (!articles.some((article) => article.url === articleUrl)) return [];
      return [{
        articleUrl,
        summary: item.summary.slice(0, 3000),
        sector: typeof item.sector === "string" && item.sector.trim() ? item.sector.slice(0, 100) : "Uncategorized",
        industry: typeof item.industry === "string" && item.industry.trim() ? item.industry.slice(0, 100) : "Uncategorized",
        ideaName: typeof item.ideaName === "string" ? item.ideaName.slice(0, 180).trim() : "",
        opportunitySummary: typeof item.opportunitySummary === "string" ? item.opportunitySummary.slice(0, 3000).trim() : "",
      }];
    } catch { return []; }
  });
  if (analyses.length !== articles.length) throw new Error("Gemini did not return a classification for every new article.");
  return analyses;
}

async function getKnownArticleHashes(ctx: ActionCtx, articles: ScoutArticle[]) {
  const hashes = new Set<string>();
  for (const article of articles) {
    const exists: Doc<"scrapedItems"> | null = await ctx.runQuery(internal.scouting.getArticleByHash, { urlHash: article.urlHash });
    if (exists) hashes.add(article.urlHash);
  }
  return hashes;
}

export const getArticleByHash = internalQuery({
  args: { urlHash: v.string() }, returns: v.union(v.null(), articleDoc),
  handler: async (ctx, args) => await ctx.db.query("scrapedItems").withIndex("by_urlHash", (q) => q.eq("urlHash", args.urlHash)).first(),
});

export const getArticleById = internalQuery({
  args: { id: v.id("scrapedItems") }, returns: v.union(v.null(), articleDoc),
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const saveArticleAnalysis = internalMutation({
  args: { id: v.id("scrapedItems"), summary: v.string(), potentialIdea: v.string(), sector: v.string(), industry: v.string(), content: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { id, summary, potentialIdea, sector, industry } = args;
    await ctx.db.patch(id, { aiSummary: summary, potentialIdea, aiSector: sector, industry });
    return null;
  },
});

async function hash(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
