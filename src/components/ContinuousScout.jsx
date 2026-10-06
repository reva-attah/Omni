import { PageLoader } from "./Loader";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { normalizeSector, CANONICAL_SECTORS } from "./Dashboard";

export function ContinuousScout({ onNavigate }) {
  const [now, setNow] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState("ideas"); // 'emerging' | 'policy' | 'screened' | 'articles'
  const [scoutStatus, setScoutStatus] = useState("Scheduled");
  const [isRunning, setIsRunning] = useState(false);
  const [analyzingId, setAnalyzingId] = useState("");
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  const [checkingDedupeId, setCheckingDedupeId] = useState("");
  const [vantaDedupeOutcome, setVantaDedupeOutcome] = useState(null);

  // Filters & Search
  const [sectorFilter, setSectorFilter] = useState("All Sectors");
  const [industryFilter, setIndustryFilter] = useState("All Industries");
  const [timeFilter, setTimeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingArchived, setViewingArchived] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [gradeFilter, setGradeFilter] = useState("all"); // 'all' | 'A*' | 'A' | 'B' | 'C' | 'D'

  // Pagination (10 per batch)
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Notice & errors
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Convex Queries & Actions
  const overview = useQuery(api.scouting.getOverview, { now });
  const tabCounts = useQuery(api.scouting.getTabCounts, {});
  const screeningBatches = useQuery(api.screeningBatches.listRecentBatches, {});
  const recentRuns = useQuery(api.scouting.listRecentRuns, { limit: 1 }) || [];
  const observedScreeningBatches = useRef(new Map());
  const hasObservedScreeningBatch = useRef(false);
  

  const latestRun = recentRuns[0];
  const runStatusLabel = isRunning || latestRun?.status === "running"
    ? "In Progress"
    : latestRun?.status === "failed"
    ? "Failed"
    : latestRun?.status === "partial"
    ? "Partial"
    : scoutStatus;
  const { results: recentFindings } = usePaginatedQuery(api.scouting.listFindingsPage, {}, { initialNumItems: 20 });
  const emergingArchive = usePaginatedQuery(api.scouting.listFindingsPage, { typeFilter: "emerging_tech" }, { initialNumItems: 10 });
  const policyArchive = usePaginatedQuery(api.scouting.listFindingsPage, { typeFilter: "nigeria_policy" }, { initialNumItems: 10 });
  const {
    results: recentArticles,
    status: articleArchiveStatus,
    loadMore: loadMoreArticles,
  } = usePaginatedQuery(api.scouting.listRecentArticlesPage, { isArchived: viewingArchived ? true : false }, { initialNumItems: 10 });
  const myInitiativesArchive = usePaginatedQuery(api.initiatives.listInitiativesPage, { ownerKind: "mine" }, { initialNumItems: 25 });
  const scoutInitiativesArchive = usePaginatedQuery(api.initiatives.listInitiativesPage, { ownerKind: "scout" }, { initialNumItems: 25 });
  const initiatives = useMemo(
    () => [...myInitiativesArchive.results, ...scoutInitiativesArchive.results].sort((a, b) => b.createdAt - a.createdAt),
    [myInitiativesArchive.results, scoutInitiativesArchive.results],
  );

  const runNow = useAction(api.scouting.runNow);
  const archiveArticles = useMutation(api.scouting.archiveArticles);
  const analyzeArticle = useAction(api.scouting.analyzeArticle);
  const checkVantaDuplicates = useAction(api.vanta.checkDuplicates);
  const recoverStaleRuns = useMutation(api.scouting.recoverStaleRuns);
  const screenBatch = useAction(api.screening.screenBatch);
  const [isScreeningBatch, setIsScreeningBatch] = useState(false);

  // Dynamic filter lists based exclusively on actual database records
  const availableSectors = useMemo(() => {
    const s = new Set();
    if (recentFindings) recentFindings.forEach(x => { if (x.sector) s.add(normalizeSector(x.sector)); });
    if (initiatives) initiatives.forEach(x => { if (x.sector) s.add(normalizeSector(x.sector)); });
    if (recentArticles) recentArticles.forEach(x => { if (x.aiSector) s.add(normalizeSector(x.aiSector)); });
    return ["All Sectors", ...Array.from(s).filter(Boolean).sort()];
  }, [recentFindings, initiatives, recentArticles]);
  const availableIndustries = useMemo(() => {
    const values = new Set();
    recentFindings.forEach((item) => item.industry && values.add(item.industry));
    initiatives.forEach((item) => item.industry && values.add(item.industry));
    recentArticles.forEach((item) => item.industry && values.add(item.industry));
    return ["All Industries", ...Array.from(values).sort()];
  }, [recentFindings, initiatives, recentArticles]);

  // Background Auto-Run Heartbeat: executes periodic continuous check every 35 seconds
  useEffect(() => {
    void recoverStaleRuns({ now: Date.now() }).catch(() => {});

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 35000);

    return () => clearInterval(interval);
  }, [recoverStaleRuns]);

  useEffect(() => {
    if (screeningBatches === undefined) return;
    if (!hasObservedScreeningBatch.current) {
      hasObservedScreeningBatch.current = true;
      observedScreeningBatches.current = new Map(screeningBatches.map((batch) => [batch._id, batch.status]));
      return;
    }
    const completedMessages = [];
    for (const batch of screeningBatches) {
      const previousStatus = observedScreeningBatches.current.get(batch._id);
      if (batch.status === "completed" && previousStatus !== "completed") {
        const failedText = batch.failed ? ` ${batch.failed} failed.` : "";
        const warning = batch.errors[0] ? ` ${batch.errors[0]}` : "";
        completedMessages.push(`Screening finished: ${batch.processed} of ${batch.total} ideas processed.${failedText}${warning}`);
      }
      observedScreeningBatches.current.set(batch._id, batch.status);
    }
    if (completedMessages.length) {
      setNotice(completedMessages.join(" "));
      setScoutStatus(screeningBatches.some((batch) => batch.status !== "completed") ? "In Progress" : "Scheduled");
    }
  }, [screeningBatches]);

  // Unified Concurrent Run: Launches both Emerging Tech and Policy scout concurrently
  const handleLaunchFullPatrol = async () => {
    setError("");
    setNotice("");
    setIsRunning(true);
    setScoutStatus("In Progress");

    try {
      // Run both concurrently
      const [resEmerging, resPolicy] = await Promise.allSettled([
        runNow({ scoutType: "emerging_tech" }),
        runNow({ scoutType: "nigeria_policy" })
      ]);

      const emerging = resEmerging.status === "fulfilled" ? resEmerging.value : null;
      const policy = resPolicy.status === "fulfilled" ? resPolicy.value : null;
      const successfulRuns = [emerging, policy].filter((result) => result && result.status !== "failed");
      const failedRuns = 2 - successfulRuns.length;
      const partialRuns = [emerging, policy].filter((result) => result?.status === "partial").length;
      if (!successfulRuns.length) {
        throw new Error([emerging?.message, policy?.message].filter(Boolean).join(" ") || "Both scout runs failed.");
      }
      const countEmerging = emerging?.status !== "failed" ? emerging?.articlesFound || 0 : 0;
      const countPolicy = policy?.status !== "failed" ? policy?.articlesFound || 0 : 0;
      const incomplete = failedRuns > 0 || partialRuns > 0;
      setNotice(`${incomplete ? "Patrol partially completed" : "Patrol completed"}. Captured ${countEmerging} emerging-tech and ${countPolicy} policy articles${incomplete ? "; inspect run status and error details above." : "."}`);
      setScoutStatus(incomplete ? "Partial" : "Scheduled");
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Concurrent scout patrol encountered an issue.");
      setScoutStatus("Failed");
    } finally {
      setIsRunning(false);
    }
  };

  const handleScreenAllVisible = async (scoutType) => {
    const candidates = scoutType === "emerging_tech" ? paginatedEmerging : paginatedPolicy;
    if (!candidates.length) return;
    setError("");
    setNotice("");
    setIsScreeningBatch(true);
    setScoutStatus("In Progress");

    try {
      const mappedCandidates = candidates.map(c => ({
        ideaName: c.ideaName || c.name || "Unknown",
        sector: c.sector || "Unknown",
        ...(c.industry ? { industry: c.industry } : {}),
        summary: c.summary || c.description || "",
        articleUrl: c.articleUrl || c.sourceUrl || ""
      }));
      
      const res = await screenBatch({ scoutType, candidates: mappedCandidates });
      setNotice(`Queued ${res.queued} opportunities for Nigerian viability screening and, when viable, Vanta duplicate checking and seven-criteria scoring. Results will appear in the Screened tab as each batch finishes.${res.errors.length ? ` ${res.errors[0]}` : ""}`);
      setActiveTab("screened");
      setScoutStatus(res.errors.length ? "Partial" : "In Progress");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to screen batch.");
      setScoutStatus("Failed");
    } finally {
      setIsScreeningBatch(false);
    }
  };

  const [isCheckingBatch, setIsCheckingBatch] = useState(false);

  const handleCheckDuplicatesAllVisible = async (scoutType) => {
    const candidates = scoutType === "emerging_tech" ? paginatedEmerging : paginatedPolicy;
    if (!candidates.length) return;
    setError("");
    setNotice("");
    setIsCheckingBatch(true);
    setScoutStatus("In Progress");

    let duplicateCount = 0;
    let failedCount = 0;
    try {
      for (const opp of candidates) {
        try {
          const outcome = await checkVantaDuplicates({
            ideaName: opp.ideaName || opp.name || "Unknown",
            description: (opp.problem || "") + " " + (opp.solution || opp.summary || opp.description || ""),
            sector: opp.sector || "Unknown",
          });
          if (outcome.duplicateFound) duplicateCount++;
        } catch {
          failedCount++;
        }
      }
      setNotice(`Checked ${candidates.length - failedCount} opportunities. Found ${duplicateCount} potential duplicates${failedCount ? `; ${failedCount} checks failed and have no verdict.` : " in Vanta Portfolio."}`);
      setScoutStatus(failedCount ? "Partial" : "Scheduled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vanta duplicate checking failed.");
      setScoutStatus("Failed");
    } finally {
      setIsCheckingBatch(false);
    }
  };

  // Inspect Vanta Duplicates with explicit outcome, count, and descriptions
  const handleCheckVantaDedupe = async (opp) => {
    setCheckingDedupeId(opp.name);
    setVantaDedupeOutcome(null);
    try {
      const outcome = await checkVantaDuplicates({
        ideaName: opp.name,
        description: opp.problem + " " + (opp.solution || opp.description || ""),
        sector: opp.sector,
      });
      setVantaDedupeOutcome(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vanta duplicate check failed; no verdict was produced.");
    } finally {
      setCheckingDedupeId("");
    }
  };

  // Time threshold calculations
  const timeThresholds = {
    "24h": Date.now() - 24 * 60 * 60 * 1000,
    "7d": Date.now() - 7 * 24 * 60 * 60 * 1000,
    "30d": Date.now() - 30 * 24 * 60 * 60 * 1000,
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(),
    year: new Date(new Date().getFullYear(), 0, 1).getTime(),
    all: 0,
  };

  // Filtered Emerging Tech Findings
  const emergingFindings = useMemo(() => {
    const threshold = timeThresholds[timeFilter] || 0;
    return emergingArchive.results
      .filter((item) => {
        const itemTime = item.createdAt || 0;
        if (threshold > 0 && itemTime < threshold) return false;
        if (sectorFilter !== "All Sectors" && normalizeSector(item.sector) !== sectorFilter) return false;
        if (industryFilter !== "All Industries" && item.industry !== industryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return `${item.ideaName} ${item.summary} ${item.sourceName}`.toLowerCase().includes(q);
        }
        return true;
      });
  }, [emergingArchive.results, timeFilter, sectorFilter, industryFilter, searchQuery]);

  // Filtered Nigerian Policy & Regulatory Findings
  const policyFindings = useMemo(() => {
    const threshold = timeThresholds[timeFilter] || 0;
    return policyArchive.results
      .filter((item) => {
        const itemTime = item.createdAt || 0;
        if (threshold > 0 && itemTime < threshold) return false;
        if (sectorFilter !== "All Sectors" && normalizeSector(item.sector) !== sectorFilter) return false;
        if (industryFilter !== "All Industries" && item.industry !== industryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return `${item.ideaName} ${item.summary} ${item.sourceName}`.toLowerCase().includes(q);
        }
        return true;
      });
  }, [policyArchive.results, timeFilter, sectorFilter, industryFilter, searchQuery]);

  // Filtered Screened Opportunities (7-Criteria)

  const filteredFindings = useMemo(() => {
    const threshold = timeThresholds[timeFilter] || 0;
    return (recentFindings || []).filter(item => {
      const itemTime = item.createdAt || 0;
      if (threshold > 0 && itemTime < threshold) return false;
      if (sectorFilter !== "All Sectors" && normalizeSector(item.sector) !== sectorFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return `${item.ideaName} ${item.summary} ${item.sourceName}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [recentFindings, timeFilter, sectorFilter, searchQuery]);

  const findingsByDay = useMemo(() => {
    const groups = {};
    filteredFindings.forEach(item => {
      const day = item.createdAt ? new Date(item.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : "Unknown Date";
      if (!groups[day]) groups[day] = [];
      groups[day].push(item);
    });
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === "Unknown Date") return 1;
      if (b[0] === "Unknown Date") return -1;
      return new Date(b[0]).getTime() - new Date(a[0]).getTime();
    });
  }, [filteredFindings]);

  const screenedOpportunities = useMemo(() => {
    const threshold = timeThresholds[timeFilter] || 0;
    return initiatives
      .filter((item) => {
        const itemTime = item.createdAt || 0;
        if (threshold > 0 && itemTime < threshold) return false;
        if (sectorFilter !== "All Sectors" && normalizeSector(item.sector) !== sectorFilter) return false;
        if (industryFilter !== "All Industries" && item.industry !== industryFilter) return false;
        if (gradeFilter !== "all" && item.vantaGrade !== gradeFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return `${item.name} ${item.problem} ${item.solution}`.toLowerCase().includes(q);
        }
        return true;
      });
  }, [initiatives, timeFilter, sectorFilter, industryFilter, gradeFilter, searchQuery]);

  // Filtered Articles Archive
  const filteredArticles = useMemo(() => {
    const threshold = timeThresholds[timeFilter] || 0;
    return recentArticles.filter((item) => {
      const itemTime = item.processedAt || 0;
      if (threshold > 0 && itemTime < threshold) return false;
      if (sectorFilter !== "All Sectors" && normalizeSector(item.aiSector) !== sectorFilter) return false;
      if (industryFilter !== "All Industries" && item.industry !== industryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return `${item.title} ${item.sourceName} ${item.content || ""}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [recentArticles, timeFilter, sectorFilter, industryFilter, searchQuery]);

  // Reset pagination on tab or filter change
  useEffect(() => {
    setPage(1);
  }, [activeTab, sectorFilter, industryFilter, timeFilter, searchQuery, gradeFilter]);

  // Paginated Slices (10 per batch)
  const paginatedEmerging = emergingFindings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const paginatedPolicy = policyFindings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const paginatedScreened = screenedOpportunities.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const paginatedArticles = filteredArticles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalPages = Math.ceil(
    (activeTab === "emerging"
      ? emergingFindings.length
      : activeTab === "policy"
      ? policyFindings.length
      : activeTab === "screened"
      ? screenedOpportunities.length
      : filteredArticles.length) / PAGE_SIZE
  ) || 1;

  if (overview === undefined) {
    return <PageLoader label="Loading Scout Data..." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12 font-body text-on-surface">
      {/* Prominent Top Status Banner (Requirement 5 & 6) */}
      <section className="rounded-xl bg-white/80 backdrop-blur-xs p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-amber-900/10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-primary/10 text-primary">
                Continuous Web Intelligence Radar
              </span>
              {/* Dynamic Status Indicator */}
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-low border border-amber-900/10 text-[11px] font-semibold">
                <span className={`w-2 h-2 rounded-full ${
                  runStatusLabel === "In Progress"
                    ? "bg-amber-500 animate-ping"
                    : runStatusLabel === "Scheduled"
                    ? "bg-emerald-500 animate-pulse"
                    : runStatusLabel === "Failed"
                    ? "bg-red-500"
                    : "bg-gray-400"
                }`} />
                <span className={runStatusLabel === "In Progress" ? "text-amber-800" : "text-on-surface"}>
                  {runStatusLabel}
                </span>
              </div>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface font-headline">
              Autonomous Continuous Scout & Viability Patrol
            </h1>
            <p className="mt-0.5 text-xs text-secondary max-w-3xl leading-relaxed">
              Daily scheduled runs monitor {((overview?.activeEmergingSources || 0) + (overview?.activePolicySources || 0))} active registry sources. Gemini classification and Omni screening require the configured Gemini service; Vanta matching is a separate optional check.
            </p>
          </div>

          {/* Unified Single Run Button (Requirement 5) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleLaunchFullPatrol}
              disabled={isRunning}
              className="flex items-center gap-2 rounded-lg bg-primary hover:bg-primary-container px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-all disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[17px]">
                {isRunning ? "hourglass_top" : "sync"}
              </span>
              <span>{isRunning ? "Running both scout groups..." : "Run Both Scout Groups"}</span>
            </button>
          </div>
        </div>

        {/* Live Overview Metric Ticker */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3.5 text-xs">
          <div className="p-3 rounded-lg bg-surface-low/80 border border-amber-900/10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block">MONITORED SOURCES</span>
            <span className="font-headline font-bold text-lg text-on-surface mt-0.5 block">{((overview?.activeEmergingSources || 0) + (overview?.activePolicySources || 0)) || 0} Active Feeds</span>
            <span className="text-[10px] text-secondary">{overview?.firecrawlConfigured ? "Firecrawl enabled" : "RSS/HTML active · Firecrawl key needed for fallback"}</span>
          </div>

          <button onClick={() => setActiveTab("articles")} className="p-3 rounded-lg bg-surface-low/80 border border-amber-900/10 text-left hover:bg-surface-low transition-colors w-full">
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block hover:text-primary">ARTICLES INGESTED (24H) &rarr;</span>
            <span className="font-headline font-bold text-lg text-primary mt-0.5 block">{overview?.articlesLastDay ?? 0} Captured</span>
            <span className="text-[10px] text-secondary">{overview?.geminiConfigured ? "Gemini enabled" : "Gemini not configured"}</span>
          </button>

          <button onClick={() => setActiveTab("ideas")} className="p-3 rounded-lg bg-surface-low/80 border border-amber-900/10 text-left hover:bg-surface-low transition-colors w-full">
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block hover:text-primary">IDEAS SURFACED (24H) &rarr;</span>
            <span className="font-headline font-bold text-lg text-emerald-600 mt-0.5 block">{overview?.ideasLastDay ?? 0} Opportunities</span>
            <span className="text-[10px] text-secondary">New AI-derived findings</span>
          </button>

          <div className="p-3 rounded-lg bg-surface-low/80 border border-amber-900/10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block">DEDUPLICATION ENGINE</span>
            <span className="font-headline font-bold text-lg text-on-surface mt-0.5 block">{overview?.vantaReadApiConfigured ? "Connected" : "Unavailable"}</span>
            <span className="text-[10px] text-secondary">Vanta duplicate check</span>
          </div>
        </div>
      </section>

      {notice && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 text-xs text-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-emerald-700">check_circle</span>
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice("")} className="text-emerald-700 text-xs">Dismiss</button>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-xs text-red-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-red-700">error</span>
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError("")} className="text-red-700 text-xs">Dismiss</button>
        </div>
      )}

      {/* Navigation Tabs (Split Results) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-900/10 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: "emerging", label: "Emerging Tech Signals", count: tabCounts?.emerging ?? "…", icon: "public" },
            { id: "policy", label: "Nigerian Policy & Regulatory", count: tabCounts?.policy ?? "…", icon: "gavel" },
            { id: "screened", label: "7-Criteria Screened Ideas", count: tabCounts?.screened ?? "…", icon: "verified" },
            { id: "articles", label: "Crawled Articles Archive", count: overview?.totalArticlesAllTime || 0, icon: "article" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-primary text-white shadow-xs"
                  : "bg-surface-low text-secondary hover:text-on-surface hover:bg-white"
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">{tab.icon}</span>
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === tab.id ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
              }`}>
                {tab.id === "articles" && tab.count >= 1000 ? "1,000+" : tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Time Filter Pills */}
        <div className="flex items-center gap-1 bg-surface-low p-1 rounded-lg border border-amber-900/10 text-xs">
          <span className="px-2 text-[10px] font-bold uppercase text-secondary tracking-wider">Period:</span>
          {[
            { id: "all", label: "All" },
            { id: "24h", label: "24h" },
            { id: "7d", label: "7d" },
            { id: "30d", label: "30d" },
            { id: "month", label: "This month" },
            { id: "year", label: "This year" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTimeFilter(t.id)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                timeFilter === t.id
                  ? "bg-on-surface text-surface-lowest font-semibold"
                  : "text-secondary hover:text-on-surface"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Sector Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-secondary mr-1">Sector:</span>
          {availableSectors.slice(0, 5).map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => setSectorFilter(sec)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                sectorFilter === sec
                  ? "bg-on-surface text-surface-lowest border-on-surface font-semibold"
                  : "bg-surface-lowest text-secondary border-amber-900/10 hover:bg-surface-low"
              }`}
            >
              {sec.split(" & ")[0]}
            </button>
          ))}
          {availableSectors.length > 5 && (
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="px-2 py-1 rounded-full text-[11px] font-medium bg-surface-lowest text-secondary border border-amber-900/10 focus:outline-none"
            >
              <option value="All Sectors">More Sectors...</option>
              {availableSectors.slice(5).map((sec) => (
                <option key={sec} value={sec}>{sec}</option>
              ))}
            </select>
          )}

          <select
            value={industryFilter}
            onChange={(event) => setIndustryFilter(event.target.value)}
            className="px-2 py-1 rounded-lg text-[11px] font-medium bg-surface-lowest text-secondary border border-amber-900/10"
            aria-label="Filter by industry"
          >
            {availableIndustries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
          </select>

          {/* Grade filter for screened tab */}
          {activeTab === "screened" && (
            <div className="flex items-center gap-1 ml-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-secondary">Grade:</span>
              {["all", "A*", "A", "B", "C", "D"].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGradeFilter(g)}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                    gradeFilter === g
                      ? "bg-primary text-white border-primary"
                      : "bg-surface-lowest text-secondary border-amber-900/10 hover:bg-surface-low"
                  }`}
                >
                  {g === "all" ? "All" : g}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search Input */}
        <div className="flex items-center gap-2 bg-surface-low px-3 py-1.5 rounded-lg border border-amber-900/10 text-xs shrink-0">
          <span className="material-symbols-outlined text-[15px] text-secondary">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search signals, ideas, sources..."
            className="bg-transparent border-none outline-none text-xs text-on-surface placeholder:text-secondary/70 w-44 sm:w-56"
          />
        </div>
      </div>

      {/* TAB 1: Emerging Tech Signals */}
      {activeTab === "emerging" && (
        <div className="space-y-3">
          <div className="flex justify-end gap-2 mb-2">
            <button
              type="button"
              onClick={() => handleCheckDuplicatesAllVisible("emerging_tech")}
              disabled={isCheckingBatch || isScreeningBatch || paginatedEmerging.length === 0}
              className="px-4 py-1.5 rounded-lg border border-amber-900/15 bg-white hover:bg-surface-low text-xs font-bold text-on-surface shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">fingerprint</span>
              <span>{isCheckingBatch ? "Checking..." : "Check Duplicates (Visible)"}</span>
            </button>
            <button
              type="button"
              onClick={() => handleScreenAllVisible("emerging_tech")}
              disabled={isCheckingBatch || isScreeningBatch || paginatedEmerging.length === 0}
              className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-xs font-bold text-white shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isScreeningBatch ? "hourglass_empty" : "checklist"}
              </span>
              <span>{isScreeningBatch ? "Screening..." : "Screen Initiatives (Visible)"}</span>
            </button>
          </div>
          {paginatedEmerging.length ? (
            paginatedEmerging.map((item, idx) => (
              <article
                key={item._id || idx}
                className="rounded-xl bg-white/80 p-4.5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] border border-amber-900/10 hover:border-primary/25 transition-all flex flex-col md:flex-row md:items-start justify-between gap-4"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="font-bold text-sm text-on-surface font-headline">{item.ideaName}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                      {normalizeSector(item.sector)}
                    </span>
                    <span className="text-[11px] text-secondary">
                      {item.sourceName} · {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "Recent"}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.isNewInSession ? "bg-emerald-500/10 text-emerald-800" : "bg-surface-low text-secondary"}`}>
                      {item.isNewInSession ? `New · ${item.sessionDate || "first seen"}` : "Previously scouted"}
                    </span>
                  </div>
                  <p className="text-xs text-secondary leading-relaxed max-w-3xl">{item.summary}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-xl bg-white/70 p-8 text-center border border-amber-900/10">
              <span className="material-symbols-outlined text-3xl text-secondary">feed</span>
              <p className="mt-2 font-bold text-sm text-on-surface">No emerging tech signals in this view</p>
              <p className="text-xs text-secondary mt-1">Click "Launch Concurrent Scout Patrol" above to crawl 35 curated trackers.</p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Nigerian Policy & Regulatory Catalysts */}
      {activeTab === "policy" && (
        <div className="space-y-3">
          <div className="flex justify-end gap-2 mb-2">
            <button
              type="button"
              onClick={() => handleCheckDuplicatesAllVisible("nigeria_policy")}
              disabled={isCheckingBatch || isScreeningBatch || paginatedPolicy.length === 0}
              className="px-4 py-1.5 rounded-lg border border-amber-900/15 bg-white hover:bg-surface-low text-xs font-bold text-on-surface shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">fingerprint</span>
              <span>{isCheckingBatch ? "Checking..." : "Check Duplicates (Visible)"}</span>
            </button>
            <button
              type="button"
              onClick={() => handleScreenAllVisible("nigeria_policy")}
              disabled={isCheckingBatch || isScreeningBatch || paginatedPolicy.length === 0}
              className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-xs font-bold text-white shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isScreeningBatch ? "hourglass_empty" : "checklist"}
              </span>
              <span>{isScreeningBatch ? "Screening..." : "Screen Initiatives (Visible)"}</span>
            </button>
          </div>
          {paginatedPolicy.length ? (
            paginatedPolicy.map((item, idx) => (
              <article
                key={item._id || idx}
                className="rounded-xl bg-white/80 p-4.5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] border border-amber-900/10 hover:border-amber-600/30 transition-all flex flex-col md:flex-row md:items-start justify-between gap-4"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="font-bold text-sm text-on-surface font-headline">{item.ideaName}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-800 uppercase">
                      Regulatory Catalyst
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-low text-secondary">
                      {normalizeSector(item.sector)}
                    </span>
                    <span className="text-[11px] text-secondary">
                      {item.sourceName} (CBN / SEC / NERC / FIRS)
                    </span>
                  </div>
                  <p className="text-xs text-secondary leading-relaxed max-w-3xl">{item.summary}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-xl bg-white/70 p-8 text-center border border-amber-900/10">
              <span className="material-symbols-outlined text-3xl text-secondary">gavel</span>
              <p className="mt-2 font-bold text-sm text-on-surface">No regulatory circulars in this view</p>
              <p className="text-xs text-secondary mt-1">Click "Launch Concurrent Scout Patrol" above to crawl Nigerian regulatory gazettes.</p>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: In-House 7-Criteria Screened Opportunities (Requirement 9) */}
      {activeTab === "screened" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-on-surface font-headline uppercase tracking-wider">
              Screened Venture Opportunities (7 Trium Investment Committee Criteria)
            </h3>
            <span className="text-xs text-secondary">Pass threshold: 66/100 · Grade B</span>
          </div>

          {paginatedScreened.length ? (
            paginatedScreened.map((item, idx) => (
              <article
                key={item._id || idx}
                className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10 space-y-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-amber-900/10">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h4 className="text-base font-bold text-on-surface font-headline">{item.name}</h4>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                        {normalizeSector(item.sector)}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        ["A*", "A"].includes(item.vantaGrade)
                          ? "bg-emerald-500/10 text-emerald-800"
                          : item.vantaGrade === "B"
                          ? "bg-blue-500/10 text-blue-800"
                          : "bg-amber-500/10 text-amber-800"
                      }`}>
                        Grade {item.vantaGrade} ({item.vantaScore}/100) — {item.vantaScore >= 66 ? "PASS" : "RESERVED"}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${item.dedupeVerdict === "NOT_CHECKED" ? "bg-surface-low text-secondary" : item.vantaDuplicateFound ? "bg-amber-500/10 text-amber-900" : "bg-emerald-500/10 text-emerald-800"}`}>
                        {item.dedupeVerdict === "NOT_CHECKED" ? "Vanta not checked" : item.vantaDuplicateFound ? `${item.vantaDuplicateCount} Vanta match${item.vantaDuplicateCount === 1 ? "" : "es"}` : "No Vanta match"}
                      </span>
                    </div>
                    <p className="text-xs text-secondary leading-relaxed max-w-2xl">{item.problem}</p>
                  </div>

                  {item.vantaScore >= 66 && (
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-500/10 text-emerald-800 text-xs font-semibold">
                      <span className="material-symbols-outlined text-[15px]">mark_email_read</span>
                      <span>{item.emailDispatched ? "Delivered to DIT" : "Passed · email delivery not confirmed"}</span>
                    </div>
                  )}
                </div>

                {item.vantaDuplicateFound && item.matchingVantaList?.length > 0 && (
                  <ul className="space-y-1.5 rounded-lg bg-amber-500/5 p-3 text-[11px] text-secondary">
                    {item.matchingVantaList.map((duplicate, index) => (
                      <li key={`${duplicate.name}-${index}`}>
                        <strong className="text-on-surface">{duplicate.name}</strong> · {Math.round(duplicate.similarity * 100)}% match · {duplicate.description}
                      </li>
                    ))}
                  </ul>
                )}

                {/* 7-Criteria Score Breakdown Grid */}
                {item.viabilityRating === "Low" ? (
                  <div className="rounded-lg bg-amber-500/5 border border-amber-900/10 p-3 text-xs text-secondary">
                    Nigeria viability was below Medium, so the seven-criteria summary and scoring were skipped.
                  </div>
                ) : <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  {item.criteriaScores && typeof item.criteriaScores === "object" ? (
                    Object.entries(item.criteriaScores).map(([k, val]) => (
                      <div key={k} className="p-2.5 rounded-lg bg-surface-low border border-amber-900/10">
                        <div className="flex justify-between font-bold text-[10px] uppercase text-secondary mb-1">
                          <span className="truncate">{k.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")}</span>
                          <span className="text-primary font-headline">{val.score}/{val.maxScore}</span>
                        </div>
                        <p className="text-[11px] text-on-surface leading-relaxed whitespace-pre-line">{val.summary || val.rationale}</p>
                        {val.summary && <p className="mt-2 border-t border-amber-900/10 pt-1.5 text-[10px] text-secondary"><strong>Scoring note:</strong> {val.rationale}</p>}
                      </div>
                    ))
                  ) : (
                    <div className="p-2.5 rounded-lg bg-surface-low col-span-4 text-secondary text-xs">
                      Evaluated on Strategic Alignment (20: fit with Trium, Coronation Group, and Access Bank strategies and priorities, including relevant ways to leverage their strengths), Customer-Problem (20), Solution Fit (15), Market Opportunity (15), Differentiation (10), Sustainable Advantage (10), and Feasibility (10).
                    </div>
                  )}
                </div>}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-amber-900/10 text-xs">
                  <div className="text-secondary text-[11px]">
                    <strong>Commercial Solution:</strong> {item.solution}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCheckVantaDedupe(item)}
                    disabled={checkingDedupeId === item.name}
                    className="text-primary hover:underline text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
                  >
                    <span>{checkingDedupeId === item.name ? "Checking Vanta..." : "Check Vanta Dedupe Outcome"}</span>
                    <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-xl bg-white/70 p-8 text-center border border-amber-900/10">
              <span className="material-symbols-outlined text-3xl text-secondary">verified</span>
              <p className="mt-2 font-bold text-sm text-on-surface">No screened opportunities match filter</p>
              <p className="text-xs text-secondary mt-1">Screen an opportunity from the Emerging Tech or Policy tabs.</p>
            </div>
          )}
        </div>
      )}

      
      {/* TAB 4: Crawled Articles Archive (Session History) */}
      {activeTab === "articles" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewingArchived(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${!viewingArchived ? "bg-primary text-white shadow-xs" : "bg-surface-low text-secondary hover:text-primary"}`}
              >
                Active Articles
              </button>
              <button
                type="button"
                onClick={() => setViewingArchived(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewingArchived ? "bg-primary text-white shadow-xs" : "bg-surface-low text-secondary hover:text-primary"}`}
              >
                Archived
              </button>
            </div>
            {!viewingArchived && (
              <div className="flex items-center gap-2">
                <select
                  id="archiveSelect"
                  className="bg-white border border-amber-900/20 text-secondary text-xs rounded-lg px-2 py-1.5 outline-none"
                  defaultValue=""
                >
                  <option value="" disabled>Archive Old Articles...</option>
                  <option value="2">Older than 2 Days</option>
                  <option value="7">Older than 7 Days</option>
                  <option value="30">Older than 30 Days</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    const sel = document.getElementById("archiveSelect").value;
                    if (!sel) return;
                    setIsArchiving(true);
                    try {
                      const count = await archiveArticles({ olderThanDays: Number(sel) });
                      setNotice(`Successfully archived ${count} old articles from the active view.`);
                    } catch(e) {
                      setError(e.message);
                    } finally {
                      setIsArchiving(false);
                      document.getElementById("archiveSelect").value = "";
                    }
                  }}
                  disabled={isArchiving}
                  className="px-3 py-1.5 rounded-lg bg-surface-low border border-amber-900/20 hover:bg-white text-xs font-bold text-secondary flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">inventory_2</span>
                  {isArchiving ? "Moving..." : "Archive Selected"}
                </button>
              </div>
            )}
          </div>

          {paginatedArticles.length ? (
            paginatedArticles.map((art, idx) => (
              <article
                key={art._id || idx}
                className="rounded-xl bg-white/80 p-4.5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] border border-amber-900/10 flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-900/5 pb-2">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h4 className="text-sm font-bold text-on-surface font-headline leading-snug">{art.title}</h4>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                        {normalizeSector(art.aiSector)}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-low text-secondary border border-amber-900/10">
                        {art.isNewInSession ? `New · ${art.sessionDate || "first seen"}` : "Previously crawled"}
                      </span>
                    </div>
                    <div className="text-xs text-secondary flex items-center gap-2">
                      <span className="font-semibold">{art.sourceName}</span>
                      <span>&bull;</span>
                      <span>{art.processedAt ? new Date(art.processedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Recent"}</span>
                    </div>
                  </div>
                  
                  <a
                    href={art.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white hover:bg-surface-low text-xs font-semibold text-primary flex items-center gap-1.5 shadow-xs transition-all"
                  >
                    <span>Read Full Article</span>
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  </a>
                </div>
                
                {art.aiSummary && (
                  <div className="text-xs text-on-surface/90 leading-relaxed bg-surface-low/50 p-3 rounded-lg border border-amber-900/5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block mb-1.5">Gemini AI Summary</span>
                    <p>{art.aiSummary}</p>
                  </div>
                )}
              </article>
            ))
          ) : (
            <div className="rounded-xl bg-white/70 p-8 text-center border border-amber-900/10">
              <span className="material-symbols-outlined text-3xl text-secondary">article</span>
              <p className="mt-2 font-bold text-sm text-on-surface">No articles match your filters</p>
              <p className="text-xs text-secondary mt-1">Try adjusting the time range, sector, or search keywords.</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination Bar (10 per batch - Requirement 5) */}
      <div className="flex items-center justify-between pt-3 border-t border-amber-900/10 text-xs">
        <span className="text-secondary">
          Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> (10 items per batch)
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white text-on-surface hover:bg-surface-low disabled:opacity-40 transition-all font-semibold"
          >
            ← Previous Batch
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white text-on-surface hover:bg-surface-low disabled:opacity-40 transition-all font-semibold"
          >
            Next Batch →
          </button>
        </div>
      </div>
      {activeTab === "articles" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-low/70 px-3 py-2 text-xs">
          <span className="text-secondary">
            {articleArchiveStatus === "LoadingFirstPage" ? "Loading article archive..." : `${recentArticles.length} session articles loaded${articleArchiveStatus === "Exhausted" ? " · archive complete" : ""}`}
          </span>
          <button
            type="button"
            disabled={articleArchiveStatus !== "CanLoadMore"}
            onClick={() => loadMoreArticles(10)}
            className="rounded-md bg-white px-3 py-1.5 font-semibold text-on-surface shadow-xs disabled:opacity-40"
          >
            {articleArchiveStatus === "LoadingMore" ? "Loading..." : "Load next archive batch"}
          </button>
        </div>
      )}
      {activeTab === "emerging" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-low/70 px-3 py-2 text-xs">
          <span className="text-secondary">
            {emergingArchive.status === "LoadingFirstPage" ? "Loading emerging signals..." : `${emergingArchive.results.length} emerging signals loaded${emergingArchive.status === "Exhausted" ? " · archive complete" : ""}`}
          </span>
          <button type="button" disabled={emergingArchive.status !== "CanLoadMore"} onClick={() => emergingArchive.loadMore(10)} className="rounded-md bg-white px-3 py-1.5 font-semibold text-on-surface shadow-xs disabled:opacity-40">
            {emergingArchive.status === "LoadingMore" ? "Loading..." : "Load next archive batch"}
          </button>
        </div>
      )}
      {activeTab === "policy" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-low/70 px-3 py-2 text-xs">
          <span className="text-secondary">
            {policyArchive.status === "LoadingFirstPage" ? "Loading Nigerian policy..." : `${policyArchive.results.length} policy items loaded${policyArchive.status === "Exhausted" ? " · archive complete" : ""}`}
          </span>
          <button type="button" disabled={policyArchive.status !== "CanLoadMore"} onClick={() => policyArchive.loadMore(10)} className="rounded-md bg-white px-3 py-1.5 font-semibold text-on-surface shadow-xs disabled:opacity-40">
            {policyArchive.status === "LoadingMore" ? "Loading..." : "Load next archive batch"}
          </button>
        </div>
      )}
      {activeTab === "screened" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-low/70 px-3 py-2 text-xs">
          <span className="text-secondary">
            {myInitiativesArchive.status === "LoadingFirstPage" || scoutInitiativesArchive.status === "LoadingFirstPage"
              ? "Loading screened ideas..."
              : `${initiatives.length} screened ideas loaded${myInitiativesArchive.status === "Exhausted" && scoutInitiativesArchive.status === "Exhausted" ? " · archive complete" : ""}`}
          </span>
          <button
            type="button"
            disabled={myInitiativesArchive.status !== "CanLoadMore" && scoutInitiativesArchive.status !== "CanLoadMore"}
            onClick={() => {
              if (myInitiativesArchive.status === "CanLoadMore") myInitiativesArchive.loadMore(10);
              if (scoutInitiativesArchive.status === "CanLoadMore") scoutInitiativesArchive.loadMore(10);
            }}
            className="rounded-md bg-white px-3 py-1.5 font-semibold text-on-surface shadow-xs disabled:opacity-40"
          >
            {myInitiativesArchive.status === "LoadingMore" || scoutInitiativesArchive.status === "LoadingMore" ? "Loading..." : "Load next archive batch"}
          </button>
        </div>
      )}

      {/* Vanta Deduplication Outcome Modal (Requirement 8) */}
      {vantaDedupeOutcome && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-amber-900/15 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-3 border-b border-amber-900/10">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">fingerprint</span>
                <div>
                  <h3 className="text-base font-bold text-on-surface font-headline">
                    Vanta Portfolio & Idea Bank Duplicate Outcome
                  </h3>
                  <p className="text-xs text-secondary">Live Vanta portfolio read · lexical similarity screening</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVantaDedupeOutcome(null)}
                className="text-secondary hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              {/* Verdict Summary Box */}
              <div className={`p-4 rounded-xl border flex items-center justify-between ${
                vantaDedupeOutcome.duplicateFound
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-900"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-900"
              }`}>
                <div>
                  <span className="font-bold text-xs uppercase tracking-wider block">
                    {vantaDedupeOutcome.duplicateFound ? "DUPLICATE FOUND IN VANTA" : "NO DUPLICATE FOUND — UNIQUE CONCEPT"}
                  </span>
                  <p className="mt-0.5 text-xs opacity-90">{vantaDedupeOutcome.message}</p>
                </div>
                <div className="text-right">
                  <span className="font-headline font-bold text-2xl">
                    {vantaDedupeOutcome.duplicateCount}
                  </span>
                  <span className="text-[10px] block opacity-80 uppercase font-semibold">Matches</span>
                </div>
              </div>

              {/* List of Matching Duplicates with Short Descriptions */}
              {vantaDedupeOutcome.matchingDuplicates?.length > 0 ? (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block mb-2">
                    Itemized Matching Concepts from Vanta Idea Bank:
                  </span>
                  <ul className="space-y-2">
                    {vantaDedupeOutcome.matchingDuplicates.map((dup, i) => (
                      <li key={i} className="p-3 rounded-lg bg-surface-low border border-amber-900/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-on-surface">{dup.name}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary">
                            {Math.round(dup.similarity * 100)}% Similarity
                          </span>
                        </div>
                        <p className="text-secondary text-[11px] leading-relaxed">{dup.description}</p>
                        <span className="mt-1 inline-block text-[10px] text-secondary font-mono">Status: {dup.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-surface-low text-secondary text-[11px] leading-relaxed">
                  No portfolio record crossed the configured similarity threshold. This does not prove that the concept is unique.
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end pt-3 border-t border-amber-900/10">
              <button
                type="button"
                onClick={() => setVantaDedupeOutcome(null)}
                className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-container"
              >
                Close Outcome
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default ContinuousScout;
