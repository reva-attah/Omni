import React, { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { PageLoader } from "./Loader";
import { api } from "../../convex/_generated/api";

const platformPipelines = [
  {
    title: "Emerging-market scout",
    trigger: "Daily at 05:00 WAT",
    action: "Crawl active emerging/global sources, classify new articles with Gemini, and screen grounded opportunities in Omni.",
  },
  {
    title: "Nigerian policy scout",
    trigger: "Daily at 06:00 WAT",
    action: "Crawl active Nigerian policy sources, classify new articles with Gemini, and screen grounded opportunities in Omni.",
  },
  {
    title: "Vanta duplicate lookup",
    trigger: "During Omni screening when Vanta read access is configured",
    action: "Compare against live portfolio records; unavailable checks are recorded as not checked and do not block Omni scoring.",
  },
  {
    title: "DIT screening alert",
    trigger: "Omni score >= 66 and Nigeria viability is Medium or High",
    action: "Queue the seven-criteria assessment through Resend when sender and DIT recipient are configured.",
  },
];

export function Automations() {
  const identity = useQuery(api.users.currentIdentity);
  const canLoad = identity?.authorized === true;
  const automationsList = useQuery(api.automations.listAutomations, canLoad ? {} : "skip");


  const recentRuns = useQuery(api.scouting.listRecentRuns, canLoad ? { limit: 5 } : "skip") || [];
  const emailLogs = useQuery(api.emailLogs.listLogs, canLoad ? {} : "skip") || [];
  const toggleMutation = useMutation(api.automations.toggleAutomation);
  const createMutation = useMutation(api.automations.createAutomation);

  // Custom Automation Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Scouting");
  const [actionType, setActionType] = useState("both_scouts");
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [actionDesc, setActionDesc] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const handleToggle = async (id, currentStatus) => {
    setError("");
    try {
      await toggleMutation({ id, isActive: !currentStatus });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this automation.");
    }
  };

  const handleCreateAutomation = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    setError("");
    const actionLabels = {
      both_scouts: "Run both emerging-market and Nigerian policy scouts",
      emerging_scout: "Run the emerging-market scout",
      policy_scout: "Run the Nigerian policy scout",
    };
    try {
      await createMutation({
        title: title.trim(),
        category,
        trigger: `Every ${intervalMinutes} minutes`,
        action: actionLabels[actionType],
        description: actionDesc.trim() || actionLabels[actionType],
        actionType,
        intervalMinutes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create this automation.");
      return;
    }

    setNotice(`Custom automation "${title}" is scheduled to run every ${intervalMinutes} minutes.`);
    setTitle("");
    setActionDesc("");
    setActionType("both_scouts");
    setIntervalMinutes(1440);
    setShowCreateModal(false);
  };

  if (automationsList === undefined) {
    return <PageLoader label="Loading Automations..." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12 font-body text-on-surface">
      {/* Top Banner - Compact Vanta Fluid Design */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl bg-white/80 backdrop-blur-xs p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-primary/10 text-primary">
              Automations & Background Orchestration
            </span>
            <span className="text-[11px] font-medium text-secondary">Configuration and run history</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface font-headline">
            Automations & Scheduled Pipelines
          </h1>
          <p className="mt-0.5 text-xs text-secondary max-w-3xl leading-relaxed">
            Review platform pipelines and schedule supported scout actions. Custom schedules run through Convex and can be paused or resumed.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-container text-xs font-semibold text-white shadow-xs transition-all shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">add_task</span>
          <span>Create Custom Automation</span>
        </button>
      </header>

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
        <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-xs text-red-900">{error}</div>
      )}

      {/* Metrics Row */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-4 rounded-xl bg-white/80 border border-amber-900/10 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block">ACTIVE CUSTOM SCHEDULES</span>
          <span className="font-headline font-bold text-xl text-on-surface mt-1 block">
            {automationsList.filter((a) => a.isActive).length} / {automationsList.length} Active
          </span>
          <span className="text-[10px] text-secondary">Saved in Convex</span>
        </div>

        <div className="p-4 rounded-xl bg-white/80 border border-amber-900/10 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block">RECENT SCOUT RUNS</span>
          <span className="font-headline font-bold text-xl text-primary mt-1 block">{recentRuns.length} Recent Runs</span>
          <span className="text-[10px] text-secondary">{recentRuns[0] ? `${recentRuns[0].status} · ${new Date(recentRuns[0].startedAt).toLocaleString()}` : "No runs recorded"}</span>
        </div>

        <div className="p-4 rounded-xl bg-white/80 border border-amber-900/10 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block">DIT ALERTS DISPATCHED</span>
          <span className="font-headline font-bold text-xl text-emerald-600 mt-1 block">{emailLogs.filter((log) => log.status === "delivered" || log.status === "sent").length} Delivered</span>
          <span className="text-[10px] text-secondary">From recorded email logs</span>
        </div>

        <div className="p-4 rounded-xl bg-white/80 border border-amber-900/10 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-secondary block">FAILED RECENT RUNS</span>
          <span className="font-headline font-bold text-xl text-on-surface mt-1 block">{recentRuns.filter((run) => run.status === "failed" || run.status === "partial").length}</span>
          <span className="text-[10px] text-secondary">Among the five most recent</span>
        </div>
      </section>

      <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
        <div className="pb-3 border-b border-amber-900/10">
          <h2 className="text-sm font-bold text-on-surface font-headline uppercase tracking-wider">Platform-managed pipelines</h2>
        </div>
        <div className="divide-y divide-amber-900/10">
          {platformPipelines.map((pipeline) => (
            <div key={pipeline.title} className="grid gap-2 py-3 text-xs sm:grid-cols-[minmax(180px,.7fr)_minmax(180px,.8fr)_minmax(0,1.5fr)]">
              <span className="font-semibold text-on-surface">{pipeline.title}</span>
              <span className="text-secondary"><strong>Trigger:</strong> {pipeline.trigger}</span>
              <span className="text-secondary"><strong>Action:</strong> {pipeline.action}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Automations Table */}
      <section className="rounded-xl bg-white/80 p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-amber-900/10">
          <h2 className="text-sm font-bold text-on-surface font-headline uppercase tracking-wider">
            Custom recurring scout schedules
          </h2>
          <span className="text-xs text-secondary">{automationsList.length} saved</span>
        </div>

        <div className="divide-y divide-amber-900/10">
          {!automationsList.length && <p className="py-6 text-center text-xs text-secondary">No custom scout schedules have been created.</p>}
          {automationsList.map((auto) => (
            <div
              key={auto._id}
              className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-surface-low/30 px-2 rounded-lg transition-colors"
            >
              <div className="flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm text-on-surface font-headline">{auto.title}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                    {auto.category}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    auto.status === "failed" ? "bg-red-500/10 text-red-800" : auto.isActive ? "bg-emerald-500/10 text-emerald-800" : "bg-surface-low text-secondary"
                  }`}>
                    {auto.status === "failed" ? "LAST RUN FAILED · RETRY SCHEDULED" : auto.isActive ? "SCHEDULED" : "PAUSED"}
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 text-xs">
                  <div className="flex items-start gap-1.5 text-secondary">
                    <span className="material-symbols-outlined text-[15px] text-primary shrink-0">bolt</span>
                    <span><strong>Trigger:</strong> {auto.trigger}</span>
                  </div>
                  <div className="flex items-start gap-1.5 text-on-surface">
                    <span className="material-symbols-outlined text-[15px] text-emerald-600 shrink-0">task_alt</span>
                    <span><strong>Action:</strong> {auto.action}</span>
                  </div>
                </div>

                <div className="text-[10px] text-secondary">
                  Last executed: {auto.lastRunAt ? new Date(auto.lastRunAt).toLocaleString() : "No execution recorded"} · Total invocations: {auto.executionCount ?? 0}
                </div>
                {auto.lastError && <p className="text-[11px] text-red-700">{auto.lastError}</p>}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleToggle(auto._id, auto.isActive)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    auto.isActive
                      ? "border-amber-900/15 bg-white text-secondary hover:bg-surface-low"
                      : "border-primary/20 bg-primary/10 text-primary hover:bg-primary hover:text-white"
                  }`}
                >
                  {auto.isActive ? "Pause" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Create Custom Automation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-amber-900/15 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-3 border-b border-amber-900/10">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">smart_toy</span>
                <div>
                  <h3 className="text-base font-bold text-on-surface font-headline">Create Custom Automation</h3>
                  <p className="text-[11px] text-secondary">Define trigger and action payload</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-secondary hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateAutomation} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                  Automation Title *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Weekly AgriTech Digest, High-Viability Webhook..."
                  className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                  >
                    <option value="Scouting">Continuous Scouting</option>
                    <option value="Regulatory">Regulatory Monitoring</option>
                    <option value="Evaluation">Venture Evaluation</option>
                    <option value="Notifications">Notifications & Email</option>
                    <option value="Custom">Custom Integration</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                    Run interval
                  </label>
                  <select
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                    className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                  >
                      <option value={60}>Every hour</option>
                      <option value={360}>Every 6 hours</option>
                      <option value={720}>Every 12 hours</option>
                      <option value={1440}>Every day</option>
                      <option value={10080}>Every week</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                  Scout action
                </label>
                <select
                  value={actionType}
                  onChange={(event) => setActionType(event.target.value)}
                  className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white"
                >
                  <option value="both_scouts">Run both scout groups</option>
                  <option value="emerging_scout">Run emerging-market scout</option>
                  <option value="policy_scout">Run Nigerian policy scout</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-[10px] uppercase tracking-wider text-secondary mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={actionDesc}
                  onChange={(e) => setActionDesc(e.target.value)}
                  placeholder="Add a note for operators"
                  className="w-full rounded-lg border border-amber-900/15 bg-surface-low px-3 py-2 text-xs outline-none focus:border-primary focus:bg-white resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-amber-900/10 mt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-amber-900/15 text-xs font-semibold text-secondary hover:bg-surface-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-container shadow-xs"
                >
                  Create & Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Automations;
