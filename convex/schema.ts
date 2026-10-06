import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  // ── 1. FLOW 1 & 4A/4B: BENCHMARK REPORTS & GAP INITIATIVES ────────────────
  benchmarks: defineTable({
    ownerId:         v.optional(v.string()),
    ideaName:        v.string(),
    sector:          v.optional(v.string()),
    conceptHash:     v.string(),
    modelVersion:    v.optional(v.string()),
    promptVersion:   v.optional(v.string()),
    description:     v.string(),
    problem:         v.string(),
    solution:        v.string(),
    targetCustomer:  v.string(),
    monetization:    v.optional(v.string()),
    flowType:        v.optional(v.string()),
    executiveSummary: v.optional(v.string()),
    marketContext:    v.optional(v.string()),
    executionInsights: v.optional(v.array(v.string())),
    marketLessons:    v.optional(v.array(v.string())),
    sourcesCrawled:  v.optional(v.number()),
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

    // Peer market empirical benchmarks array
    benchmarks: v.array(v.object({
      companyName:      v.string(),
      country:          v.string(),
      regionTier:       v.string(), // "Nearby Africa" | "Emerging Peer" | "Global Leader"
      launchYear:       v.optional(v.string()),
      status:           v.string(), // "Active" | "Pivoted" | "Shut down"
      fundingRaised:    v.optional(v.string()),
      operationalScale: v.optional(v.string()),
      businessModel:    v.string(),
      customersAndRevenues: v.optional(v.string()),
      roiAndViability:  v.optional(v.string()),
      keyPartners:      v.optional(v.string()),
      lessonsLearned:   v.string(),
      scaleMetrics: v.optional(v.array(v.object({
        metric: v.string(),
        value: v.string(),
        asOf: v.optional(v.string()),
        sourceUrl: v.string(),
      }))),
      executionModel: v.optional(v.string()),
      whatWorked: v.optional(v.string()),
      challenges: v.optional(v.string()),
      sourceUrl:        v.string(),
      sourceName:       v.string(),
      confidence:       v.string(),
    })),

    // Localization blueprint: What to Apply vs What to Avoid in Nigeria
    blueprint: v.optional(v.object({
      whatToApply: v.array(v.object({
        title:             v.string(),
        recommendation:    v.string(),
        parallelBenchmark: v.string(),
      })),
      whatToAvoid: v.array(v.object({
        title:         v.string(),
        warning:       v.string(),
        pitfallReason: v.string(),
      })),
      recurringPatterns:     v.array(v.string()),
      triumStrategicVerdict: v.string(),
    })),

    // Reva 7-Criteria Assessment (Flow 4A)
    scoringCriteria: v.optional(v.any()),

    // Gap Analysis & Viable Initiative Ideas (Flow 4B)
    gapInitiativeIdeas: v.optional(v.array(v.object({
      ideaName:           v.string(),
      description:        v.string(),
      category:           v.string(),
      problem:            v.string(),
      solution:           v.string(),
      similarSolutions:   v.string(),
      targetCustomer:     v.string(),
      goToMarket:         v.string(),
      valueDrivers:       v.array(v.string()),
      monetization:       v.string(),
      additionalDetails:  v.optional(v.string()),
      sourceLink:         v.optional(v.string()),
    }))),

    counts: v.object({
      total:         v.number(),
      nearbyAfrica:  v.number(),
      emergingPeers: v.number(),
      globalLeaders: v.number(),
    }),

    createdAt: v.number(),
  })
    .index("by_conceptHash", ["conceptHash"])
    .index("by_name",        ["ideaName"])
    .index("by_createdAt",   ["createdAt"])
    .index("by_owner_createdAt", ["ownerId", "createdAt"])
    .index("by_owner_conceptHash", ["ownerId", "conceptHash"]),

  // ── 2. FLOWS 2a, 2b, 2c & IN-HOUSE 7-CRITERIA EVALUATIONS ─────────────────
  initiatives: defineTable({
    ownerId:         v.optional(v.string()),
    name:             v.string(),
    sector:           v.optional(v.string()),
    industry:         v.optional(v.string()),
    description:      v.string(),
    problem:          v.string(),
    solution:         v.string(),
    targetCustomer:   v.string(),
    goToMarket:       v.optional(v.string()),
    expectedRevenue:  v.optional(v.string()),
    similarSolutions: v.optional(v.string()),

    // Provenance & Source
    sourceType:   v.string(), // "on_demand" | "emerging_tech_scout" | "nigeria_policy_scout"
    sourceUrl:    v.optional(v.string()),
    screeningKey: v.optional(v.string()),
    modelVersion: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    sourceMarket: v.optional(v.string()),
    policyClause: v.optional(v.string()), // For 2c regulatory catalyst

    // Deduplication status vs Vanta Idea Bank
    dedupeVerdict:        v.string(), // "NEW" | "NEAR_SIMILAR" | "EXACT_DUPLICATE"
    dedupeSimilarity:     v.number(),
    matchingVantaId:      v.optional(v.string()),
    matchingVantaName:    v.optional(v.string()),
    dedupeDifferentiator: v.optional(v.string()),
    vantaDuplicateFound:  v.optional(v.boolean()),
    vantaDuplicateCount:  v.optional(v.number()),
    matchingVantaList:    v.optional(v.any()), // Array of { name, similarity, description }
    vantaSubmissionStatus: v.optional(v.string()),
    vantaSubmissionId:     v.optional(v.string()),

    // Nigeria Market Viability Assessment (6 Dimensions)
    viabilityRating:   v.string(), // "High" | "Medium" | "Low"
    viabilityScore:    v.number(),
    viabilityVerdict:  v.string(),
    viabilityDimensions: v.optional(v.array(v.object({
      dimension: v.string(),
      rating:    v.string(),
      rationale: v.string(),
    }))),

    // In-House Trium 7-Criteria Scorecard (20, 20, 15, 15, 10, 10, 10 = 100)
    vantaScore:       v.number(), // 0 to 100
    vantaGrade:       v.string(), // "A*" | "A" | "B" | "C" | "D"
    vantaResult:      v.string(), // "passed" | "reserved" | "declined"
    overallComments:  v.string(),
    keyStrengths:     v.array(v.string()),
    keyRisks:         v.array(v.string()),
    criteriaScores:   v.any(),    // Detailed 7 criteria breakdown with considerations & rationales
    draftSubmission:  v.any(),    // Pre-drafted submission responses
    tldr:             v.optional(v.any()),

    // Lifecycle Fate & Status
    status: v.string(), // "passed" | "dropped_exact_duplicate" | "parked_below_viability" | "parked_below_pass"

    // DIT Notification Dispatch Tracking
    emailDispatched:   v.boolean(),
    emailDispatchedAt: v.optional(v.number()),
    emailRecipient:    v.optional(v.string()), // "digital-incubation@trium.ng"

    createdAt: v.number(),
  })
    .index("by_name",       ["name"])
    .index("by_owner_name", ["ownerId", "name"])
    .index("by_owner_screeningKey", ["ownerId", "screeningKey"])
    .index("by_status",     ["status"])
    .index("by_sourceType", ["sourceType"])
    .index("by_vantaGrade", ["vantaGrade"])
    .index("by_createdAt",  ["createdAt"])
    .index("by_owner_createdAt", ["ownerId", "createdAt"]),

  // ── 3. IDEMPOTENT SCRAPING HASH REGISTRY (2b & 2c) ───────────────────────
  scrapedItems: defineTable({
    urlHash:       v.string(),
    url:           v.string(),
    title:         v.string(),
    sourceName:    v.string(),
    sourceType:    v.string(), // "emerging_tech" | "nigeria_policy"
    contentHash:   v.string(),
    content:       v.optional(v.string()),
    aiSummary:     v.optional(v.string()),
    potentialIdea: v.optional(v.string()),
    aiSector:      v.optional(v.string()),
    industry:      v.optional(v.string()),
    isNewInSession: v.optional(v.boolean()),
    sessionDate:   v.optional(v.string()),
    sessionId:     v.optional(v.string()),
    processedAt:   v.number(),
    status:        v.string(), // "processed" | "skipped" | "duplicate"
    publishedDate: v.optional(v.string()),
    isArchived:    v.optional(v.boolean()),
  })
    .index("by_urlHash",     ["urlHash"])
    .index("by_contentHash", ["contentHash"])
    .index("by_sourceType",  ["sourceType"])
    .index("by_processedAt", ["processedAt"])
    .index("by_isArchived_processedAt", ["isArchived", "processedAt"]),

  scoutArticleSessions: defineTable({
    runId: v.id("scoutRuns"),
    articleId: v.id("scrapedItems"),
    urlHash: v.string(),
    scoutType: v.union(v.literal("emerging_tech"), v.literal("nigeria_policy")),
    isNewInSession: v.boolean(),
    sessionDate: v.string(),
    processedAt: v.number(),
    isArchived: v.optional(v.boolean()),
  })
    .index("by_runId_and_urlHash", ["runId", "urlHash"])
    .index("by_processedAt", ["processedAt"])
    .index("by_scoutType_and_processedAt", ["scoutType", "processedAt"])
    .index("by_isArchived_processedAt", ["isArchived", "processedAt"]),

  // ── 4. CURATED SOURCES & REGULATORY REGISTRY ─────────────────────────────
  sourceRegistry: defineTable({
    name:         v.string(),
    url:          v.string(),
    feedUrl:      v.optional(v.string()),
    region:       v.string(),
    tier:         v.string(), // "tier_a_emerging" | "tier_b_global" | "nigeria_regulator" | "nigeria_legal"
    category:     v.string(), // "Emerging Market Primary" | "Nigerian Regulatory, Legal and Policy Environment" | "Global Fallback"
    sector:       v.optional(v.string()),
    industry:     v.optional(v.string()),
    dateAdded:    v.optional(v.number()),
    isActive:     v.boolean(),
    lastScrapedAt: v.optional(v.number()),
    failureCount:  v.number(),

    // Legacy Vanta flag remains optional so existing source records stay valid.
    signOffRevaAdmin:  v.boolean(),
    signOffVantaAdmin: v.optional(v.boolean()),
    approvedAt:        v.optional(v.number()),
  })
    .index("by_tier",     ["tier"])
    .index("by_isActive", ["isActive"])
    .index("by_category", ["category"])
    .index("by_name",     ["name"])
    .index("by_url",      ["url"]),

  scoutRuns: defineTable({
    scoutType: v.union(v.literal("emerging_tech"), v.literal("nigeria_policy"), v.literal("full_patrol")),
    trigger: v.union(v.literal("scheduled"), v.literal("manual")),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("partial"), v.literal("failed")),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    sourcesChecked: v.number(),
    articlesFound: v.number(),
    newArticles: v.number(),
    ideasFound: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_startedAt", ["startedAt"])
    .index("by_scoutType_startedAt", ["scoutType", "startedAt"]),

  screeningBatches: defineTable({
    ownerId: v.string(),
    scoutType: v.union(v.literal("emerging_tech"), v.literal("nigeria_policy"), v.literal("benchmark")),
    total: v.number(),
    completed: v.number(),
    processed: v.number(),
    failed: v.number(),
    status: v.union(v.literal("queued"), v.literal("processing"), v.literal("completed")),
    errors: v.array(v.string()),
    queuedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_owner_queuedAt", ["ownerId", "queuedAt"]),

  scoutFindings: defineTable({
    runId: v.id("scoutRuns"),
    scoutType: v.union(v.literal("emerging_tech"), v.literal("nigeria_policy")),
    articleTitle: v.string(),
    articleUrl: v.string(),
    sourceName: v.string(),
    sourceUrl: v.string(),
    publishedAt: v.optional(v.string()),
    ideaName: v.string(),
    sector: v.string(),
    industry: v.optional(v.string()),
    summary: v.string(),
    isNewInSession: v.optional(v.boolean()),
    sessionDate:   v.optional(v.string()),
    sessionId:     v.optional(v.string()),
    status: v.union(v.literal("new"), v.literal("reviewed"), v.literal("dismissed")),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_scoutType_createdAt", ["scoutType", "createdAt"])
    .index("by_sector", ["sector"])
    .index("by_articleUrl", ["articleUrl"]),

  // ── 5. AUTOMATIONS HUB ───────────────────────────────────────────────────
  automations: defineTable({
    key:            v.string(),
    title:          v.string(),
    description:    v.string(),
    trigger:        v.string(),
    action:         v.string(),
    actionType:     v.optional(v.union(v.literal("both_scouts"), v.literal("emerging_scout"), v.literal("policy_scout"))),
    intervalMinutes: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    category:       v.string(),
    isActive:       v.boolean(),
    lastRunAt:      v.optional(v.number()),
    executionCount: v.number(),
    status:         v.string(), // "active" | "paused" | "running" | "failed"
    lastError:      v.optional(v.string()),
    createdAt:      v.number(),
  })
    .index("by_key", ["key"])
    .index("by_isActive", ["isActive"])
    .index("by_createdAt", ["createdAt"]),

  // ── 6. DIT EMAIL NOTIFICATION AUDIT LOGS ─────────────────────────────────
  emailLogs: defineTable({
    ownerId:      v.optional(v.string()),
    initiativeId: v.optional(v.string()),
    initiativeName: v.string(),
    recipient:    v.string(),
    subject:      v.string(),
    vantaGrade:   v.string(),
    vantaScore:   v.number(),
    status:       v.string(), // "sent" | "failed"
    provider:     v.string(), // "resend" | "smtp"
    messageId:    v.optional(v.string()),
    error:        v.optional(v.string()),
    dispatchedAt: v.number(),
  })
    .index("by_recipient",    ["recipient"])
    .index("by_dispatchedAt", ["dispatchedAt"])
    .index("by_owner_dispatchedAt", ["ownerId", "dispatchedAt"])
    .index("by_messageId", ["messageId"])
    .index("by_initiativeId", ["initiativeId"]),

  uploadedDocuments: defineTable({
    ownerId: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    createdAt: v.number(),
  }).index("by_owner_createdAt", ["ownerId", "createdAt"]),

  benchmarkDrafts: defineTable({
    ownerId: v.string(),
    updatedAt: v.number(),
    flowType: v.string(),
    inputText: v.string(),
    brief: v.object({ ideaName: v.string(), sector: v.string(), description: v.string(), problem: v.string(), solution: v.string(), targetCustomer: v.string(), monetization: v.string() }),
    step: v.number(),
    documentId: v.optional(v.id("uploadedDocuments")),
    jobId: v.optional(v.id("benchmarkJobs")),
    fileName: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),

  benchmarkJobs: defineTable({
    ownerId: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    progress: v.string(),
    ideaName: v.string(), sector: v.string(), description: v.string(), problem: v.string(), solution: v.string(), targetCustomer: v.string(), monetization: v.string(),
    flowType: v.string(), documentId: v.optional(v.id("uploadedDocuments")), fileName: v.optional(v.string()),
    benchmarkId: v.optional(v.id("benchmarks")), error: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_owner_createdAt", ["ownerId", "createdAt"]),

  geminiQueue: defineTable({ key: v.string(), nextSlotAt: v.number() }).index("by_key", ["key"]),

  analyticsCounters: defineTable({ key: v.string(), value: v.number() }).index("by_key", ["key"]),
});
