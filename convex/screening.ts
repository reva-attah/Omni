"use node";

import { action, internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { isAuthorizedOmniIdentity } from "./access";
import type { Id } from "./_generated/dataModel";
import { waitForGeminiSlot } from "./geminiQueue";
import { parseModelObject, boundedScore } from "./aiValidation";

function parseModelJson(text: string) {
  return parseModelObject(text) as Record<string, any>;
}

export const screenVenture = action({
  args: {
    name: v.string(),
    sector: v.string(),
    description: v.string(),
    problem: v.string(),
    solution: v.string(),
    targetCustomer: v.string(),
    documentId: v.optional(v.id("uploadedDocuments")),
  },
  returns: v.object({ id: v.id("initiatives"), result: v.any(), emailStatus: v.string() }),
  handler: async (ctx, args): Promise<{ id: Id<"initiatives">; result: unknown; emailStatus: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("A Trium account is required");
    const key = env.GEMINI_API_KEY;
    if (!key) throw new Error("Screening is not configured. Set GEMINI_API_KEY in Convex environment variables.");
    const hasBrief = [args.description, args.problem, args.solution, args.targetCustomer].some((value) => value.trim());
    if (!hasBrief && !args.documentId) throw new Error("Provide venture details or attach a PDF/TXT brief.");

    const input: Array<Record<string, unknown>> = [];
    let brief = [args.description, args.problem && `Problem: ${args.problem}`, args.solution && `Proposed solution: ${args.solution}`, args.targetCustomer && `Target customer: ${args.targetCustomer}`].filter(Boolean).join("\n");
    if (args.documentId) {
      const doc = await ctx.runQuery(internal.files.getOwnedDocument, { id: args.documentId, ownerId: identity.subject });
      if (!doc) throw new Error("The attached document was not found in your account.");
      const url = await ctx.storage.getUrl(doc.storageId);
      if (!url) throw new Error("The uploaded document is no longer available.");
      const fileResponse = await fetch(url);
      if (!fileResponse.ok) throw new Error("Could not read the uploaded document.");
      const bytes = Buffer.from(await fileResponse.arrayBuffer());
      if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Files must be 10 MB or smaller.");
      if (doc.contentType === "text/plain") brief += `\n\nAttached brief:\n${bytes.toString("utf8")}`;
      else input.push({ type: "document", mime_type: "application/pdf", data: bytes.toString("base64") });
    }
    const prompt = `Assess this venture for early-stage investment and Nigerian operating fit. Use Google Search for current evidence. Do not claim Vanta or portfolio duplicate matching; that system is not connected. Return only JSON with keys: {"summary":"string","viabilityScore":number,"viabilityRating":"High|Medium|Low","viabilityVerdict":"string","dimensions":[{"dimension":"string","rating":"string","rationale":"string"}],"screeningScore":number,"grade":"A*|A|B|C|D","strengths":["string"],"risks":["string"],"criteriaScores":object,"recommendation":"string","goToMarket":"string","financialAssumptions":"string","regulatoryConsiderations":"string","emailAlert":"boolean"}. Scores and grades are an AI preliminary assessment, not a formal investment decision. Explain missing information. Do not invent measured results, market sizes, legal conclusions, team credentials, traction, customers, or revenue. Put no unsupported factual statistics in the result.

Name: ${args.name.trim() || "Unspecified venture"}
Sector: ${args.sector.trim() || "Unspecified"}
Brief: ${brief || "See attached file."}`;
    input.unshift({ type: "text", text: prompt });
    const model = env.GEMINI_MODEL || "gemini-3.8-flash";
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
    if (!response.ok) throw new Error(`Research provider returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
    const payload = await response.json() as any;
    const modelOutput = payload.steps?.find((step: any) => step.type === "model_output");
    const output = modelOutput?.content?.filter((part: any) => part.type === "text").map((part: any) => part.text || "").join("");
    if (!output) throw new Error("The research provider returned no assessment.");
    const modelResult = parseModelJson(output);
    const score = boundedScore(modelResult.screeningScore);
    const grade = ["A*", "A", "B", "C", "D"].includes(modelResult.grade) ? modelResult.grade : "D";
    const result = {
      ownerId: identity.subject,
      name: args.name.trim() || "Unspecified venture",
      sector: args.sector.trim() || "Unspecified",
      description: args.description.trim() || brief,
      problem: args.problem.trim() || "Not provided",
      solution: args.solution.trim() || "Not provided",
      targetCustomer: args.targetCustomer.trim() || "Not provided",
      sourceType: "on_demand",
      sourceMarket: "Nigeria",
      modelVersion: model,
      promptVersion: "on-demand-screening-v1",
      dedupeVerdict: "NOT_CHECKED",
      dedupeSimilarity: 0,
      viabilityRating: ["High", "Medium", "Low"].includes(modelResult.viabilityRating) ? modelResult.viabilityRating : "Low",
      viabilityScore: boundedScore(modelResult.viabilityScore),
      viabilityVerdict: String(modelResult.viabilityVerdict || "Insufficient evidence for a viability conclusion."),
      viabilityDimensions: Array.isArray(modelResult.dimensions) ? modelResult.dimensions.map((item: any) => ({
        dimension: String(item.dimension || "Unspecified"), rating: String(item.rating || "Unknown"), rationale: String(item.rationale || "No evidence supplied"),
      })) : [],
      vantaScore: score,
      vantaGrade: grade,
      vantaResult: "preliminary_ai_assessment",
      overallComments: String(modelResult.recommendation || modelResult.summary || "No assessment was returned."),
      keyStrengths: Array.isArray(modelResult.strengths) ? modelResult.strengths.map(String) : [],
      keyRisks: Array.isArray(modelResult.risks) ? modelResult.risks.map(String) : [],
      criteriaScores: modelResult.criteriaScores && typeof modelResult.criteriaScores === "object" ? modelResult.criteriaScores : {},
      draftSubmission: {
        executiveSummary: String(modelResult.summary || ""),
        goToMarket: String(modelResult.goToMarket || ""),
        financialProjections: String(modelResult.financialAssumptions || ""),
        regulatoryStrategy: String(modelResult.regulatoryConsiderations || ""),
      },
      status: "screened",
      emailDispatched: false,
    };
    const id: Id<"initiatives"> = await ctx.runMutation(internal.initiatives.saveEvaluatedInitiative, result);

    let emailStatus = "not_eligible";
    const threshold = Number(env.DIT_ALERT_THRESHOLD_SCORE || "66");
    const recipient = env.DIT_NOTIFICATION_EMAIL;
    if (score >= threshold) {
      if (!recipient || !env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
        emailStatus = "not_configured";
      } else {
        const subject = `Reva preliminary screening: ${grade} · ${result.name}`;
        const summary = String(result.overallComments);
        try {
          await ctx.runMutation(internal.emailLogs.queueScreeningAlert, {
            ownerId: identity.subject,
            initiativeId: id,
            initiativeName: result.name,
            recipient,
            subject,
            vantaGrade: grade,
            vantaScore: score,
            html: `<h2>${escapeHtml(result.name)}</h2><p><strong>Preliminary AI score:</strong> ${score}/100 (${escapeHtml(grade)})</p><p>${escapeHtml(summary)}</p><p>AI-generated assessment for human review. No Vanta portfolio duplicate check was performed.</p>`,
            text: `${result.name}\nPreliminary AI score: ${score}/100 (${grade})\n${summary}\nAI-generated assessment for human review. No Vanta portfolio duplicate check was performed.`,
          });
          emailStatus = "queued";
        } catch (err) {
          emailStatus = err instanceof Error && err.message.includes("Resend is not configured") ? "not_configured" : "failed";
        }
      }
    }    return { id, result: { ...result, _id: id, createdAt: Date.now(), emailDispatched: emailStatus === "delivered" }, emailStatus };
  },
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));
}

const scoutCandidate = v.object({ articleUrl: v.string(), ideaName: v.string(), sector: v.string(), industry: v.optional(v.string()), summary: v.string() });
const screeningSourceType = v.union(v.literal("emerging_tech"), v.literal("nigeria_policy"), v.literal("benchmark"));
const viabilityDimensions = ["Demand and affordability", "Regulation", "Infrastructure and payments", "Competition", "Unit economics and FX", "Distribution and trust"];
const revaCriteria = [["strategic_alignment", 20], ["customer_problem", 20], ["solution_fit", 15], ["market_opportunity", 15], ["differentiation", 10], ["sustainable_advantage", 10], ["feasibility", 10]] as const;

export const processScoutCandidates = internalAction({
  args: { scoutType: screeningSourceType, candidates: v.array(scoutCandidate) },
  returns: v.object({ processed: v.number(), errors: v.array(v.string()) }),
  handler: async (ctx, { scoutType, candidates }) => {
    const errors: string[] = [];
    let processed = 0;
    const key = env.GEMINI_API_KEY, apiKey = env.VANTA_API_KEY, apiBase = env.VANTA_API_BASE_URL;
    if (!key) return { processed: 0, errors: ["Gemini is not configured; candidates were not screened."] };
    let portfolio: Array<Record<string, unknown>> = [];
    let portfolioAvailable = false;
    if (apiKey && apiBase) {
      try {
        const url = new URL("/api/v1/portfolio?limit=1000", apiBase);
        if (url.protocol !== "https:") throw new Error("Vanta API must use HTTPS.");
        const response = await fetch(url, { headers: { authorization: "Bearer " + apiKey, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error("Vanta read API returned HTTP " + response.status + ".");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("items" in payload) || !Array.isArray(payload.items)) throw new Error("Vanta returned an unexpected portfolio response.");
        portfolio = payload.items.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
        portfolioAvailable = true;
      } catch (error) {
        errors.push("Reva screening continued, but Vanta duplicate checking was unavailable: " + (error instanceof Error ? error.message : "Could not read Vanta portfolio."));
      }
    } else {
      errors.push("Reva screening continued; Vanta duplicate checking is not configured.");
    }

    const ownerId = "reva-scout";
    for (const candidate of candidates.slice(0, 20)) {
      try {
        const matches = portfolioAvailable ? portfolioMatch(candidate, portfolio) : [];
        const match = matches[0] || null;
        const duplicateMatches = matches.filter((item) => item.score >= 0.45);
        const assessment = await assessCandidate(key, candidate, scoutType, () => waitForGeminiSlot(ctx));
        const rawCriteria = assessment.criteriaScores && typeof assessment.criteriaScores === "object" ? assessment.criteriaScores as Record<string, any> : {};
        const criteriaScores: Record<string, { score: number; maxScore: number; rationale: string }> = {};
        for (const [id, maxScore] of revaCriteria) {
          const item = rawCriteria[id] && typeof rawCriteria[id] === "object" ? rawCriteria[id] : {};
          const criterionScore = Number(item.score);
          const rationale = typeof item.rationale === "string" ? item.rationale.trim() : "";
          if (!Number.isFinite(criterionScore) || !rationale) throw new Error(`Gemini returned an incomplete ${id} score.`);
          criteriaScores[id] = { score: Math.max(0, Math.min(maxScore, criterionScore)), maxScore, rationale: rationale.slice(0, 600) };
        }
        const score = boundedScore(Object.values(criteriaScores).reduce((sum, item) => sum + item.score, 0));
        const grade = score >= 86 ? "A*" : score >= 76 ? "A" : score >= 66 ? "B" : score >= 57 ? "C" : "D";
        const dimensions = viabilityDimensions.map((dimension) => {
          const item = Array.isArray(assessment.dimensions) ? assessment.dimensions.find((entry: any) => entry?.dimension === dimension) : null;
          const rating = item?.rating === "High" || item?.rating === "Medium" ? item.rating : "Low";
          return { dimension, rating, rationale: String(item?.rationale || "Evidence was insufficient to support a higher rating.").slice(0, 700) };
        });
        const counts = { High: 0, Medium: 0, Low: 0 };
        for (const item of dimensions) counts[item.rating as keyof typeof counts]++;
        const viabilityRating = counts.High >= 3 ? "High" : counts.High + counts.Medium >= 4 ? "Medium" : "Low";
        const viabilityScore = Math.round(dimensions.reduce((sum, item) => sum + (item.rating === "High" ? 100 : item.rating === "Medium" ? 60 : 20), 0) / dimensions.length);
        const passed = viabilityRating !== "Low" && score >= 66;
        const duplicateStatus = !portfolioAvailable ? "not_checked" : duplicateMatches.length ? (match?.exact ? "exact_match" : "similarity_match") : "checked_no_match";
        const record = {
          ownerId, name: candidate.ideaName, sector: candidate.sector, industry: candidate.industry, description: candidate.summary,
          problem: String(assessment.problem || "Not specified"), solution: String(assessment.solution || candidate.summary), targetCustomer: String(assessment.targetCustomer || "Not specified"),
          goToMarket: String(assessment.goToMarket || ""), sourceType: scoutType === "emerging_tech" ? "emerging_tech_scout" : scoutType === "nigeria_policy" ? "nigeria_policy_scout" : "benchmark_generated", sourceUrl: candidate.articleUrl, screeningKey: new URL(candidate.articleUrl).toString().toLowerCase(), modelVersion: env.GEMINI_MODEL || "gemini-3.8-flash", promptVersion: `scout-assessment-${scoutType}-v1`, sourceMarket: "Nigeria",
          dedupeVerdict: !portfolioAvailable ? "NOT_CHECKED" : duplicateMatches.length ? (match?.exact ? "EXACT_DUPLICATE" : "NEAR_SIMILAR") : "NEW", dedupeSimilarity: match?.score || 0, matchingVantaId: match?.id, matchingVantaName: match?.name,
          ...(portfolioAvailable ? {
            vantaDuplicateFound: duplicateMatches.length > 0,
            vantaDuplicateCount: duplicateMatches.length,
            matchingVantaList: duplicateMatches.slice(0, 20).map((item) => ({
              name: item.name,
              similarity: item.score,
              description: item.description,
              status: item.status,
            })),
          } : {}),
          dedupeDifferentiator: match ? String(assessment.differentiator || "Requires human review against the similar Vanta initiative.") : undefined,
          viabilityRating, viabilityScore, viabilityVerdict: String(assessment.viabilityVerdict || "Preliminary Nigeria viability assessment based on public sources."), viabilityDimensions: dimensions,
          vantaScore: score, vantaGrade: grade, vantaResult: passed ? "passed" : "declined", overallComments: String(assessment.recommendation || "Preliminary AI assessment; review source evidence before action."),
          keyStrengths: Array.isArray(assessment.strengths) ? assessment.strengths.map(String).slice(0, 8) : [],
          keyRisks: Array.isArray(assessment.risks) ? assessment.risks.map(String).slice(0, 8) : [],
          criteriaScores, draftSubmission: { executiveSummary: candidate.summary, goToMarket: String(assessment.goToMarket || ""), problem: String(assessment.problem || ""), solution: String(assessment.solution || "") },
          status: passed ? "passed" : viabilityRating === "Low" ? "parked_below_viability" : "parked_below_pass",
          emailDispatched: false, vantaSubmissionStatus: duplicateStatus,
        };
        const id = await ctx.runMutation(internal.initiatives.saveEvaluatedInitiative, record);
        processed++;
        if (passed) {
          const recipient = env.DIT_NOTIFICATION_EMAIL;
          if (!recipient || !env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) errors.push(candidate.ideaName + ": passed, but DIT email is not fully configured.");
          else {
            try {
              const dimensionHtml = dimensions.map((item) => "<li><strong>" + escapeHtml(item.dimension) + " — " + item.rating + ":</strong> " + escapeHtml(item.rationale) + "</li>").join("");
              const criteriaHtml = Object.entries(criteriaScores).map(([name, item]) => "<li><strong>" + escapeHtml(name.replace(/_/g, " ")) + ":</strong> " + item.score + "/" + item.maxScore + " — " + escapeHtml(item.rationale) + "</li>").join("");
              const dimensionText = dimensions.map((item) => "- " + item.dimension + " — " + item.rating + ": " + item.rationale).join("\n");
              const criteriaText = Object.entries(criteriaScores).map(([name, item]) => "- " + name.replace(/_/g, " ") + ": " + item.score + "/" + item.maxScore + " — " + item.rationale).join("\n");
              await ctx.runMutation(internal.emailLogs.queueScreeningAlert, {
                ownerId, initiativeId: id, initiativeName: candidate.ideaName, recipient,
                subject: (scoutType === "benchmark" ? "Reva benchmark idea passed: " : "Reva scout passed: ") + grade + " · " + candidate.ideaName, vantaGrade: grade, vantaScore: score,
                html: "<h2>" + escapeHtml(candidate.ideaName) + "</h2><p>Sector: " + escapeHtml(candidate.sector) + "</p><p>Nigeria viability: " + escapeHtml(viabilityRating) + " (" + viabilityScore + "/100)</p><ul>" + dimensionHtml + "</ul><p>Reva 7-criteria grade: " + grade + " (" + score + "/100)</p><ul>" + criteriaHtml + "</ul><p>" + escapeHtml(record.overallComments) + "</p><p><strong>Strengths:</strong> " + escapeHtml(record.keyStrengths.join("; ") || "None identified") + "</p><p><strong>Risks:</strong> " + escapeHtml(record.keyRisks.join("; ") || "None identified") + "</p><p>Vanta duplicate status: " + escapeHtml(duplicateStatus) + ". Source: <a href=\"" + escapeHtml(candidate.articleUrl) + "\">" + escapeHtml(candidate.articleUrl) + "</a></p><p>AI assessment for DIT review; not a final investment decision.</p>",
                text: candidate.ideaName + "\nSector: " + candidate.sector + "\nNigeria viability: " + viabilityRating + " (" + viabilityScore + "/100)\n" + dimensionText + "\nReva 7-criteria grade: " + grade + " (" + score + "/100)\n" + criteriaText + "\n" + record.overallComments + "\nStrengths: " + record.keyStrengths.join("; ") + "\nRisks: " + record.keyRisks.join("; ") + "\nVanta duplicate status: " + duplicateStatus + "\nSource: " + candidate.articleUrl + "\nAI assessment for DIT review; not a final investment decision.",
              });
            } catch (error) { errors.push(candidate.ideaName + ": passed, but DIT email queue failed: " + (error instanceof Error ? error.message : "unknown Resend error")); }
          }
        }
      } catch (error) {
        errors.push(candidate.ideaName + ": " + (error instanceof Error ? error.message : "Assessment failed."));
      }
    }
    if (candidates.length > 20) errors.push("Only 20 of " + candidates.length + " candidates were screened; remaining candidates need a later run.");
    return { processed, errors };
  },
});

async function assessCandidate(key: string, candidate: { ideaName: string; sector: string; summary: string; articleUrl: string }, scoutType: string, reserve: () => Promise<void>) {
  const criteria = revaCriteria.map(([id, max]) => id + "=" + max).join(", ");
  const prompt = "Assess this public-source idea for Nigerian market viability and Reva's seven investment criteria. Use Google Search for current Nigeria evidence. Do not invent facts; mark weak evidence Low. Viability dimension labels exactly: " + viabilityDimensions.join(", ") + ". Rate High, Medium, or Low. Reva criterion keys and maximum points: " + criteria + ". Return JSON only: {\"problem\":\"\", \"solution\":\"\", \"targetCustomer\":\"\", \"goToMarket\":\"\", \"viabilityVerdict\":\"\", \"dimensions\":[{\"dimension\":\"\", \"rating\":\"High|Medium|Low\", \"rationale\":\"\"}], \"criteriaScores\":{\"criterion\":{\"score\":0,\"rationale\":\"Evidence-based rationale\"}}, \"strengths\":[], \"risks\":[], \"recommendation\":\"\", \"differentiator\":\"\"}. This is preliminary AI judgment, not a final investment decision.\\nScout: " + scoutType + "\\nName: " + candidate.ideaName + "\\nSector: " + candidate.sector + "\\nSummary: " + candidate.summary + "\\nSource: " + candidate.articleUrl;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    await reserve();
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ model: env.GEMINI_MODEL || "gemini-3.8-flash", input: prompt, tools: [{ type: "google_search" }], response_format: { type: "text", mime_type: "application/json" }, generation_config: { thinking_level: "low", max_output_tokens: 4500 } }),
      signal: AbortSignal.timeout(90000),
    });
    if (response.ok) break;
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const detail = (await response.text()).slice(0, 300);
    if (!retryable || attempt === 5) {
      throw new Error(`Gemini screening returned HTTP ${response.status} after ${attempt + 1} attempt(s). ${detail}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(Math.max(retryAfter * 1000, 1000), 120000)
      : response.status === 429
        ? Math.min(60000 * (2 ** attempt) + Math.random() * 1000, 120000)
        : Math.min(1000 * (2 ** attempt) + Math.random() * 500, 10000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!response?.ok) throw new Error("Gemini screening failed after retrying transient errors.");
  const payload: any = await response.json();
  const text = payload.steps?.find((step: any) => step.type === "model_output")?.content?.filter((part: any) => part.type === "text")?.map((part: any) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned no screening assessment.");
  return parseModelJson(text);
}

function portfolioMatch(candidate: { ideaName: string; sector: string; summary: string }, portfolio: Array<Record<string, unknown>>) {
  const normalize = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|and|for|with|from|into|platform|solution|system|app)\b/g, " ").replace(/\s+/g, " ").trim();
  const tokens = (value: string) => new Set(normalize(value).split(" ").filter((word) => word.length > 2));
  const name = normalize(candidate.ideaName);
  const matches: Array<{ score: number; id?: string; name: string; description: string; status: string; exact: boolean }> = [];
  for (const item of portfolio) {
    const existingName = normalize(item.name);
    if (!existingName) continue;
    const exact = name === existingName;
    const left = tokens(candidate.ideaName + " " + candidate.sector + " " + candidate.summary);
    const right = tokens(String(item.name) + " " + String(item.sector || "") + " " + String(item.description || ""));
    const overlap = [...left].filter((token) => right.has(token)).length;
    const score = exact ? 1 : (left.size + right.size ? 2 * overlap / (left.size + right.size) : 0);
    if (exact || score >= 0.38) {
      matches.push({
        score,
        id: typeof item.id === "string" ? item.id : undefined,
        name: String(item.name).slice(0, 180),
        description: String(item.description || item.summary || "").slice(0, 1000),
        status: String(item.status || item.portfolioTab || "Unknown").slice(0, 100),
        exact,
      });
    }
  }
  return matches.sort((left, right) => right.score - left.score);
}

export const screenBatch = action({
  args: { scoutType: screeningSourceType, candidates: v.array(scoutCandidate) },
  returns: v.object({ processed: v.number(), errors: v.array(v.string()) }),
  handler: async (ctx, args): Promise<{ processed: number; errors: string[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("Unauthorized");
    return await ctx.runAction(internal.screening.processScoutCandidates, args);
  }
});
