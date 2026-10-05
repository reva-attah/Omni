import { PageLoader } from "./Loader";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { extractLocalDocumentText, extractBriefLocally } from "../utils/documentExtractor";
import { normalizeSector, CANONICAL_SECTORS } from "./Dashboard";

const blankBrief = {
  ideaName: "",
  sector: "Uncategorized",
  description: "",
  problem: "",
  solution: "",
  targetCustomer: "",
  monetization: ""
};

export const ASSESSMENT_GUIDE_CRITERIA = [
  {
    id: "strategicAlignment",
    num: 1,
    title: "Strategic Alignment",
    weight: 20,
    considerations: [
      "Does this idea adhere to our ideation themes?",
      "Is the idea consistent with our long-term vision and goals?",
      "Does the idea fit into our strategy wheel, starting with our discriminating capabilities?"
    ],
    scoringTip: "Score 0–20. Full marks (20) = idea fully satisfies all considerations. Half marks (10) = partially meets them. 0 = does not meet this criterion."
  },
  {
    id: "customerProblem",
    num: 2,
    title: "Customer-Problem",
    weight: 20,
    considerations: [
      "Does the idea solve a real and specific problem that customers or partners face?",
      "Is the solution something customers would be willing to adopt and pay for?",
      "How well does the solution match the needs and expectations of the target audience?"
    ],
    scoringTip: "Score 0–20. Full marks (20) = idea fully satisfies all considerations. Half marks (10) = partially meets them. 0 = does not meet this criterion."
  },
  {
    id: "solutionFit",
    num: 3,
    title: "Solution Fit",
    weight: 15,
    considerations: [
      "Can this idea increase our customer base and help us launch in new markets?",
      "Is the estimated market size large enough to make this an attractive opportunity?",
      "Do we understand the market dynamics well enough to become a leading player?"
    ],
    scoringTip: "Score 0–15. Full marks (15) = idea fully satisfies all considerations. Half marks (8) = partially meets them. 0 = does not meet this criterion."
  },
  {
    id: "marketOpportunity",
    num: 4,
    title: "Market Opportunity",
    weight: 15,
    considerations: [
      "What makes this idea unique versus existing competitors' offerings?",
      "Does this idea meaningfully improve processes, enhance or introduce new products?",
      "Can this idea make a significant impact in the market and in people's lives?"
    ],
    scoringTip: "Score 0–15. Full marks (15) = idea fully satisfies all considerations. Half marks (8) = partially meets them. 0 = does not meet this criterion."
  },
  {
    id: "differentiation",
    num: 5,
    title: "Differentiation",
    weight: 10,
    considerations: [
      "How can this idea continue to grow and remain relevant in the future?",
      "How strong / mature is the competition in this space?",
      "Can we entrench our position and defend against disruption / disintermediation?"
    ],
    scoringTip: "Score 0–10. Full marks (10) = idea fully satisfies all considerations. Half marks (5) = partially meets them. 0 = does not meet this criterion."
  },
  {
    id: "sustainableAdvantage",
    num: 6,
    title: "Sustainable Advantage",
    weight: 10,
    considerations: [
      "Do we have the resources to bring the idea to life?",
      "Do we have or can we easily acquire the technology or expertise to make this idea work?",
      "Are there any obstacles that can impede successful implementation of the idea?"
    ],
    scoringTip: "Score 0–10. Full marks (10) = idea fully satisfies all considerations. Half marks (5) = partially meets them. 0 = does not meet this criterion."
  },
  {
    id: "feasibility",
    num: 7,
    title: "Feasibility",
    weight: 10,
    considerations: [
      "Can we build on this idea with additional features / capabilities / offerings?",
      "How easily can this idea expand into new markets / industries / customer segments?"
    ],
    scoringTip: "Score 0–10. Full marks (10) = idea fully satisfies all considerations. Half marks (5) = partially meets them. 0 = does not meet this criterion."
  }
];

function CrawledArticleEvidence({ report }) {
  const articles = report.sourceArticles || [];
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.ceil(articles.length / pageSize) || 1;
  const pageArticles = articles.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [report._id, articles.length]);

  return (
    <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-900/10 pb-3">
        <div>
          <h3 className="text-base font-bold text-on-surface font-headline">Crawled source evidence</h3>
          <p className="mt-1 text-xs text-secondary">{report.sourcesCrawled ?? 0} active sources crawled · {articles.length} relevant article references</p>
        </div>
        {report.sourceCrawlFailures?.length > 0 && <span className="text-xs font-semibold text-amber-800">{report.sourceCrawlFailures.length} source crawl failures</span>}
      </div>
      {report.sourceCrawlFailures?.length > 0 && (
        <details className="mt-3 rounded-lg bg-amber-500/5 px-3 py-2 text-xs text-amber-900">
          <summary className="cursor-pointer font-semibold">View sources that could not be crawled</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {report.sourceCrawlFailures.map((failure, index) => <li key={`${index}-${failure}`}>{failure}</li>)}
          </ul>
        </details>
      )}
      {pageArticles.length ? (
        <div className="divide-y divide-amber-900/10">
          {pageArticles.map((article) => (
            <article key={article.url} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <a href={article.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-on-surface hover:text-primary hover:underline">
                  {article.title}
                </a>
                <p className="mt-0.5 text-[11px] text-secondary">{article.sourceName} · {article.sourceRegion} · {article.sourceCategory}{article.publishedDate ? ` · ${article.publishedDate}` : ""}</p>
                <p className="mt-2 text-xs leading-relaxed text-secondary">{article.summary}</p>
                {article.relatedInitiatives?.length > 0 && (
                  <p className="mt-2 text-[11px] text-on-surface"><strong>Initiatives identified:</strong> {article.relatedInitiatives.join(", ")}</p>
                )}
              </div>
              <a href={article.url} target="_blank" rel="noreferrer" aria-label={`Open ${article.title}`} className="inline-flex items-center gap-1 self-start text-xs font-semibold text-primary hover:underline">
                Source <span className="material-symbols-outlined text-[14px]">open_in_new</span>
              </a>
            </article>
          ))}
        </div>
      ) : (
        <p className="py-5 text-xs text-secondary">No article-level summaries were returned for this report.</p>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-amber-900/10 pt-3 text-xs">
          <span className="text-secondary">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-md bg-surface-low px-3 py-1.5 font-semibold text-on-surface disabled:opacity-40">Previous</button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-md bg-surface-low px-3 py-1.5 font-semibold text-on-surface disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function GlobalBenchmark({ benchmarks, benchmarkDraft, benchmarkJobs, saveBenchmarkDraft, onExtractBrief, onRunBenchmark, onUploadDocument }) {
  const hasLoadedBenchmarks = benchmarks !== undefined;
  const savedBenchmarks = benchmarks ?? [];
  const [activeFlow, setActiveFlow] = useState("flow4a_benchmark"); // 'flow4a_benchmark' | 'flow4b_gap_initiatives'
  const [step, setStep] = useState(1);
  const [inputText, setInputText] = useState("");
  const [brief, setBrief] = useState(blankBrief);
  const [fileName, setFileName] = useState("");
  const [documentId, setDocumentId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [localReport, setLocalReport] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [screeningIdeas, setScreeningIdeas] = useState(false);
  const [screeningNotice, setScreeningNotice] = useState("");
  const [screeningError, setScreeningError] = useState("");
  const fileInput = useRef(null);
  const hydrated = useRef(false);
  const screenBatch = useAction(api.screening.screenBatch);
  const activeJob = useQuery(api.benchmarkJobs.getMyJob, selectedJobId ? { jobId: selectedJobId } : "skip");
  const attachedDocument = useQuery(api.files.getDocumentUrl, (documentId || activeJob?.documentId) ? { id: documentId || activeJob.documentId } : "skip");

  useEffect(() => {
    if (benchmarkDraft === undefined || hydrated.current) return;
    hydrated.current = true;
    if (!benchmarkDraft) return;
    setBrief(benchmarkDraft.brief);
    setInputText(benchmarkDraft.inputText);
    setActiveFlow(benchmarkDraft.flowType);
    setStep(benchmarkDraft.step);
    setDocumentId(benchmarkDraft.documentId || null);
    setSelectedJobId(benchmarkDraft.jobId || null);
    setFileName(benchmarkDraft.fileName || "");
  }, [benchmarkDraft]);

  useEffect(() => {
    if (!selectedJobId && benchmarkJobs?.length) {
      const latest = benchmarkJobs.find((job) => job.status === "queued" || job.status === "running");
      if (latest) setSelectedJobId(latest._id);
    }
  }, [benchmarkJobs, selectedJobId]);

  useEffect(() => {
    if (activeJob?.status === "completed" && activeJob.report) {
      setSelectedId(activeJob.benchmarkId);
      setStep(3);
      setRunning(false);
    } else if (activeJob?.status === "failed") {
      setError(activeJob.error || "Benchmark research failed.");
      setRunning(false);
    } else if (activeJob?.status === "queued" || activeJob?.status === "running") setRunning(true);
  }, [activeJob]);

  useEffect(() => {
    if (!hydrated.current || !saveBenchmarkDraft) return;
    const timer = setTimeout(() => saveBenchmarkDraft({
      updatedAt: Date.now(), flowType: activeFlow, inputText, brief, step, documentId: documentId || undefined, jobId: selectedJobId || undefined, fileName: fileName || undefined,
    }).catch((err) => console.warn("Could not save benchmark draft", err)), 350);
    return () => clearTimeout(timer);
  }, [activeFlow, inputText, brief, step, documentId, selectedJobId, fileName, saveBenchmarkDraft]);

  const selectedReport = useMemo(
    () => activeJob?.report || localReport || savedBenchmarks.find((report) => report._id === selectedId) || null,
    [savedBenchmarks, localReport, selectedId, activeJob],
  );

  const updateBrief = (field, value) => setBrief((current) => ({ ...current, [field]: value }));

  // Bulletproof Document Upload & Extraction
  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setInfoMessage("");
    setUploading(true);
    setFileName(file.name);
    setDocumentId(null);

    try {
      if (file.size > 10 * 1024 * 1024) {
        throw new Error("Files must be 10 MB or smaller.");
      }
      let rawText = "";
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!onUploadDocument) throw new Error("Document storage is not available.");
      const uploadedDocumentId = await onUploadDocument(file);
      setDocumentId(uploadedDocumentId);
      await saveBenchmarkDraft?.({
        updatedAt: Date.now(), flowType: activeFlow, inputText, brief, step, documentId: uploadedDocumentId, fileName: file.name,
      });

      // 1. Extract raw text locally first (works for PDF, DOCX, PPTX, TXT, MD)
      try {
        rawText = await extractLocalDocumentText(file);
      } catch (localErr) {
        console.warn("Local text extraction notice:", localErr);
      }

      let extracted = null;

      // 2. Attempt remote Gemini extraction via Convex if available
      if (onExtractBrief) {
        try {
          if (extension === "pdf") {
            extracted = await onExtractBrief({ text: inputText.trim() || undefined, documentId: uploadedDocumentId });
          } else if (rawText) {
            extracted = await onExtractBrief({ text: [inputText.trim(), rawText].filter(Boolean).join("\n\n") });
          }
        } catch (convexErr) {
          console.warn("Remote brief extraction unavailable, activating NLP heuristic parser:", convexErr);
        }
      }

      // 3. Guaranteed client-side heuristic NLP fallback
      if (!extracted || !extracted.ideaName) {
        if (extension === "pdf") {
          throw new Error("Gemini could not extract this PDF. Try a text-based PDF or paste its contents into the description field.");
        }
        extracted = extractBriefLocally(rawText || inputText);
        setInfoMessage("A draft was prepared locally. Review every field before running research.");
      }

      setBrief({ ...blankBrief, ...extracted });
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process this document. Please enter idea text directly.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  // Bulletproof Text Extraction
  const extractFromText = async (event) => {
    event.preventDefault();
    if (!inputText.trim()) {
      setError("Please describe the initiative so Omni can prepare your structured brief.");
      return;
    }
    setError("");
    setInfoMessage("");
    setUploading(true);

    try {
      let extracted = null;
      if (onExtractBrief) {
        try {
          extracted = await onExtractBrief({ text: inputText.trim() });
        } catch (convexErr) {
          console.warn("Remote brief extraction unavailable, falling back to local NLP parser:", convexErr);
        }
      }

      if (!extracted || !extracted.ideaName) {
        extracted = extractBriefLocally(inputText.trim());
        setInfoMessage("Brief parsed and formatted. Please review and refine the fields below.");
      }

      setBrief({ ...blankBrief, ...extracted });
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the venture brief.");
    } finally {
      setUploading(false);
    }
  };

  // Start Benchmark Research (Flow 4A or Flow 4B)
  const startResearch = async (event) => {
    event.preventDefault();
    if (!brief.ideaName.trim() && !brief.description.trim() && !brief.problem.trim() && !brief.solution.trim()) {
      setError("Add an initiative name and describe the problem/solution before research.");
      return;
    }
    setError("");
    setRunning(true);

    try {
      let result = null;
      if (onRunBenchmark) {
        try {
          result = await onRunBenchmark({
            ...brief,
            ideaName: brief.ideaName.trim(),
            sector: normalizeSector(brief.sector),
            flowType: activeFlow,
            documentId: documentId || undefined,
            fileName: fileName || undefined,
          });
        } catch (convexErr) {
          console.error("Convex research action failed:", convexErr);
          throw convexErr;
        }
      }

      if (result) {
        setSelectedJobId(result);
        await saveBenchmarkDraft?.({ updatedAt: Date.now(), flowType: activeFlow, inputText, brief, step, documentId: documentId || undefined, jobId: result, fileName: fileName || undefined });
        setRunning(true);
        setInfoMessage("Benchmark queued. You can leave this page; Omni will keep the run and uploaded file reference.");
        return;
      }
      throw new Error("Benchmark could not be queued. Check your connection and try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Benchmark research failed.");
    } finally {
      setRunning(false);
    }
  };

  const exportReport = async (format) => {
    if (!selectedReport) return;
    setError("");
    try {
      const exporter = await import("../utils/clientExporter");
      if (format === "pdf") await exporter.exportToPdf(selectedReport);
      else if (format === "docx") await exporter.exportToWord(selectedReport);
      else await exporter.exportToPowerPoint(selectedReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report export failed.");
    }
  };

  const copyIdea = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const screenGeneratedIdeas = async () => {
    const ideas = selectedReport?.gapInitiativeIdeas || [];
    if (!ideas.length) return;
    const citedIdeas = ideas.filter((idea) => idea.sourceLink);
    if (!citedIdeas.length) {
      setScreeningError("These saved ideas have no benchmark source link, so they cannot be sent for duplicate matching or screening.");
      return;
    }
    setScreeningIdeas(true);
    setScreeningNotice("");
    setScreeningError("");
    try {
      const result = await screenBatch({
        scoutType: "benchmark",
        candidates: citedIdeas.map((idea) => ({
          articleUrl: idea.sourceLink,
          ideaName: idea.ideaName,
          sector: idea.category,
          summary: [idea.description, idea.problem, idea.solution].filter(Boolean).join("\n"),
        })),
      });
      setScreeningNotice(`Omni screened ${result.processed} of ${citedIdeas.length} cited ideas. Passing opportunities are queued to DIT when email is configured.`);
      if (result.errors.length) setScreeningError(result.errors.join(" "));
    } catch (err) {
      setScreeningError(err instanceof Error ? err.message : "Could not screen generated ideas.");
    } finally {
      setScreeningIdeas(false);
    }
  };

  if (!hasLoadedBenchmarks) {
    return <PageLoader label="Loading Benchmarks..." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12 font-body text-on-surface">
      {/* Top Banner - Compact Vanta Fluid Design */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl bg-white/75 backdrop-blur-xs p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-primary/10 text-primary">
              Module 01 · Venture Benchmarking Engine
            </span>
            <span className="text-[11px] font-medium text-secondary">Trium / Coronation Group</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface font-headline">
            {activeFlow === "flow4a_benchmark"
              ? "Global Precedent Benchmarking & 7-Criteria IC Assessment"
              : "Gap Analysis & Viable Initiative Ideas Generator"}
          </h1>
          <p className="mt-1 max-w-3xl text-xs text-secondary leading-relaxed">
            {activeFlow === "flow4a_benchmark"
              ? "Benchmark against real peer companies across Nearby Africa, Emerging Peers, and Global Leaders with full 7-Criteria Investment Committee Assessment."
              : "Scout competitor precedents, identify unaddressed Nigerian operational gaps, and synthesize viable initiative ideas tailored to fill the opportunity."}
          </p>
        </div>

        {/* Dual Flow Selector Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-surface-low rounded-xl border border-amber-900/10 shrink-0">
          <button
            type="button"
            onClick={() => { setActiveFlow("flow4a_benchmark"); if (step === 3) setStep(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeFlow === "flow4a_benchmark"
                ? "bg-primary text-white shadow-xs"
                : "text-secondary hover:text-on-surface"
            }`}
          >
            Benchmark report
          </button>
          <button
            type="button"
            onClick={() => { setActiveFlow("flow4b_gap_initiatives"); if (step === 3) setStep(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeFlow === "flow4b_gap_initiatives"
                ? "bg-primary text-white shadow-xs"
                : "text-secondary hover:text-on-surface"
            }`}
          >
            Gap-driven ideas
          </button>
        </div>
      </header>

      {/* Stepper Progress Bar */}
      <ol className="grid grid-cols-3 gap-2 rounded-xl bg-white/70 p-2 text-xs border border-amber-900/10">
        {[
          { label: "Input Initiative Brief", num: "01" },
          { label: "Review & Refine Brief", num: "02" },
          { label: activeFlow === "flow4a_benchmark" ? "Precedent Report & 7-Criteria Score" : "Gap Analysis & Viable Ideas", num: "03" }
        ].map((item, index) => (
          <li
            key={item.num}
            className={`rounded-lg px-3 py-2 font-semibold transition-all flex items-center gap-2 ${
              step === index + 1
                ? "bg-primary text-white shadow-xs"
                : step > index + 1
                ? "bg-primary/10 text-primary"
                : "text-secondary"
            }`}
          >
            <span className="opacity-70 font-mono text-[11px]">{item.num}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ol>

      {/* STEP 1: Input Idea Brief */}
      {step === 1 && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
          {/* Text Input Card */}
          <form
            onSubmit={extractFromText}
            className="flex flex-col justify-between rounded-xl bg-white/80 p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-bold text-on-surface font-headline">Describe the Initiative</h2>
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded">Prompt Mode</span>
              </div>
              <p className="text-xs text-secondary leading-relaxed mb-3">
                Include the problem in Nigeria, proposed solution, target customers, and revenue model when known.
              </p>
              <textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                rows={9}
                maxLength={100000}
                placeholder="Example: AgriTrack B2B - Grain quality assay and warehouse receipt clearing app for industrial flour millers in northern Nigeria to eliminate adulteration and informal cash payment friction..."
                className="w-full resize-y rounded-lg border border-amber-900/15 bg-surface-low p-3 text-xs leading-relaxed text-on-surface outline-none focus:border-primary focus:bg-white transition-all"
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-amber-900/10">
              <span className="text-[11px] text-secondary">
                {activeFlow === "flow4a_benchmark" ? "Will extract brief for 7-criteria assessment" : "Will extract brief for gap-driven idea generation"}
              </span>
              <button
                type="submit"
                disabled={uploading}
                className="h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-container shadow-xs transition-all disabled:opacity-60 flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">psychology</span>
                <span>{uploading ? "Extracting brief…" : "Extract Brief"}</span>
              </button>
            </div>
          </form>

          {/* File Upload Card */}
          <div className="flex flex-col justify-between rounded-xl bg-white/80 p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined rounded-lg bg-primary/10 p-2 text-xl text-primary">upload_file</span>
                <div>
                  <h2 className="text-base font-bold text-on-surface font-headline">Upload Initiative Document</h2>
                  <p className="text-[11px] text-secondary">PDF, Word (.docx), PowerPoint (.pptx), TXT, or MD</p>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-secondary mb-4">
                Upload existing investment teasers, pitch decks, IC memos, or concept notes. Client-side intelligence extracts the brief instantly.
              </p>
              {fileName && (
                <div className="flex items-center gap-2 rounded-lg bg-surface-low p-2.5 text-xs text-on-surface border border-amber-900/10 mb-3">
                  <span className="material-symbols-outlined text-primary text-[18px]">description</span>
                  <span className="font-semibold truncate flex-1">{fileName}</span>
                  <span className="material-symbols-outlined text-emerald-600 text-[18px]">check_circle</span>
                </div>
              )}
            </div>

            <div>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.docx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
                onChange={handleFile}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="w-full h-10 rounded-lg border border-amber-900/15 bg-surface-low hover:bg-white text-xs font-semibold text-on-surface shadow-xs transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px] text-primary">attach_file</span>
                <span>{uploading ? "Extracting text from file…" : "Choose Document (PDF, DOCX, PPTX)"}</span>
              </button>
              <p className="mt-2 text-[10px] text-secondary text-center">Files up to 10 MB processed securely.</p>
            </div>
          </div>
        </section>
      )}

      {/* STEP 2: Review and Refine Brief */}
      {step === 2 && (
        <form
          onSubmit={startResearch}
          className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-amber-900/10">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">edit_note</span>
                <h2 className="text-base font-bold text-on-surface font-headline">Review & Refine Extracted Brief</h2>
              </div>
              <p className="text-xs text-secondary mt-0.5">
                Verify or adjust the extracted parameters before running benchmarking.
              </p>
            </div>
            {fileName && (
              <span className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
                Source: {fileName}
                {attachedDocument?.url && <a href={attachedDocument.url} target="_blank" rel="noreferrer" className="underline">Open stored file</a>}
              </span>
            )}
          </div>

          {infoMessage && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              <span>{infoMessage}</span>
            </div>
          )}

          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-on-surface">
              <span className="text-[10px] uppercase font-bold tracking-wider text-secondary block mb-1">Initiative Name *</span>
              <input
                type="text"
                required
                value={brief.ideaName}
                onChange={(e) => updateBrief("ideaName", e.target.value)}
                className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
              />
            </label>

            <label className="block text-xs font-semibold text-on-surface">
              <span className="text-[10px] uppercase font-bold tracking-wider text-secondary block mb-1">Sector Classification</span>
              <select
                value={normalizeSector(brief.sector)}
                onChange={(e) => updateBrief("sector", e.target.value)}
                className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
              >
                {CANONICAL_SECTORS.filter((s) => s !== "All Sectors").map((sec) => (
                  <option key={sec} value={sec}>{sec}</option>
                ))}
              </select>
            </label>

            <label className="sm:col-span-2 block text-xs font-semibold text-on-surface">
              <span className="text-[10px] uppercase font-bold tracking-wider text-secondary block mb-1">Concept Description</span>
              <textarea
                rows={2}
                value={brief.description}
                onChange={(e) => updateBrief("description", e.target.value)}
                className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white resize-none"
              />
            </label>

            <label className="block text-xs font-semibold text-on-surface">
              <span className="text-[10px] uppercase font-bold tracking-wider text-secondary block mb-1">Problem Being Solved</span>
              <textarea
                rows={3}
                value={brief.problem}
                onChange={(e) => updateBrief("problem", e.target.value)}
                className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white resize-none"
              />
            </label>

            <label className="block text-xs font-semibold text-on-surface">
              <span className="text-[10px] uppercase font-bold tracking-wider text-secondary block mb-1">Proposed Solution & Technology</span>
              <textarea
                rows={3}
                value={brief.solution}
                onChange={(e) => updateBrief("solution", e.target.value)}
                className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white resize-none"
              />
            </label>

            <label className="block text-xs font-semibold text-on-surface">
              <span className="text-[10px] uppercase font-bold tracking-wider text-secondary block mb-1">Target Customer / Segments</span>
              <input
                type="text"
                value={brief.targetCustomer}
                onChange={(e) => updateBrief("targetCustomer", e.target.value)}
                className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
              />
            </label>

            <label className="block text-xs font-semibold text-on-surface">
              <span className="text-[10px] uppercase font-bold tracking-wider text-secondary block mb-1">Monetization & Commercial Model</span>
              <input
                type="text"
                value={brief.monetization}
                onChange={(e) => updateBrief("monetization", e.target.value)}
                className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-amber-900/10">
            <button
              type="button"
              onClick={() => { setStep(1); setError(""); setInfoMessage(""); }}
              className="px-3.5 py-2 rounded-lg border border-amber-900/15 bg-white text-xs font-semibold text-secondary hover:bg-surface-low transition-all"
            >
              ← Back to Input
            </button>
            <button
              type="submit"
              disabled={running}
              className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-container text-xs font-semibold text-white shadow-xs transition-all disabled:opacity-60 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
              <span>{running ? "Synthesizing benchmarks & scoring…" : activeFlow === "flow4a_benchmark" ? "Generate 7-Criteria Benchmark" : "Generate Gap-Driven Initiative Ideas"}</span>
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-800 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {(activeJob?.status === "queued" || activeJob?.status === "running") && (
        <div role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-on-surface">
          <strong>Benchmark {activeJob.status}.</strong> {activeJob.progress}. You can navigate away and return; this run and its attachment are saved.
          {activeJob.documentId && attachedDocument?.url && <a className="ml-2 font-semibold text-primary underline" href={attachedDocument.url} target="_blank" rel="noreferrer">Open {activeJob.documentName || "uploaded file"}</a>}
        </div>
      )}

      {/* STEP 3: Results Display */}
      {step === 3 && selectedReport && (
        <div className="space-y-5">
          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/80 p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary">
                {selectedReport.flowType === "flow4b_gap_initiatives" ? "Gap-driven ideas" : "Benchmark report"}
              </span>
              <h2 className="text-base font-bold text-on-surface font-headline">{selectedReport.ideaName}</h2>
              <span className="text-xs text-secondary">({selectedReport.sector})</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {attachedDocument?.url && <a href={attachedDocument.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-xs font-semibold text-primary">Open {attachedDocument.name}</a>}
              <button
                type="button"
                onClick={() => exportReport("pdf")}
                className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white text-xs font-semibold text-on-surface hover:bg-surface-low flex items-center gap-1.5 shadow-xs"
              >
                <span className="material-symbols-outlined text-[15px] text-red-600">picture_as_pdf</span>
                <span>Export PDF</span>
              </button>
              <button
                type="button"
                onClick={() => exportReport("docx")}
                className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white text-xs font-semibold text-on-surface hover:bg-surface-low flex items-center gap-1.5 shadow-xs"
              >
                <span className="material-symbols-outlined text-[15px] text-blue-600">article</span>
                <span>Export Word</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setBrief(blankBrief);
                  setInputText("");
                  setFileName("");
                  setDocumentId(null);
                  setSelectedJobId(null);
                  setLocalReport(null);
                  setError("");
                  setInfoMessage("");
                }}
                className="px-3.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-container shadow-xs"
              >
                + New Benchmark
              </button>
            </div>
          </div>

          {/* FLOW 4A: Precedent Benchmarks + 7-Criteria Assessment Guide */}
          {(!selectedReport.flowType || selectedReport.flowType === "flow4a_benchmark") && (
            <div className="space-y-5">
              {/* 7-Criteria IC Scorecard (Assessment Guide Style) */}
              <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-amber-900/10 mb-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Trium / Coronation Group Context</span>
                    <h3 className="text-lg font-bold text-on-surface font-headline flex items-center gap-2">
                      <span>Assessment Guide: Scoring Criteria & Considerations</span>
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-secondary font-medium">Composite IC Score:</span>
                    <span className="font-headline font-bold text-2xl text-primary">
                      {typeof selectedReport.scoringCriteria?.totalScore === "number" ? selectedReport.scoringCriteria.totalScore : "—"} / 100
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-800">
                      {selectedReport.scoringCriteria?.grade ? `Grade ${selectedReport.scoringCriteria.grade}` : "Not scored"}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {ASSESSMENT_GUIDE_CRITERIA.map((criterion) => {
                    const savedCriterion = selectedReport.scoringCriteria?.[criterion.id];
                    const score = typeof savedCriterion?.score === "number" ? savedCriterion.score : null;
                    const rationale = savedCriterion?.rationale || "No assessment was returned for this criterion.";
                    return (
                      <div
                        key={criterion.id}
                        className="rounded-xl bg-surface-low/80 p-4 border border-amber-900/10 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <span className="font-bold text-xs text-on-surface flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center">
                                {criterion.num}
                              </span>
                              <span>{criterion.title}</span>
                            </span>
                            <span className="text-xs font-bold text-primary font-headline">
                              {score === null ? "Not scored" : `${score} / ${criterion.weight}`}
                            </span>
                          </div>

                          <div className="w-full bg-white rounded-full h-1.5 mb-2.5">
                            <div
                              className="bg-primary h-1.5 rounded-full transition-all duration-500"
                              style={{ width: `${score === null ? 0 : (score / criterion.weight) * 100}%` }}
                            />
                          </div>

                          <div className="mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block mb-1">Key Considerations:</span>
                            <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-secondary leading-snug">
                              {criterion.considerations.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-amber-900/10 mt-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block">Assessment Evaluation:</span>
                          <p className="text-[11px] text-on-surface font-medium leading-relaxed mt-0.5">{rationale}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Sourced Peer Precedents Table */}
              <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
                <div className="flex items-center justify-between pb-3 border-b border-amber-900/10 mb-3">
                  <div>
                    <h3 className="text-base font-bold text-on-surface font-headline">Local & International Benchmarks</h3>
                    <p className="text-xs text-secondary">Gemini Search-cited precedents across nearby African, emerging, and global markets. Validate claims at source.</p>
                  </div>
                  <span className="text-xs font-bold text-primary">{selectedReport.benchmarks?.length ?? 0} Sourced Peers</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left min-w-[750px]">
                    <thead className="bg-surface-low text-secondary text-[10px] uppercase font-bold tracking-wider">
                      <tr>
                        <th className="p-2.5">Company & Country</th>
                        <th className="p-2.5">Tier</th>
                        <th className="p-2.5">Status & Scale</th>
                        <th className="p-2.5">Customers & Revenues</th>
                        <th className="p-2.5">ROI & Viability</th>
                        <th className="p-2.5">Key Partners</th>
                        <th className="p-2.5">Lessons in Nigerian Context</th>
                        <th className="p-2.5">Citation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-900/10">
                      {(selectedReport.benchmarks || []).map((peer, i) => (
                        <tr key={i} className="hover:bg-surface-low/40">
                          <td className="p-2.5 font-bold text-on-surface">
                            <div>{peer.companyName}</div>
                            <span className="text-[11px] font-normal text-secondary">{peer.country}</span>
                          </td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              peer.regionTier === "Nearby Africa" ? "bg-emerald-500/10 text-emerald-800" :
                              peer.regionTier === "Global Leader" ? "bg-purple-500/10 text-purple-800" :
                              "bg-blue-500/10 text-blue-800"
                            }`}>
                              {peer.regionTier}
                            </span>
                          </td>
                          <td className="p-2.5">
                            <span className="font-semibold text-on-surface">{peer.status}</span>
                            {peer.operationalScale && <div className="text-[11px] text-secondary">{peer.operationalScale}</div>}
                          </td>
                          <td className="p-2.5 text-on-surface text-[11px]">{peer.customersAndRevenues || "-"}</td>
                          <td className="p-2.5 text-on-surface text-[11px]">{peer.roiAndViability || "-"}</td>
                          <td className="p-2.5 text-on-surface text-[11px]">{peer.keyPartners || "-"}</td>
                          <td className="p-2.5 text-secondary leading-relaxed max-w-xs">{peer.lessonsLearned}</td>
                          <td className="p-2.5">
                            <a
                              href={peer.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline font-mono text-[11px] inline-flex items-center gap-1"
                            >
                              <span>{peer.sourceName || "Source"}</span>
                              <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <CrawledArticleEvidence key={selectedReport._id} report={selectedReport} />

              {/* What to Apply vs What to Avoid in Nigeria */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl bg-white/80 p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-emerald-600 text-[20px]">check_circle</span>
                    <h3 className="text-sm font-bold text-on-surface font-headline uppercase tracking-wider">What to Apply in Nigeria</h3>
                  </div>
                  <ul className="space-y-2.5 text-xs">
                    {(selectedReport.blueprint?.whatToApply || []).map((item, i) => (
                      <li key={i} className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <div className="font-bold text-on-surface">{item.title}</div>
                        <p className="text-secondary mt-0.5 leading-relaxed">{item.recommendation}</p>
                        {item.parallelBenchmark && (
                          <div className="text-[11px] text-primary mt-1 font-semibold">Precedent: {item.parallelBenchmark}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl bg-white/80 p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-amber-600 text-[20px]">warning</span>
                    <h3 className="text-sm font-bold text-on-surface font-headline uppercase tracking-wider">What to Avoid in Nigeria</h3>
                  </div>
                  <ul className="space-y-2.5 text-xs">
                    {(selectedReport.blueprint?.whatToAvoid || []).map((item, i) => (
                      <li key={i} className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <div className="font-bold text-on-surface">{item.title}</div>
                        <p className="text-secondary mt-0.5 leading-relaxed">{item.warning}</p>
                        {item.pitfallReason && (
                          <div className="text-[11px] text-amber-800 mt-1 font-semibold">Structural Pitfall: {item.pitfallReason}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Strategic Verdict */}
              <div className="rounded-xl bg-primary/10 p-4 border border-primary/20 text-xs">
                <span className="font-bold uppercase tracking-wider text-primary block mb-1">Trium Strategic Synthesis Verdict</span>
                <p className="text-on-surface leading-relaxed font-medium">
                  {selectedReport.blueprint?.triumStrategicVerdict || "No strategic verdict was returned."}
                </p>
              </div>
            </div>
          )}

          {/* FLOW 4B: Gap Analysis & Viable Initiative Ideas Generator */}
          {selectedReport.flowType === "flow4b_gap_initiatives" && (
            <div className="space-y-5">
              {/* Gap Analysis Summary */}
              <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-primary text-[22px]">find_in_page</span>
                  <h3 className="text-base font-bold text-on-surface font-headline">Identified Nigerian Market & Operating Gaps</h3>
                </div>
                <p className="text-xs text-secondary leading-relaxed">
                  Patterns returned from cited benchmark research. Validate each with local customer and market evidence.
                </p>
                {selectedReport.blueprint?.recurringPatterns?.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-secondary">
                    {selectedReport.blueprint.recurringPatterns.map((pattern, index) => <li key={index}>{pattern}</li>)}
                  </ul>
                ) : <p className="mt-3 text-xs text-secondary">No benchmark patterns were returned.</p>}
              </section>

              <CrawledArticleEvidence key={selectedReport._id} report={selectedReport} />

              {/* Generated Initiative Ideas in Specified Format */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-on-surface font-headline">
                    Synthesized Viable Initiative Ideas ({selectedReport.gapInitiativeIdeas?.length ?? 0} Concepts)
                  </h3>
                  <button
                    type="button"
                    onClick={screenGeneratedIdeas}
                    disabled={screeningIdeas || !selectedReport.gapInitiativeIdeas?.length}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-primary-container disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">fact_check</span>
                    {screeningIdeas ? "Checking duplicates and screening..." : "Check duplicates & screen"}
                  </button>
                </div>
                {screeningNotice && <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900">{screeningNotice}</p>}
                {screeningError && <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900">{screeningError}</p>}

                {(selectedReport.gapInitiativeIdeas || []).map((idea, idx) => (
                  <article
                    key={idx}
                    className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10 space-y-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-amber-900/10">
                      <div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary uppercase">
                          Concept 0{idx + 1} · {idea.category}
                        </span>
                        <h4 className="text-lg font-bold text-on-surface font-headline mt-1">{idea.ideaName}</h4>
                        <span className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-secondary">What is your idea?</span>
                        <p className="text-xs text-secondary italic mt-0.5">{idea.description}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => copyIdea(JSON.stringify(idea, null, 2), `idea_${idx}`)}
                        className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-surface-low hover:bg-white text-xs font-semibold text-on-surface flex items-center gap-1.5 transition-all shadow-xs"
                      >
                        <span className="material-symbols-outlined text-[15px] text-primary">
                          {copiedKey === `idea_${idx}` ? "check" : "content_copy"}
                        </span>
                        <span>{copiedKey === `idea_${idx}` ? "Copied Formatted Idea!" : "Copy Full Submission"}</span>
                      </button>
                    </div>

                    <div className="grid gap-3.5 sm:grid-cols-2 text-xs">
                      <div className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-secondary block mb-1">
                          What problem are you solving? *
                        </span>
                        <p className="text-on-surface leading-relaxed">{idea.problem}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-secondary block mb-1">
                          What is your solution to this problem / commercial opportunity? *
                        </span>
                        <p className="text-on-surface leading-relaxed">{idea.solution}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-secondary block mb-1">
                          Does a similar solution exist already? *
                        </span>
                        <p className="text-on-surface leading-relaxed">{idea.similarSolutions}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-secondary block mb-1">
                          Who is the solution for? (Target Segments) *
                        </span>
                        <p className="text-on-surface leading-relaxed">{idea.targetCustomer}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-secondary block mb-1">
                          How will we go to market with this idea? *
                        </span>
                        <p className="text-on-surface leading-relaxed">{idea.goToMarket}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-secondary block mb-1">
                          How will we monetize this solution? *
                        </span>
                        <p className="text-on-surface leading-relaxed">{idea.monetization}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-secondary block mb-1">Additional details</span>
                        <p className="text-on-surface leading-relaxed">{idea.additionalDetails || "No additional details returned."}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber-900/10 text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-secondary">Value Drivers:</span>
                        {(idea.valueDrivers || []).map((v, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold text-[10px]">
                            {v}
                          </span>
                        ))}
                      </div>

                      {idea.sourceLink && (
                        <a
                          href={idea.sourceLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline font-mono inline-flex items-center gap-1"
                        >
                          <span>Benchmark Provenance</span>
                          <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Saved Reports Archive */}
      <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10">
        <div className="flex items-center justify-between pb-3 border-b border-amber-900/10">
          <div>
            <h2 className="text-base font-bold text-on-surface font-headline">Saved Benchmark Reports</h2>
            <p className="text-xs text-secondary">Historical precedent syntheses and gap analyses.</p>
          </div>
          <span className="text-xs text-secondary font-semibold">{savedBenchmarks.length} saved</span>
        </div>

        {!savedBenchmarks.length ? (
          <p className="mt-3 rounded-lg bg-surface-low p-3 text-xs text-secondary text-center">
            No saved reports yet. Run your first benchmark above to save reports here.
          </p>
        ) : (
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {savedBenchmarks.map((report) => (
              <button
                key={report._id}
                type="button"
                onClick={() => {
                  setLocalReport(null);
                  setSelectedId(report._id);
                  setStep(3);
                }}
                className="rounded-xl border border-amber-900/10 bg-surface-low/50 p-3.5 text-left hover:border-primary/40 hover:bg-white transition-all shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate font-bold text-xs text-on-surface font-headline">{report.ideaName}</span>
                  <span className="text-[10px] font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                    {report.flowType === "flow4b_gap_initiatives" ? "Ideas" : "Benchmark"}
                  </span>
                </div>
                <span className="mt-1 block text-[11px] text-secondary">
                  {report.sector || "General"} · {report.createdAt ? new Date(report.createdAt).toLocaleDateString() : "Saved"}
                </span>
                <span className="mt-2 block text-[11px] text-primary font-semibold">
                  {report.scoringCriteria ? `Score: ${report.scoringCriteria.totalScore}/100 · Grade ${report.scoringCriteria.grade}` : `${report.counts?.total ?? report.benchmarks?.length ?? 0} Sourced Peers`}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default GlobalBenchmark;
