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
    const prompt = `Assess this venture for early-stage investment and Nigerian operating fit. Use Google Search for current evidence. For the strategic_alignment criterion (20 points), assess fit with the strategies and stated priorities of Trium, Coronation Group, and Access Bank, and identify practical ways the idea could leverage each organization's relevant capabilities, assets, customer reach, distribution channels, data, partnerships, or networks. Assess the three organizations separately; use current official sources where available, do not assume their strategies are identical, and do not assume the venture has access to any resource or partnership that has not been established. If public evidence is insufficient, state that clearly and score cautiously. Do not claim Vanta or portfolio duplicate matching; that system is not connected. Return only JSON with keys: {"summary":"string","viabilityScore":number,"viabilityRating":"High|Medium|Low","viabilityVerdict":"string","dimensions":[{"dimension":"string","rating":"string","rationale":"string"}],"screeningScore":number,"grade":"A*|A|B|C|D","strengths":["string"],"risks":["string"],"criteriaScores":object,"recommendation":"string","goToMarket":"string","financialAssumptions":"string","regulatoryConsiderations":"string","emailAlert":"boolean"}. Scores and grades are an AI preliminary assessment, not a formal investment decision. Explain missing information. Do not invent measured results, market sizes, legal conclusions, team credentials, traction, customers, or revenue. Put no unsupported factual statistics in the result.

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
  args: { scoutType: screeningSourceType, candidates: v.array(scoutCandidate), batchId: v.optional(v.id("screeningBatches")) },
  returns: v.object({ processed: v.number(), errors: v.array(v.string()) }),
  handler: async (ctx, { scoutType, candidates, batchId }) => {
    const errors: string[] = [];
    let processed = 0;
    const key = env.GEMINI_API_KEY, apiKey = env.VANTA_API_KEY, apiBase = env.VANTA_API_BASE_URL;
    if (!key) {
      const missingKeyError = "Gemini is not configured; candidates were not screened.";
      if (batchId) await ctx.runMutation(internal.screeningBatches.recordScreeningBatchChunk, {
        batchId, completed: candidates.length, processed: 0, failed: candidates.length, errors: [missingKeyError],
      });
      return { processed: 0, errors: [missingKeyError] };
    }
    let portfolio: Array<Record<string, unknown>> = [];
    let portfolioAvailable = false;
    let portfolioLoaded = false;
    const loadPortfolio = async () => {
      if (portfolioLoaded) return;
      portfolioLoaded = true;
      if (!apiKey || !apiBase) {
        errors.push("Reva screening continued; Vanta duplicate checking is not configured.");
        return;
      }
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
    };

    const ownerId = "reva-scout";
    for (const candidate of candidates.slice(0, 20)) {
      try {
        // Decide Nigerian market viability first. Only Medium/High ideas proceed
        // to the seven-criteria summary and scorecard.
        const assessment = await assessCandidateViability(key, candidate, scoutType, () => waitForGeminiSlot(ctx));
        const dimensions = viabilityDimensions.map((dimension) => {
          const item = Array.isArray(assessment.dimensions) ? assessment.dimensions.find((entry: any) => entry?.dimension === dimension) : null;
          const rating = item?.rating === "High" || item?.rating === "Medium" ? item.rating : "Low";
          return { dimension, rating, rationale: String(item?.rationale || "Evidence was insufficient to support a higher rating.").slice(0, 700) };
        });
        const viabilityCounts = { High: 0, Medium: 0, Low: 0 };
        for (const item of dimensions) viabilityCounts[item.rating as keyof typeof viabilityCounts]++;
        const viabilityRating = viabilityCounts.High >= 3 ? "High" : viabilityCounts.High + viabilityCounts.Medium >= 4 ? "Medium" : "Low";
        const viabilityScore = Math.round(dimensions.reduce((sum, item) => sum + (item.rating === "High" ? 100 : item.rating === "Medium" ? 60 : 20), 0) / dimensions.length);

        // Vanta duplication check is the next stage after passing Nigeria
        // viability, before expanding or scoring the seven-criteria summary.
        if (viabilityRating !== "Low") await loadPortfolio();
        const matches = viabilityRating !== "Low" && portfolioAvailable ? portfolioMatch(candidate, portfolio) : [];
        const match = matches[0] || null;
        const duplicateMatches = matches.filter((item) => item.score >= 0.45);

        let criteriaScores: Record<string, { score: number; maxScore: number; rationale: string; summary: string }> = {};
        let expandedSummary = "";
        let score = 0;
        let grade = "D";
        if (viabilityRating !== "Low") {
          const viabilityContext = {
            viabilityRating,
            viabilityScore,
            viabilityVerdict: String(assessment.viabilityVerdict || ""),
            dimensions,
          };
          // Complete the strongest evidence-based criterion summary before
          // asking Gemini to score it in a separate request.
          const rawEntries = await expandCandidateSummary(key, candidate, scoutType, viabilityContext, () => waitForGeminiSlot(ctx));
          const criteriaAssessment = await scoreCandidateSummary(key, candidate, viabilityContext, rawEntries, () => waitForGeminiSlot(ctx));
          const rawCriteria = criteriaAssessment.criteriaScores && typeof criteriaAssessment.criteriaScores === "object"
            ? criteriaAssessment.criteriaScores as Record<string, any>
            : {};
          const summaries: string[] = [];
          for (const [id, maxScore] of revaCriteria) {
            const summary = typeof rawEntries[id] === "string" ? rawEntries[id].trim() : "";
            const item = rawCriteria[id] && typeof rawCriteria[id] === "object" ? rawCriteria[id] : {};
            const criterionScore = Number(item.score);
            const rationale = typeof item.rationale === "string" ? item.rationale.trim() : "";
            if (!summary) throw new Error(`Gemini returned no expanded summary for ${id}.`);
            if (!Number.isFinite(criterionScore) || !rationale) throw new Error(`Gemini returned an incomplete ${id} score.`);
            criteriaScores[id] = { score: Math.max(0, Math.min(maxScore, criterionScore)), maxScore, rationale: rationale.slice(0, 600), summary: summary.slice(0, 1800) };
            const title = id.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
            summaries.push(`${title}\n${summary}`);
          }
          expandedSummary = summaries.join("\n\n");
          score = boundedScore(Object.values(criteriaScores).reduce((sum, item) => sum + item.score, 0));
          grade = score >= 86 ? "A*" : score >= 76 ? "A" : score >= 66 ? "B" : score >= 57 ? "C" : "D";
        }

        const passed = viabilityRating !== "Low" && score >= 66;
        const duplicateStatus = !portfolioAvailable ? "not_checked" : duplicateMatches.length ? (match?.exact ? "exact_match" : "similarity_match") : "checked_no_match";
        const record = {
          ownerId, name: candidate.ideaName, sector: candidate.sector, industry: candidate.industry, description: candidate.summary,
          problem: String(assessment.problem || "Not specified"), solution: String(assessment.solution || candidate.summary), targetCustomer: String(assessment.targetCustomer || "Not specified"),
          goToMarket: String(assessment.goToMarket || ""), sourceType: scoutType === "emerging_tech" ? "emerging_tech_scout" : scoutType === "nigeria_policy" ? "nigeria_policy_scout" : "benchmark_generated", sourceUrl: candidate.articleUrl, screeningKey: new URL(candidate.articleUrl).toString().toLowerCase(), modelVersion: env.GEMINI_MODEL || "gemini-3.8-flash", promptVersion: `scout-viability-then-criteria-${scoutType}-v2`, sourceMarket: "Nigeria",
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
          criteriaScores, draftSubmission: {
            executiveSummary: expandedSummary || candidate.summary,
            expandedSummary,
            criteriaEntries: Object.fromEntries(Object.entries(criteriaScores).map(([id, item]) => [id, item.summary])),
            goToMarket: String(assessment.goToMarket || ""), problem: String(assessment.problem || ""), solution: String(assessment.solution || ""),
          },
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
    if (errors.length) console.error("Scout screening completed with errors:", errors);
    if (batchId) await ctx.runMutation(internal.screeningBatches.recordScreeningBatchChunk, {
      batchId,
      completed: candidates.length,
      processed,
      failed: Math.max(0, candidates.length - processed),
      errors,
    });
    return { processed, errors };
  },
});

async function assessCandidateViability(key: string, candidate: { ideaName: string; sector: string; summary: string; articleUrl: string }, scoutType: string, reserve: () => Promise<void>) {
  const prompt = `First-stage screen: assess whether this public-source opportunity has at least Medium viability in Nigeria. Use Google Search for current Nigeria evidence. Rate these dimensions High, Medium, or Low: ${viabilityDimensions.join(", ")}. Return JSON only with viabilityVerdict, dimensions (each with dimension, rating, rationale), problem, solution, targetCustomer, goToMarket, strengths, risks, recommendation, and differentiator. Do not score the seven investment criteria in this stage. Do not invent facts; explain weak or missing evidence. This is a preliminary AI assessment, not an investment decision.\nScout type: ${scoutType}\nName: ${candidate.ideaName}\nSector: ${candidate.sector}\nIdea summary: ${candidate.summary}\nSource: ${candidate.articleUrl}`;
  return await callScreeningGemini(key, prompt, reserve, true, 3500);
}

async function expandCandidateSummary(
  key: string,
  candidate: { ideaName: string; sector: string; summary: string; articleUrl: string },
  scoutType: string,
  viability: { viabilityRating: string; viabilityScore: number; viabilityVerdict: string; dimensions: Array<{ dimension: string; rating: string; rationale: string }> },
  reserve: () => Promise<void>,
) {
  const criteria = revaCriteria.map(([id, max]) => `${id} (max ${max}): ${criterionDescription(id)}`).join("\n");
  const prompt = `Second-stage writing: this idea has passed the Medium-or-better Nigerian viability gate. Write the strongest possible evidence-backed summary for the idea against all seven scoring criteria below. Make the strongest fair case for the idea: surface its most relevant supported strengths, connect evidence to each criterion, explain credible strategic fit and leverage, and be specific rather than generic. Before returning, check that every criterion has a substantive, idea-specific section and that each uses the strongest relevant support available. Do not score the criteria in this step. Do not invent traction, market figures, capabilities, customers, partnerships, or outcomes. For strategic_alignment, assess Trium, Coronation Group, and Access Bank separately using current official sources where available; describe potential leverage accurately without implying an existing partnership or access to their assets. If evidence is missing, state the limitation clearly rather than weakening it with unsupported claims. Return one concise, substantive text section for every criterion.\n\nCriteria and weights:\n${criteria}\n\nReturn JSON only: {"criteriaEntries":{"strategic_alignment":"...","customer_problem":"...","solution_fit":"...","market_opportunity":"...","differentiation":"...","sustainable_advantage":"...","feasibility":"..."}}. Do not include any scores, grades, or scoring rationales in this response.\n\nScout type: ${scoutType}\nIdea: ${candidate.ideaName}\nSector: ${candidate.sector}\nOriginal summary: ${candidate.summary}\nSource: ${candidate.articleUrl}\nNigeria viability (${viability.viabilityRating}, ${viability.viabilityScore}/100): ${viability.viabilityVerdict}\nViability dimensions: ${viability.dimensions.map((item) => `${item.dimension}=${item.rating}: ${item.rationale}`).join("; ")}`;
  const result = await callScreeningGemini(key, prompt, reserve, true, 6000);
  if (!result.criteriaEntries || typeof result.criteriaEntries !== "object") throw new Error("Gemini returned no expanded seven-criteria summary.");
  return result.criteriaEntries as Record<string, unknown>;
}

async function scoreCandidateSummary(
  key: string,
  candidate: { ideaName: string; sector: string; summary: string; articleUrl: string },
  viability: { viabilityRating: string; viabilityScore: number; viabilityVerdict: string },
  criteriaEntries: Record<string, unknown>,
  reserve: () => Promise<void>,
) {
  const criteria = revaCriteria.map(([id, max]) => `${id} (max ${max}): ${criterionDescription(id)}`).join("\n");
  const prompt = `Third-stage scoring: independently score the completed summary sections below against the seven weighted criteria. Score only what the written section substantively supports; do not award points just because the text asserts a strength. Do not rewrite or expand the summary. Treat scores as a preliminary AI assessment. Return one numeric score within each criterion's maximum and a brief evidence-based rationale.\n\nCriteria and weights:\n${criteria}\n\nReturn JSON only: {"criteriaScores":{"strategic_alignment":{"score":0,"rationale":"..."},"customer_problem":{"score":0,"rationale":"..."},"solution_fit":{"score":0,"rationale":"..."},"market_opportunity":{"score":0,"rationale":"..."},"differentiation":{"score":0,"rationale":"..."},"sustainable_advantage":{"score":0,"rationale":"..."},"feasibility":{"score":0,"rationale":"..."}}}.\n\nIdea: ${candidate.ideaName}\nSector: ${candidate.sector}\nOriginal idea: ${candidate.summary}\nSource: ${candidate.articleUrl}\nNigeria viability: ${viability.viabilityRating} (${viability.viabilityScore}/100)\nCompleted criterion summaries:\n${revaCriteria.map(([id]) => `${id}: ${String(criteriaEntries[id] || "")}`).join("\n\n")}`;
  return await callScreeningGemini(key, prompt, reserve, false, 4000);
}

function criterionDescription(id: string) {
  const descriptions: Record<string, string> = {
    strategic_alignment: "fit with Trium, Coronation Group, and Access Bank strategies and stated priorities, including realistic ways to leverage relevant strengths",
    customer_problem: "importance and evidence of the customer problem, affected users, and willingness or ability to pay",
    solution_fit: "how clearly and practically the proposed solution addresses that problem",
    market_opportunity: "credible market size, demand, timing, and room to grow",
    differentiation: "how the solution differs from current alternatives and why the difference matters",
    sustainable_advantage: "durable advantages the venture can build and maintain",
    feasibility: "practical ability to build, operate, fund, and scale the venture",
  };
  return descriptions[id] || id;
}

async function callScreeningGemini(key: string, prompt: string, reserve: () => Promise<void>, useSearch: boolean, maxOutputTokens: number) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await reserve();
    const request: Record<string, unknown> = {
      model: env.GEMINI_MODEL || "gemini-3.8-flash",
      input: prompt,
      response_format: { type: "text", mime_type: "application/json" },
      generation_config: { thinking_level: "low", max_output_tokens: maxOutputTokens },
    };
    if (useSearch) request.tools = [{ type: "google_search" }];
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(90000),
    });
    if (response.ok) break;
    const detail = (await response.text()).slice(0, 300);
    const noFreeQuota = response.status === 429 && /limit:\s*0\s+input tokens per minute/i.test(detail);
    const retryable = response.status === 408 || response.status >= 500 || (response.status === 429 && !noFreeQuota);
    if (!retryable || attempt === 3) {
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
  returns: v.object({ batchId: v.id("screeningBatches"), processed: v.number(), queued: v.number(), errors: v.array(v.string()) }),
  handler: async (ctx, args): Promise<{ batchId: Id<"screeningBatches">; processed: number; queued: number; errors: string[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!isAuthorizedOmniIdentity(identity)) throw new Error("Unauthorized");
    const candidates = args.candidates.slice(0, 20);
    const batchId: Id<"screeningBatches"> = await ctx.runMutation(internal.screeningBatches.createScreeningBatch, {
      ownerId: identity.subject,
      scoutType: args.scoutType,
      total: candidates.length,
    });
    for (let offset = 0; offset < candidates.length; offset += 4) {
      await ctx.scheduler.runAfter(
        Math.floor(offset / 4) * 4 * 60 * 1000,
        internal.screening.processScoutCandidates,
        { scoutType: args.scoutType, candidates: candidates.slice(offset, offset + 4), batchId },
      );
    }
    const errors = args.candidates.length > 20 ? ["Only the first 20 visible candidates were queued."] : [];
    return { batchId, processed: 0, queued: candidates.length, errors };
  }
});
