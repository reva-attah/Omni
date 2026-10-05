import { PageLoader } from "./Loader";
import React, { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 15;
const EMPTY_LOGS = [];

function emailState(status = "") {
  const value = status.toLowerCase();
  if (value === "delivered") return "delivered";
  if (value === "queued" || value === "sent" || value === "accepted") return "pending";
  if (value === "failed" || value === "bounced" || value === "complained") return "issue";
  return "other";
}

export function EmailAuditLogs({ emailLogs }) {
  const hasLoadedLogs = emailLogs !== undefined;
  const logs = emailLogs ?? EMPTY_LOGS;
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const metrics = useMemo(() => ({
    delivered: logs.filter((item) => emailState(item.status) === "delivered").length,
    pending: logs.filter((item) => emailState(item.status) === "pending").length,
    issues: logs.filter((item) => emailState(item.status) === "issue").length,
  }), [logs]);

  const filteredLogs = useMemo(() => {
    const now = Date.now();
    const thresholds = {
      day: now - 24 * 60 * 60 * 1000,
      week: now - 7 * 24 * 60 * 60 * 1000,
      month: now - 30 * 24 * 60 * 60 * 1000,
      all: 0,
    };
    const query = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (statusFilter !== "all" && emailState(log.status) !== statusFilter) return false;
      if (thresholds[dateFilter] && log.dispatchedAt < thresholds[dateFilter]) return false;
      if (query && !`${log.initiativeName} ${log.recipient} ${log.subject} ${log.status}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [logs, statusFilter, dateFilter, search]);

  const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE) || 1;
  const pageLogs = filteredLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [statusFilter, dateFilter, search]);

  const filters = [
    ["all", `All · ${logs.length}`],
    ["pending", `Queued · ${metrics.pending}`],
    ["delivered", `Delivered · ${metrics.delivered}`],
    ["issue", `Issues · ${metrics.issues}`],
  ];

  if (!hasLoadedLogs) {
    return <PageLoader label="Loading Logs..." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-12 font-body text-on-surface">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-amber-900/10 pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Delivery history</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-on-surface font-headline">Email delivery</h1>
          <p className="mt-1 text-xs leading-relaxed text-secondary">Resend status events for passing Omni screening alerts.</p>
        </div>
        <div className="text-right text-xs text-secondary">{filteredLogs.length} matching records</div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Total attempts" value={logs.length} tone="text-on-surface" />
        <Metric label="Delivered" value={metrics.delivered} tone="text-emerald-700" />
        <Metric label="Queued / accepted" value={metrics.pending} tone="text-amber-700" />
        <Metric label="Delivery issues" value={metrics.issues} tone="text-red-700" />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-900/10 pb-3">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter email status">
            {filters.map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={statusFilter === value} onClick={() => setStatusFilter(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${statusFilter === value ? "bg-primary text-white" : "bg-surface-low text-secondary hover:text-on-surface"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="rounded-lg border border-amber-900/10 bg-surface-low px-2.5 py-2 text-xs text-on-surface" aria-label="Filter emails by date">
              <option value="all">Any date</option>
              <option value="day">Last 24 hours</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-amber-900/10 bg-surface-low px-3 py-2">
              <span className="material-symbols-outlined text-[16px] text-secondary">search</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ventures or recipients" className="w-44 bg-transparent text-xs text-on-surface outline-none placeholder:text-secondary" />
            </label>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl bg-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-amber-900/10">
          {pageLogs.length ? (
            <table className="w-full min-w-[850px] text-left text-xs">
              <thead className="bg-surface-low text-[10px] uppercase tracking-wider text-secondary">
                <tr><th className="p-3">Screening</th><th className="p-3">Recipient & subject</th><th className="p-3">Delivery</th><th className="p-3">Attempt time</th><th className="p-3">Provider reference</th></tr>
              </thead>
              <tbody className="divide-y divide-amber-900/10">
                {pageLogs.map((log) => {
                  const state = emailState(log.status);
                  const tone = state === "delivered" ? "bg-emerald-500/10 text-emerald-800" : state === "issue" ? "bg-red-500/10 text-red-800" : state === "pending" ? "bg-amber-500/10 text-amber-900" : "bg-surface-low text-secondary";
                  return (
                    <tr key={log._id} className="align-top hover:bg-surface-low/30">
                      <td className="p-3"><p className="font-semibold text-on-surface">{log.initiativeName}</p><p className="mt-1 text-[11px] text-secondary">Omni score {log.vantaScore}/100 · Grade {log.vantaGrade}</p></td>
                      <td className="max-w-sm p-3"><p className="font-medium text-on-surface">{log.recipient}</p><p className="mt-1 text-[11px] leading-relaxed text-secondary">{log.subject}</p></td>
                      <td className="p-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${tone}`}>{log.status}</span>{log.error && <p className="mt-1 max-w-xs text-[11px] text-red-700">{log.error}</p>}</td>
                      <td className="whitespace-nowrap p-3 text-secondary">{new Date(log.dispatchedAt).toLocaleString()}</td>
                      <td className="max-w-[220px] break-all p-3 font-mono text-[10px] text-secondary">{log.messageId || "No provider ID"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="grid min-h-48 place-items-center p-6 text-center">
              <div><span className="material-symbols-outlined text-3xl text-secondary">mark_email_read</span><h2 className="mt-2 font-semibold text-on-surface">No matching delivery records</h2><p className="mt-1 text-xs text-secondary">Adjust filters or check back after a passing Omni screen is queued.</p></div>
            </div>
          )}
        </div>

        {filteredLogs.length > PAGE_SIZE && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-secondary">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-md bg-surface-low px-3 py-1.5 font-semibold text-on-surface disabled:opacity-40">Previous</button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-md bg-surface-low px-3 py-1.5 font-semibold text-on-surface disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return <div className="border-b border-amber-900/10 px-1 py-3"><p className="text-[10px] font-bold uppercase tracking-wider text-secondary">{label}</p><p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p></div>;
}
export default EmailAuditLogs;
