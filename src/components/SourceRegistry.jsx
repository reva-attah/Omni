import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { normalizeSector, CANONICAL_SECTORS } from "./Dashboard";

export const SOURCE_CATEGORIES = [
  "Emerging Market",
  "Nigerian Regulatory, Legal and Policy Environment",
  "Global Fallback"
];

function normalizeSourceCategory(value = "", tier = "") {
  const category = value.trim().toLowerCase();
  const sourceTier = tier.trim().toLowerCase();
  if (category.includes("regulat") || category.includes("policy") || category.includes("legal") || category.includes("nigeria") || sourceTier.startsWith("nigeria")) {
    return "Nigerian Regulatory, Legal and Policy Environment";
  }
  if (category.includes("global") || sourceTier === "tier_b_global") return "Global Fallback";
  return "Emerging Market";
}

function getSourceIndustry(source) {
  if (source.industry?.trim()) return source.industry.trim();
  const legacyCategory = source.category?.trim() || "";
  const normalized = legacyCategory.toLowerCase();
  if (!legacyCategory || SOURCE_CATEGORIES.includes(legacyCategory) || normalized.startsWith("emerging market") || normalized.includes("regulat") || normalized.includes("policy") || normalized.includes("legal") || normalized.includes("nigeria") || normalized.includes("global")) return "";
  return legacyCategory;
}

import { useQuery, useMutation } from "convex/react";
import { PageLoader } from "./Loader";
import { api } from "../../convex/_generated/api";

export function SourceRegistry() {
  const dbSources = useQuery(api.sources.listSources, {});


  // Convex queries are undefined while their first result is loading. Keep the
  // component's hooks mounted consistently until the query resolves below.
  const sources = dbSources?.length ? dbSources : [];

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("All Sectors");
  const [industryFilter, setIndustryFilter] = useState("All Industries");
  const [dateFilter, setDateFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  // Add source modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formCategory, setFormCategory] = useState("Emerging Market");
  const [formSector, setFormSector] = useState("");
  const [formIndustry, setFormIndustry] = useState("");
  const [formRegion, setFormRegion] = useState("");
  const [formError, setFormError] = useState("");

  const [importNotice, setImportNotice] = useState("");
  const fileInputRef = useRef(null);

  const addSource = useMutation(api.sources.addSource);

  // Dynamic filter lists based exclusively on actual database records
  const availableSectors = useMemo(() => {
    const s = new Set();
    sources.forEach(x => { if (x.sector) s.add(normalizeSector(x.sector)); });
    return ["All Sectors", ...Array.from(s).filter(Boolean).sort()];
  }, [sources]);

  const availableCategories = SOURCE_CATEGORIES;

  const availableIndustries = useMemo(() => {
    const values = new Set(sources.map(getSourceIndustry).filter(Boolean));
    return ["All Industries", ...Array.from(values).sort()];
  }, [sources]);

  // Filter sources
  const filteredSources = useMemo(() => {
    const now = Date.now();
    const thresholds = {
      "7d": now - 7 * 24 * 60 * 60 * 1000,
      "30d": now - 30 * 24 * 60 * 60 * 1000,
      year: new Date(new Date().getFullYear(), 0, 1).getTime(),
      all: 0,
    };
    return sources.filter((s) => {
      if (categoryFilter !== "all" && normalizeSourceCategory(s.category, s.tier) !== categoryFilter) return false;
      if (sectorFilter !== "All Sectors" && normalizeSector(s.sector) !== sectorFilter) return false;
      if (industryFilter !== "All Industries" && getSourceIndustry(s) !== industryFilter) return false;
      const addedAt = s.dateAdded || s._creationTime || 0;
      if (thresholds[dateFilter] && addedAt < thresholds[dateFilter]) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return `${s.name} ${s.url} ${s.region || ""} ${s.category} ${s.sector || ""}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [sources, categoryFilter, sectorFilter, industryFilter, dateFilter, searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [categoryFilter, sectorFilter, industryFilter, dateFilter, searchQuery]);

  const totalPages = Math.ceil(filteredSources.length / PAGE_SIZE) || 1;
  const paginatedSources = filteredSources.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const importSourcesMutation = useMutation(api.sources.importCuratedSources);
  const approveSource = useMutation(api.sources.approveSource);

  const getTierForCategory = (cat) => {
    if (cat === "Global Fallback") return "tier_b_global";
    if (cat === "Nigerian Regulatory, Legal and Policy Environment") return "nigeria_regulator";
    return "tier_a_emerging";
  };

  const handleAddSource = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!formName.trim()) { setFormError("Source Name is compulsory."); return; }
    if (!formUrl.trim() || !/^https:\/\//i.test(formUrl.trim())) { setFormError("Valid HTTPS Website URL is compulsory."); return; }
    if (!formCategory) { setFormError("Category selection is compulsory."); return; }

    try {
      await addSource({
        name: formName.trim(),
        url: formUrl.trim(),
        category: formCategory,
        tier: getTierForCategory(formCategory),
        ...(formSector ? { sector: formSector } : {}),
        ...(formIndustry.trim() ? { industry: formIndustry.trim() } : {}),
        region: formRegion.trim() || (formCategory === "Nigerian Regulatory, Legal and Policy Environment" ? "Nigeria" : "Emerging Markets")
      });
      setImportNotice(`Source "${formName}" registered successfully.`);
      setFormName("");
      setFormUrl("");
      setFormSector("");
      setFormIndustry("");
      setFormRegion("");
      setShowAddModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add source");
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportNotice("");

    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      let importedRows = [];

      if (extension === "xlsx" || extension === "xls" || extension === "csv") {
        const input = extension === "csv" ? await file.text() : await file.arrayBuffer();
        const workbook = XLSX.read(input, { type: extension === "csv" ? "string" : "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        importedRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      } else {
        throw new Error("Please choose an Excel (.xlsx, .xls) or CSV (.csv) file.");
      }

      if (!importedRows.length) throw new Error("No data rows found in the uploaded file.");

      const newItems = [];
      for (const row of importedRows) {
        const normalizedRow = Object.fromEntries(Object.entries(row).map(([key, value]) => [
          key.toLowerCase().replace(/[^a-z0-9]/g, ""), String(value ?? "").trim(),
        ]));
        const name = normalizedRow.name || normalizedRow.sourcename || normalizedRow.title || normalizedRow.publication || "";
        const url = normalizedRow.url || normalizedRow.website || normalizedRow.link || "";
        let category = normalizedRow.category || normalizedRow.tier || "";
        if (!category) throw new Error("Every imported source row must include a Category column value.");

        if (category.toLowerCase().includes("regulat") || category.toLowerCase().includes("policy") || category.toLowerCase().includes("nigeria")) {
          category = "Nigerian Regulatory, Legal and Policy Environment";
        } else if (category.toLowerCase().includes("global")) {
          category = "Global Fallback";
        } else {
          category = "Emerging Market";
        }

        if (name && url && /^https:\/\//i.test(url)) {
          newItems.push({
            name: String(name).slice(0, 100),
            url: String(url).slice(0, 200),
            category,
            tier: getTierForCategory(category),
            region: normalizedRow.region || "Global",
            ...(normalizedRow.sector ? { sector: normalizedRow.sector } : {}),
            ...(normalizedRow.industry ? { industry: normalizedRow.industry } : {}),
          });
        }
      }

      if (newItems.length > 0) {
        let added = 0;
        let alreadyPresent = 0;
        for (let index = 0; index < newItems.length; index += 100) {
          const result = await importSourcesMutation({ sources: newItems.slice(index, index + 100) });
          added += result.added;
          alreadyPresent += result.alreadyPresent;
        }
        setImportNotice(`Imported ${added} sources (${alreadyPresent} already present). Pending sources require approval.`);
      } else {
        throw new Error("Could not parse valid sources. Ensure columns include 'Name' and 'URL'.");
      }
    } catch (err) {
      setImportNotice(`Import notice: ${err instanceof Error ? err.message : "File parsing error"}`);
    } finally {
      event.target.value = "";
    }
  };

  const toggleSignOff = async (id, isActive) => {
    try {
      await approveSource({ id, approved: !isActive });
    } catch (err) {
      alert("Failed to toggle signoff: " + err.message);
    }
  };

  if (dbSources === undefined) {
    return <PageLoader label="Loading Sources..." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12 font-body text-on-surface">
      {/* Top Banner - Compact Vanta Fluid Design */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl bg-white/80 backdrop-blur-xs p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-primary/10 text-primary">
              Curated Source Registry
            </span>
            <span className="text-[11px] text-secondary">{sources.length} Registered Sources</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface font-headline">
            Curated Source Catalog & Approval
          </h1>
          <p className="mt-0.5 text-xs text-secondary max-w-3xl leading-relaxed">
            Sources use Emerging Market, Nigerian Regulatory, Legal and Policy Environment, or Global Fallback. Import via Excel/CSV or register manually.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-900/15 bg-surface-low hover:bg-white text-xs font-semibold text-on-surface shadow-xs transition-all"
            title="Import Excel or CSV file with Name, URL, Category, Sector"
          >
            <span className="material-symbols-outlined text-[16px] text-emerald-700">file_upload</span>
            <span>Import Excel / CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-container text-xs font-semibold text-white shadow-xs transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">add_circle</span>
            <span>Register Source</span>
          </button>
        </div>
      </header>

      {importNotice && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 text-xs text-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-emerald-700">check_circle</span>
            <span>{importNotice}</span>
          </div>
          <button type="button" onClick={() => setImportNotice("")} className="text-emerald-700 text-xs">Dismiss</button>
        </div>
      )}

      {/* Category Pills & Sector Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-amber-900/10 pb-3">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              categoryFilter === "all"
                ? "bg-primary text-white shadow-xs"
                : "bg-surface-low text-secondary hover:text-on-surface"
            }`}
          >
            All Categories ({sources.length})
          </button>

          {availableCategories.map((cat) => {
            const count = sources.filter((s) => normalizeSourceCategory(s.category, s.tier) === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  categoryFilter === cat
                    ? "bg-primary text-white shadow-xs"
                    : "bg-surface-low text-secondary hover:text-on-surface"
                }`}
              >
                {cat.split(" ")[0]} {cat.includes("Regulatory") ? "Regulators" : ""} ({count})
              </button>
            );
          })}
        </div>

        {/* Sector Filter & Search */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-low text-secondary border border-amber-900/10 focus:outline-none"
          >
            {CANONICAL_SECTORS.map((sec) => (
              <option key={sec} value={sec}>{sec}</option>
            ))}
          </select>

          <select value={industryFilter} onChange={(event) => setIndustryFilter(event.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-low text-secondary border border-amber-900/10" aria-label="Filter sources by industry">
            {availableIndustries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
          </select>

          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-low text-secondary border border-amber-900/10" aria-label="Filter sources by date added">
            <option value="all">Any date added</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="year">This year</option>
          </select>

          <div className="flex items-center gap-2 bg-surface-low px-3 py-1.5 rounded-lg border border-amber-900/10 text-xs">
            <span className="material-symbols-outlined text-[15px] text-secondary">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sources..."
              className="bg-transparent border-none outline-none text-xs text-on-surface placeholder:text-secondary/70 w-32 sm:w-44"
            />
          </div>
        </div>
      </div>

      {/* Sources Table (12 per batch - Requirement 8) */}
      <section className="rounded-xl bg-white/80 p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-amber-900/10">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left min-w-[750px]">
            <thead className="bg-surface-low text-secondary text-[10px] uppercase font-bold tracking-wider">
              <tr>
                <th className="p-2.5">Source Publication & URL</th>
                <th className="p-2.5">Category</th>
                <th className="p-2.5">Sector / Industry</th>
                <th className="p-2.5">Date Added</th>
                <th className="p-2.5 text-center">Omni Admin</th>
                <th className="p-2.5 text-center">Approval</th>
                <th className="p-2.5 text-center">Rotation Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-900/10">
              {paginatedSources.length ? (
                paginatedSources.map((src) => {
                  const isFullyActive = src.isActive;
                  return (
                    <tr key={src._id} className="hover:bg-surface-low/40">
                      <td className="p-2.5 max-w-xs">
                        <div className="font-bold text-on-surface text-sm">{src.name}</div>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 font-mono mt-0.5 truncate max-w-sm"
                        >
                          <span>{src.url}</span>
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                        </a>
                      </td>

                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          src.category.includes("Regulatory")
                            ? "bg-amber-500/10 text-amber-800"
                            : src.category.includes("Global")
                            ? "bg-purple-500/10 text-purple-800"
                            : "bg-blue-500/10 text-blue-800"
                        }`}>
                          {normalizeSourceCategory(src.category, src.tier)}
                        </span>
                        <div className="text-[10px] text-secondary mt-0.5">{src.region || "Global"}</div>
                      </td>

                      <td className="p-2.5">
                        <span className="font-medium text-on-surface">{src.sector ? normalizeSector(src.sector) : "Not specified"}</span>
                        {getSourceIndustry(src) && <div className="text-[11px] text-secondary">{getSourceIndustry(src)}</div>}
                      </td>
                      <td className="p-2.5 text-secondary">{src.dateAdded || src._creationTime ? new Date(src.dateAdded || src._creationTime).toLocaleDateString() : "Unknown"}</td>

                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSignOff(src._id, src.isActive)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                            src.signOffOmniAdmin
                              ? "bg-emerald-500/10 text-emerald-800 border-emerald-500/20"
                              : "bg-surface-low text-secondary border-amber-900/10"
                          }`}
                        >
                          {src.signOffOmniAdmin ? "Approved" : "Sign Off"}
                        </button>
                      </td>

                      <td className="p-2.5 text-center">
                        <span className="text-[10px] text-secondary">{src.signOffOmniAdmin ? "Approved by Omni" : "Awaiting Omni"}</span>
                      </td>

                      <td className="p-2.5 text-center">
                        {isFullyActive ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-800">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-800">
                            PENDING SIGNOFF
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-secondary">
                    No sources match your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between pt-3 mt-2 border-t border-amber-900/10 text-xs">
          <span className="text-secondary">
            Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({filteredSources.length} total sources)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white text-on-surface hover:bg-surface-low disabled:opacity-40 transition-all font-semibold"
            >
              ← Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg border border-amber-900/15 bg-white text-on-surface hover:bg-surface-low disabled:opacity-40 transition-all font-semibold"
            >
              Next →
            </button>
          </div>
        </div>
      </section>

      {/* Manual Registration Modal (Requirement 7) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-amber-900/15 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-3 border-b border-amber-900/10">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">add_link</span>
                <div>
                  <h3 className="text-base font-bold text-on-surface font-headline">Register Scraping Source</h3>
                  <p className="text-[11px] text-secondary">Fields marked * are compulsory</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-secondary hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {formError && (
              <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-800">
                {formError}
              </div>
            )}

            <form onSubmit={handleAddSource} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                  Source Publication Name * (Compulsory)
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Disrupt Africa, DailySocial, CBN Circulars..."
                  className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                  Target Website URL * (Compulsory)
                </label>
                <input
                  type="url"
                  required
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                  Category * (Compulsory)
                </label>
                <select
                  required
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white font-medium"
                >
                  <option value="Emerging Market">Emerging Market</option>
                  <option value="Nigerian Regulatory, Legal and Policy Environment">Nigerian Regulatory, Legal and Policy Environment</option>
                  <option value="Global Fallback">Global Fallback</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                    Primary Sector (Optional)
                  </label>
                  <select
                    value={formSector}
                    onChange={(e) => setFormSector(e.target.value)}
                    className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                  >
                    <option value="">Not specified</option>
                    {CANONICAL_SECTORS.filter((s) => s !== "All Sectors").map((sec) => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                    Coverage Region (Optional)
                  </label>
                  <input
                    type="text"
                    value={formRegion}
                    onChange={(e) => setFormRegion(e.target.value)}
                    placeholder="e.g. Nigeria, Pan-African, SE Asia"
                    className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">Industry (Optional)</label>
                <input
                  type="text"
                  value={formIndustry}
                  onChange={(event) => setFormIndustry(event.target.value)}
                  placeholder="e.g. Digital lending, food logistics"
                  className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-amber-900/10 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-amber-900/15 text-xs font-semibold text-secondary hover:bg-surface-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-container shadow-xs"
                >
                  Save Source
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default SourceRegistry;
