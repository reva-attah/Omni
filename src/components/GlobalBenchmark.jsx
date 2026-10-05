import { PageLoader } from "./Loader";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
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
  const activeFlow = "benchmark_report";
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
  const fileInput = useRef(null);
  const hydrated = useRef(false);
  const activeJob = useQuery(api.benchmarkJobs.getMyJob, selectedJobId ? { jobId: selectedJobId } : "skip");
  const attachedDocument = useQuery(api.files.getDocumentUrl, (documentId || activeJob?.documentId) ? { id: documentId || activeJob.documentId } : "skip");

  useEffect(() => {
    if (benchmarkDraft === undefined || hydrated.current) return;
    hydrated.current = true;
    if (!benchmarkDraft) return;
    setBrief(benchmarkDraft.brief);
    setInputText(benchmarkDraft.inputText);
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

  // Start the comparative market benchmark report.
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
      throw new Error("Benchmark report could not be queued. Check your connection and try again.");
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
            Comparative Market Benchmark Report
          </h1>
          <p className="mt-1 max-w-3xl text-xs text-secondary leading-relaxed">
            Compare similar solutions across nearby African, other emerging, and developed markets, with sourced scale figures, business models, execution approaches, and lessons.
          </p>
        </div>
      </header>

      {/* Stepper Progress Bar */}
      <ol className="grid grid-cols-3 gap-2 rounded-xl bg-white/70 p-2 text-xs border border-amber-900/10">
        {[
          { label: "Input Initiative Brief", num: "01" },
          { label: "Review & Refine Brief", num: "02" },
          { label: "Comparative Market Report", num: "03" }
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
                Will prepare a comparative benchmark report
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
              <span>{running ? "Researching comparable markets…" : "Generate benchmark report"}</span>
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

      {/* STEP 3: Comparative Benchmark Report */}
      {step === 3 && selectedReport && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/80 p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary">Benchmark report</span>
              <h2 className="truncate text-base font-bold text-on-surface font-headline">{selectedReport.ideaName}</h2>
              <span className="shrink-0 text-xs text-secondary">({selectedReport.sector})</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {attachedDocument?.url && <a href={attachedDocument.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-xs font-semibold text-primary">Open {attachedDocument.name}</a>}
              <button type="button" onClick={() => exportReport("pdf")} className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white text-xs font-semibold text-on-surface hover:bg-surface-low flex items-center gap-1.5 shadow-xs">
                <span className="material-symbols-outlined text-[15px] text-red-600">picture_as_pdf</span><span>Export PDF</span>
              </button>
              <button type="button" onClick={() => exportReport("docx")} className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white text-xs font-semibold text-on-surface hover:bg-surface-low flex items-center gap-1.5 shadow-xs">
                <span className="material-symbols-outlined text-[15px] text-blue-600">article</span><span>Export Word</span>
              </button>
              <button type="button" onClick={() => { setStep(1); setBrief(blankBrief); setInputText(""); setFileName(""); setDocumentId(null); setSelectedJobId(null); setLocalReport(null); setError(""); setInfoMessage(""); }} className="px-3.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-container shadow-xs">
                + New Benchmark
              </button>
            </div>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary">Executive Summary</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-on-surface">{selectedReport.executiveSummary || "Summary not available for this saved report."}</p>
            </article>
            <article className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary">Market Context</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-on-surface">{selectedReport.marketContext || selectedReport.description || "Market context was not provided."}</p>
            </article>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { key: "Nearby Africa", label: "Nearby African markets", count: selectedReport.counts?.nearbyAfrica },
              { key: "Other Emerging Market", label: "Other emerging markets", count: selectedReport.counts?.emergingPeers },
              { key: "Developed Market", label: "Developed markets", count: selectedReport.counts?.globalLeaders },
            ].map((group) => {
              const count = selectedReport.benchmarks?.filter((peer) => peer.regionTier === group.key || (group.key === "Other Emerging Market" && peer.regionTier === "Emerging Peer") || (group.key === "Developed Market" && peer.regionTier === "Global Leader")).length ?? group.count ?? 0;
              return (
                <div key={group.key} className="rounded-lg border border-amber-900/10 bg-white/80 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-secondary">{group.label}</span>
                  <div className="mt-1 text-2xl font-bold text-primary">{count}</div>
                  <span className="text-[11px] text-secondary">sourced comparables</span>
                </div>
              );
            })}
          </section>

          <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-amber-900/10 pb-3">
              <div>
                <h3 className="text-lg font-bold text-on-surface font-headline">Comparable Solutions</h3>
                <p className="mt-1 text-xs text-secondary">Scale figures include units and reporting dates where sources provide them. Missing public figures are identified rather than estimated.</p>
              </div>
              <span className="text-xs font-bold text-primary">{selectedReport.benchmarks?.length ?? 0} sourced comparables</span>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {(selectedReport.benchmarks || []).map((peer, index) => (
                <article key={peer.companyName + "-" + index} className="rounded-xl border border-amber-900/10 bg-surface-low/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-amber-900/10 pb-3">
                    <div>
                      <h4 className="text-base font-bold text-on-surface">{peer.companyName}</h4>
                      <p className="text-xs text-secondary">{peer.country}{peer.launchYear ? " · Launched " + peer.launchYear : ""} · {peer.status}</p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">{peer.regionTier === "Emerging Peer" ? "Other Emerging Market" : peer.regionTier === "Global Leader" ? "Developed Market" : peer.regionTier}</span>
                  </div>
                  <div className="mt-3 space-y-3 text-xs leading-relaxed">
                    <div><h5 className="font-bold text-secondary">Scale</h5>
                      {peer.scaleMetrics?.length ? (
                        <ul className="mt-1 space-y-1">
                          {peer.scaleMetrics.map((metric, metricIndex) => <li key={metric.metric + "-" + metricIndex}><span className="font-semibold text-on-surface">{metric.metric}:</span> {metric.value}{metric.asOf ? " (" + metric.asOf + ")" : ""} · <a href={metric.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Source</a></li>)}
                        </ul>
                      ) : <p className="mt-1 text-on-surface">{peer.operationalScale || "No reliable public scale figure was reported."}</p>}
                      {peer.customersAndRevenues && <p className="mt-1 text-on-surface"><span className="font-semibold">Customers / revenue:</span> {peer.customersAndRevenues}</p>}
                    </div>
                    <div><h5 className="font-bold text-secondary">Business model</h5><p className="mt-1 text-on-surface">{peer.businessModel || "Not publicly reported."}</p></div>
                    {peer.executionModel && <div><h5 className="font-bold text-secondary">Execution and distribution</h5><p className="mt-1 text-on-surface">{peer.executionModel}</p></div>}
                    {peer.whatWorked && <div><h5 className="font-bold text-secondary">What worked</h5><p className="mt-1 text-on-surface">{peer.whatWorked}</p></div>}
                    {peer.challenges && <div><h5 className="font-bold text-secondary">Reported challenges</h5><p className="mt-1 text-on-surface">{peer.challenges}</p></div>}
                    {peer.keyPartners && <div><h5 className="font-bold text-secondary">Key partners</h5><p className="mt-1 text-on-surface">{peer.keyPartners}</p></div>}
                    {peer.lessonsLearned && <div><h5 className="font-bold text-secondary">Case lesson</h5><p className="mt-1 text-on-surface">{peer.lessonsLearned}</p></div>}
                  </div>
                  <a href={peer.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 break-all text-[11px] font-semibold text-primary hover:underline">
                    {peer.sourceName || "Open cited source"} <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                  </a>
                </article>
              ))}
            </div>
            {!selectedReport.benchmarks?.length && <p className="mt-4 text-xs text-secondary">No sourced comparable companies were returned.</p>}
          </section>

          {(selectedReport.executionInsights?.length > 0 || selectedReport.marketLessons?.length > 0) && (
            <section className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
                <h3 className="text-base font-bold text-on-surface font-headline">Cross-market execution patterns</h3>
                {selectedReport.executionInsights?.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-relaxed text-secondary">{selectedReport.executionInsights.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="mt-2 text-xs text-secondary">No cross-market execution patterns were returned.</p>}
              </article>
              <article className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
                <h3 className="text-base font-bold text-on-surface font-headline">Market comparisons and lessons</h3>
                {selectedReport.marketLessons?.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-relaxed text-secondary">{selectedReport.marketLessons.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="mt-2 text-xs text-secondary">No comparative lessons were returned.</p>}
              </article>
            </section>
          )}

          <CrawledArticleEvidence key={selectedReport._id} report={selectedReport} />
        </div>
      )}

      {/* Saved Reports Archive */}
      <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10">
        <div className="flex items-center justify-between pb-3 border-b border-amber-900/10">
          <div>
            <h2 className="text-base font-bold text-on-surface font-headline">Saved Benchmark Reports</h2>
            <p className="text-xs text-secondary">Comparative research on similar solutions across market groups.</p>
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
                    Benchmark report
                  </span>
                </div>
                <span className="mt-1 block text-[11px] text-secondary">
                  {report.sector || "General"} · {report.createdAt ? new Date(report.createdAt).toLocaleDateString() : "Saved"}
                </span>
                <span className="mt-2 block text-[11px] text-primary font-semibold">
                  {report.counts?.total ?? report.benchmarks?.length ?? 0} sourced comparables
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
