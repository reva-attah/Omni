"use node";

import { action, internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { isAuthorizedOmniIdentity } from "./access";
import type { Id } from "./_generated/dataModel";
import { waitForGeminiSlot } from "./geminiQueue";
import { parseModelObject } from "./aiValidation";

function safeJson(text: string) {
  return parseModelObject(text) as Record<string, any>;
}

function getGeminiText(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("steps" in payload) || !Array.isArray(payload.steps)) return "";
  const output = payload.steps.find((step) => step && typeof step === "object" && "type" in step && step.type === "model_output");
  if (!output || typeof output !== "object" || !("content" in output) || !Array.isArray(output.content)) return "";
  return output.content.flatMap((part: unknown) => part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []).join("");
}

function isGroundedUrl(value: unknown, groundedUrls: Set<string>) {
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    return groundedUrls.has(new URL(value).toString());
  } catch {
    return false;
  }
}

type CrawledBenchmarkArticle = {
  title: string;
  url: string;
  sourceName: string;
  sourceRegion: string;
  sourceCategory: string;
  content: string;
  publishedDate?: string;
};

type BenchmarkArticleSummary = Omit<CrawledBenchmarkArticle, "content"> & {
  summary: string;
  relatedInitiatives: string[];
};

async function summarizeBenchmarkArticles(key: string, articles: CrawledBenchmarkArticle[], reserve: () => Promise<void>): Promise<BenchmarkArticleSummary[]> {
  const summaries: BenchmarkArticleSummary[] = [];
  const model = env.GEMINI_BENCHMARK_MODEL || env.GEMINI_MODEL || "gemini-3.1-pro-preview";
  const normalizeUrl = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = "";
      return url.toString();
    } catch {
      return value.trim();
    }
  };
  for (let offset = 0; offset < articles.length; offset += 5) {
    const batch = articles.slice(offset, offset + 5);
    const prompt = `Summarize every supplied crawled article for a Trium/Coronation venture research report. Return a JSON array with exactly one object per input. Copy articleNumber exactly from the input; do not change or omit it. Each object: {"articleNumber":1,"url":"exact input URL","summary":"two or three factual sentences from this article","relatedInitiatives":["named venture initiatives explicitly described in the article"]}. Use an empty array when no initiative is named. Do not infer facts from outside the article, invent metrics, or omit articles.\n\n${batch.map((article, index) => `ARTICLE NUMBER: ${index + 1}\nURL: ${article.url}\nTitle: ${article.title}\nSource: ${article.sourceName}\nText: ${article.content}`).join("\n\n")}`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await reserve();
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          model,
          input: prompt,
          response_format: { type: "text", mime_type: "application/json" },
          generation_config: { thinking_level: "medium", max_output_tokens: 5000 },
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (response.ok) break;
      const detail = (await response.text()).slice(0, 250);
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 3) throw new Error(`Gemini article summary returned HTTP ${response.status} after ${attempt + 1} attempt(s). ${detail}`);
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(Math.max(retryAfter * 1000, 1000), 120000)
        : response.status === 429
          ? Math.min(15000 * (2 ** attempt) + Math.random() * 1000, 120000)
          : Math.min(1000 * (2 ** attempt) + Math.random() * 500, 10000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (!response?.ok) throw new Error("Gemini article summarization failed after retrying transient errors.");
    const payload: unknown = await response.json();
    const text = getGeminiText(payload);
    if (!text) throw new Error("Gemini returned no article summaries.");
    const parsed: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!Array.isArray(parsed)) throw new Error("Gemini returned an invalid article summary list.");
    const byUrl = new Map<string, { summary: string; relatedInitiatives: string[] }>();
    const byNumber = new Map<number, { summary: string; relatedInitiatives: string[] }>();
    for (const item of parsed) {
      if (!item || typeof item !== "object" || !("summary" in item) || typeof item.summary !== "string") continue;
      const names = "relatedInitiatives" in item && Array.isArray(item.relatedInitiatives)
        ? item.relatedInitiatives.filter((name: unknown): name is string => typeof name === "string").map((name: string) => name.slice(0, 160)).slice(0, 8)
        : [];
      const record = { summary: item.summary.slice(0, 1200), relatedInitiatives: names };
      if ("url" in item && typeof item.url === "string") byUrl.set(normalizeUrl(item.url), record);
      if ("articleNumber" in item && typeof item.articleNumber === "number" && Number.isInteger(item.articleNumber)) {
        byNumber.set(item.articleNumber, record);
      }
    }
    const missing: CrawledBenchmarkArticle[] = [];
    const summariesByArticle = new Map<string, BenchmarkArticleSummary>();
    for (const [index, article] of batch.entries()) {
      const summary = byNumber.get(index + 1) || byUrl.get(normalizeUrl(article.url));
      if (!summary?.summary.trim()) {
        missing.push(article);
        continue;
      }
      summariesByArticle.set(normalizeUrl(article.url), {
        title: article.title,
        url: article.url,
        sourceName: article.sourceName,
        sourceRegion: article.sourceRegion,
        sourceCategory: article.sourceCategory,
        ...(article.publishedDate ? { publishedDate: article.publishedDate } : {}),
        ...summary,
      });
    }
    // Recover omitted entries individually so one incomplete JSON batch does
    // not fail an otherwise successful benchmark.
    if (missing.length) {
      if (batch.length === 1) throw new Error(`Gemini did not summarize crawled article ${missing[0].url}.`);
      const recovered = await summarizeBenchmarkArticles(key, missing, reserve);
      for (const summary of recovered) summariesByArticle.set(normalizeUrl(summary.url), summary);
    }
    for (const article of batch) {
      const summary = summariesByArticle.get(normalizeUrl(article.url));
      if (!summary) throw new Error(`Gemini did not summarize crawled article ${article.url}.`);
      summaries.push(summary);
    }
  }
  return summaries;
}


export const extractBrief = action({
  args: {
    text: v.optional(v.string()),
    documentId: v.optional(v.id("uploadedDocuments")),
  },
  returns: v.object({
    ideaName: v.string(),
    sector: v.string(),
    description: v.string(),
    problem: v.string(),
    solution: v.string(),
    targetCustomer: v.string(),
    monetization: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const key = env.GEMINI_API_KEY;
    let sourceText = args.text?.trim() || "";
    const input: Array<Record<string, unknown>> = [];

    if (args.documentId) {
      const doc = await ctx.runQuery(internal.files.getOwnedDocument, { id: args.documentId, ownerId: identity.subject });
      if (!doc) throw new Error("The uploaded document was not found in your account.");
      const url = await ctx.storage.getUrl(doc.storageId);
      if (!url) throw new Error("The uploaded document is no longer available.");
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not read the uploaded document.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Files must be 10 MB or smaller.");
      if (doc.contentType === "text/plain") {
        sourceText += `\n\n${bytes.toString("utf8")}`;
      } else if (doc.contentType === "application/pdf") {
        input.push({ type: "document", mime_type: "application/pdf", data: bytes.toString("base64") });
      } else {
        throw new Error("Upload a PDF or plain text document.");
      }
    }

    if (!key) {
      throw new Error("Brief extraction is not configured. Set GEMINI_API_KEY in Convex environment variables.");
    }
    if (!sourceText.trim() && !args.documentId) {
      throw new Error("Enter an idea description or attach a document.");
    }

    input.unshift({
      type: "text",
      text: `Extract one proposed venture idea from the supplied content. Return only JSON with keys: ideaName, sector, description, problem, solution, targetCustomer, monetization. Standardize sector to one of: 'Fintech & Financial Inclusion', 'AgriTech & Supply Chain', 'CleanTech & Energy Software', 'GovTech & Regulatory Tech', 'HealthTech & Life Sciences', 'Commerce, Retail & Logistics', 'InsurTech & Risk Analytics', 'Mobility & Smart Transit'. Use 'Uncategorized' when the evidence is insufficient. Do not add facts absent from the source.\n\nSource content:\n${sourceText.slice(0, 90_000) || "See the attached document."}`,
    });

    await waitForGeminiSlot(ctx);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: env.GEMINI_MODEL || "gemini-3.8-flash",
        input,
        response_format: { type: "text", mime_type: "application/json" },
        generation_config: { thinking_level: "low", max_output_tokens: 3000 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Brief extraction provider returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const payload = await response.json() as any;
    const text = payload.steps?.find((step: any) => step.type === "model_output")?.content
      ?.filter((part: any) => part.type === "text")?.map((part: any) => part.text || "").join("");
    if (!text) throw new Error("Brief extraction returned no result.");
    const extracted = safeJson(text);

    return {
      ideaName: String(extracted.ideaName || ""),
      sector: String(extracted.sector || "Uncategorized"),
      description: String(extracted.description || sourceText.slice(0, 200)),
      problem: String(extracted.problem || ""),
      solution: String(extracted.solution || ""),
      targetCustomer: String(extracted.targetCustomer || ""),
      monetization: String(extracted.monetization || ""),
    };
  },
});

export const executeBenchmark = internalAction({
  args: { jobId: v.id("benchmarkJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runQuery(internal.benchmarkJobs.getJobForWorker, { jobId });
    if (!job || job.status === "completed") return null;
    const args = job;
    const ownerId = job.ownerId;
    try {
    await ctx.runMutation(internal.benchmarkJobs.updateJob, { jobId, status: "running", progress: "Collecting benchmark sources" });
    const key = env.GEMINI_API_KEY;
    if (!key) throw new Error("Benchmarking is not configured. Set GEMINI_API_KEY in Convex environment variables.");

    const input: Array<Record<string, unknown>> = [];
    const brief = [args.description, args.problem && `Problem: ${args.problem}`, args.solution && `Solution: ${args.solution}`, args.targetCustomer && `Target: ${args.targetCustomer}`, args.monetization && `Monetization: ${args.monetization}`].filter(Boolean).join("\n\n");

    const crawl = await ctx.runAction(internal.scouting.collectBenchmarkArticles, {});
    await ctx.runMutation(internal.benchmarkJobs.updateJob, { jobId, status: "running", progress: `Summarizing ${crawl.articles.length} collected articles` });
    const sourceArticles = await summarizeBenchmarkArticles(key, crawl.articles, () => waitForGeminiSlot(ctx));
    const domains = Array.from(new Set(crawl.articles.flatMap((article) => {
      try { return [new URL(article.url).hostname.replace(/^www\./, "")]; } catch { return []; }
    })));
    const crawledEvidence = sourceArticles.map((article, index) =>
      `ARTICLE ${index + 1}\nTitle: ${article.title}\nSource: ${article.sourceName} (${article.sourceRegion}; ${article.sourceCategory})\nURL: ${article.url}\nPublished: ${article.publishedDate || "Not stated"}\nSummary: ${article.summary}\nInitiatives: ${article.relatedInitiatives.join(", ") || "None identified"}`
    ).join("\n\n");
    const searchInstruction = `CRITICAL RESEARCH INSTRUCTION: Use Google Search to find real, comparable solutions and direct sources. Prioritize curated source domains where relevant:
${domains.map((domain: string) => `site:${domain}`).join(" OR ")}
Registry crawl coverage: ${crawl.sourcesSucceeded} of ${crawl.sourcesAttempted} active sources returned pages${crawl.failedSources.length ? `; failures: ${crawl.failedSources.join("; ")}` : "."}
Use both the crawled evidence below and web search. Do not invent user counts, customers, revenue, transaction volumes, funding, or outcomes. For each numeric claim, provide the value, unit, and reporting period/year, and cite a source URL that directly supports it. If a figure is not publicly available, say so. Distinguish sourced facts from comparative analysis.

Crawled registry articles:
${crawledEvidence}`;

    const prompt = `You are a market research analyst preparing a comparative benchmark report. Research the venture described below by analyzing similar solutions and how they were executed in three groups:
1. Nearby African markets, including Nigeria where relevant.
2. Other emerging markets outside the nearby African group.
3. Developed markets.

Aim for at least two relevant, well-documented examples in each group when evidence permits. Prioritize direct company, regulator, investor, or reputable research sources. If a group has insufficient reliable evidence, say so rather than padding with weak matches.

The report must be descriptive and evidence-led. Do not score, grade, rank, or assess the venture against criteria. Do not create new venture ideas or gap-driven concepts. Compare existing similar solutions and explain:
- scale using numeric evidence where published (customers/users, merchants, countries, transaction volume, revenue, loan book, capacity, or another relevant measure); include unit and as-of date/year;
- business model, payer/customer, pricing or revenue streams, and key partners;
- execution model and distribution/operating approach;
- what appears to have worked, supported by evidence;
- challenges, pivots, shutdowns, or limits where reported;
- useful cross-market patterns and context that may explain differences.

Return ONLY a JSON object with this structure:
{
  "ideaName": "${args.ideaName.trim()}",
  "sector": "${args.sector.trim()}",
  "description": "${args.description.slice(0, 300)}",
  "executiveSummary": "A concise synthesis of the strongest comparable evidence and how outcomes differ by market group.",
  "marketContext": "Relevant demand, infrastructure, regulation, and market-structure context across the three groups.",
  "executionInsights": ["Evidence-backed execution pattern with cited example"],
  "marketLessons": ["Evidence-backed comparison or transferability lesson; do not recommend or score the submitted venture."],
  "benchmarks": [
    {
      "companyName": "string",
      "country": "string",
      "regionTier": "Nearby Africa|Other Emerging Market|Developed Market",
      "launchYear": "string",
      "status": "Active|Pivoted|Shut down|Not verified",
      "businessModel": "Payer, pricing/revenue streams, and how the model operates",
      "operationalScale": "Brief headline scale metric with value, unit, and reporting year; or Not publicly reported",
      "scaleMetrics": [
        {"metric": "e.g. annual transactions", "value": "number and unit", "asOf": "reporting year/date", "sourceUrl": "https://direct-source"}
      ],
      "customersAndRevenues": "Reported customer/revenue figures with units and period, or Not publicly reported",
      "executionModel": "How the product/service was delivered and distributed",
      "whatWorked": "Evidence-backed factors associated with adoption or operating success",
      "challenges": "Reported constraints, pivots, or failure factors; or Not publicly reported",
      "keyPartners": "Relevant partners and their role",
      "lessonsLearned": "Descriptive lesson from this precedent",
      "sourceUrl": "https://direct-source",
      "sourceName": "string"
    }
  ]
}

Include up to nine strong comparables. Ensure the benchmark set covers all three groups where credible evidence exists. Each scale metric sourceUrl and each company's sourceUrl must be a direct URL present in the crawled material or the search citations. Do not substitute model judgement for missing figures. Keep claims concise enough to compare across companies.

Venture: ${args.ideaName}
Sector: ${args.sector}
Brief: ${brief}`;
    input.unshift({ type: "text", text: prompt });

    const model = env.GEMINI_BENCHMARK_MODEL || env.GEMINI_MODEL || "gemini-3.1-pro-preview";
    await waitForGeminiSlot(ctx);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model,
        input,
        tools: [{ type: "google_search" }],
        response_format: { type: "text", mime_type: "application/json" },
        generation_config: { thinking_level: "low", max_output_tokens: 8192 },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`Research provider returned ${response.status}: ${detail}`);
    }

    const payload = await response.json() as any;
    const modelOutput = payload.steps?.find((step: any) => step.type === "model_output");
    const textBlocks = modelOutput?.content?.filter((part: any) => part.type === "text") || [];
    const text = textBlocks.map((part: any) => part.text || "").join("");
    if (!text) throw new Error("The research provider returned no report.");

    const generated = safeJson(text);
    const groundedUrls: string[] = [
      ...textBlocks.flatMap((part: any) => part.annotations || [])
      .map((annotation: any) => annotation.url)
      .filter((url: unknown): url is string => typeof url === "string" && /^https:\/\//.test(url)),
      ...crawl.articles.map((article) => article.url),
    ];
    const groundedUrlSet = new Set(groundedUrls.map((url) => new URL(url).toString()));

    const benchmarks = Array.isArray(generated.benchmarks) ? generated.benchmarks.flatMap((item: any) => {
      if (!item || typeof item !== "object" || !isGroundedUrl(item.sourceUrl, groundedUrlSet)) return [];
      const companyName = typeof item.companyName === "string" ? item.companyName.trim() : "";
      if (!companyName) return [];
      const regionTier = item.regionTier === "Nearby Africa"
        ? "Nearby Africa"
        : ["Other Emerging Market", "Emerging Peer"].includes(item.regionTier) ? "Other Emerging Market"
        : ["Developed Market", "Global Leader"].includes(item.regionTier) ? "Developed Market"
        : "Unclassified";
      const scaleMetrics = Array.isArray(item.scaleMetrics) ? item.scaleMetrics.flatMap((metric: any) => {
        if (!metric || typeof metric !== "object" || typeof metric.metric !== "string" || typeof metric.value !== "string" || !isGroundedUrl(metric.sourceUrl, groundedUrlSet)) return [];
        return [{
          metric: metric.metric,
          value: metric.value,
          ...(typeof metric.asOf === "string" && metric.asOf ? { asOf: metric.asOf } : {}),
          sourceUrl: metric.sourceUrl,
        }];
      }) : [];
      return [{
        companyName,
        country: typeof item.country === "string" ? item.country : "Not stated",
        regionTier,
        launchYear: item.launchYear ? String(item.launchYear) : undefined,
        status: typeof item.status === "string" ? item.status : "Not verified",
        operationalScale: item.operationalScale ? String(item.operationalScale) : undefined,
        businessModel: typeof item.businessModel === "string" ? item.businessModel : "",
        customersAndRevenues: item.customersAndRevenues ? String(item.customersAndRevenues) : undefined,
        keyPartners: item.keyPartners ? String(item.keyPartners) : undefined,
        lessonsLearned: typeof item.lessonsLearned === "string" ? item.lessonsLearned : "",
        scaleMetrics,
        executionModel: typeof item.executionModel === "string" ? item.executionModel : undefined,
        whatWorked: typeof item.whatWorked === "string" ? item.whatWorked : undefined,
        challenges: typeof item.challenges === "string" ? item.challenges : undefined,
        sourceUrl: item.sourceUrl,
        sourceName: typeof item.sourceName === "string" && item.sourceName.trim() ? item.sourceName : new URL(item.sourceUrl).hostname,
        confidence: "Source linked; verify claims at source",
      }];
    }) : [];
    const report = {
      ideaName: String(generated.ideaName || args.ideaName || "Venture concept"),
      sector: String(generated.sector || args.sector || "Fintech & Financial Inclusion"),
      conceptHash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([ownerId, args.ideaName, args.sector, args.description, args.flowType])))))
        .map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      modelVersion: env.GEMINI_BENCHMARK_MODEL || env.GEMINI_MODEL || "gemini-3.1-pro-preview",
      promptVersion: "comparative-market-report-v1",
      description: String(generated.description || brief),
      problem: String(args.problem || generated.problem || ""),
      solution: String(args.solution || generated.solution || ""),
      targetCustomer: String(args.targetCustomer || generated.targetCustomer || ""),
      monetization: String(args.monetization || generated.monetization || ""),
      flowType: "benchmark_report",
      executiveSummary: typeof generated.executiveSummary === "string" ? generated.executiveSummary : "",
      marketContext: typeof generated.marketContext === "string" ? generated.marketContext : "",
      executionInsights: Array.isArray(generated.executionInsights) ? generated.executionInsights.filter((item: unknown): item is string => typeof item === "string") : [],
      marketLessons: Array.isArray(generated.marketLessons) ? generated.marketLessons.filter((item: unknown): item is string => typeof item === "string") : [],
      sourcesCrawled: crawl.sourcesSucceeded,
      sourceCrawlFailures: crawl.failedSources,
      sourceArticles,
      counts: {
        total: benchmarks.length,
        nearbyAfrica: benchmarks.filter((item: any) => item.regionTier === "Nearby Africa").length,
        emergingPeers: benchmarks.filter((item: any) => item.regionTier === "Other Emerging Market").length,
        globalLeaders: benchmarks.filter((item: any) => item.regionTier === "Developed Market").length,
      },
      benchmarks,
    };

    const id: Id<"benchmarks"> = await ctx.runMutation(internal.benchmarks.saveGenerated, {
      ownerId,
      ...report,
    });

    await ctx.runMutation(internal.benchmarkJobs.updateJob, { jobId, status: "completed", progress: "Benchmark report is ready", benchmarkId: id });
    return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Benchmark research failed.";
      await ctx.runMutation(internal.benchmarkJobs.updateJob, { jobId, status: "failed", progress: "Benchmark research failed", error: message.slice(0, 1200) });
      return null;
    }
  },
});
