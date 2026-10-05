import React from "react";

export function ModeSelection({ onNavigate, benchmarkCount = 0, activeSources = 0 }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-widest text-primary">Omni / Venture Intelligence</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-on-surface">Choose an intelligence module</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">Research an initiative on demand, or monitor public markets and policy continuously. Both modules keep evidence and citations attached to their results.</p></div>
        <div className="rounded-xl bg-white px-4 py-3 text-sm shadow-sm"><span className="text-secondary">Approved scout sources</span><span className="ml-3 font-bold tabular-nums text-on-surface">{activeSources}</span></div>
      </header>
      <div className="grid gap-5 lg:grid-cols-2">
        <WorkflowCard icon="query_stats" eyebrow="Module 01 · On demand" title="Benchmark an initiative" description="Upload a PDF, Word, or PowerPoint file, or describe the idea. Review the extracted brief before Omni researches comparable and contrasting initiatives across nearby Africa, emerging markets, and global leaders." details={`${benchmarkCount} saved benchmark reports`} button="Start a benchmark" onClick={() => onNavigate("benchmark")} />
        <WorkflowCard icon="travel_explore" eyebrow="Module 02 · Continuous" title="Scout the web continuously" description="Run scheduled emerging-technology and Nigerian policy scouts against approved public feeds. Review sourced articles and idea candidates, with source health and run history in one place." details="Daily emerging-market and policy monitoring" button="Open Continuous Scout" onClick={() => onNavigate("scraping")} />
      </div>
      <div className="rounded-2xl border border-border bg-white p-5 sm:p-6"><h2 className="font-semibold text-on-surface">Research integrity</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-secondary">Omni shows only saved runs and evidence returned by its connected services. Candidate ideas remain unapproved until reviewed; Vanta duplicate checks and formal assessment are identified separately when their private read-and-screening connection is enabled.</p></div>
    </div>
  );
}

function WorkflowCard({ icon, eyebrow, title, description, details, button, onClick }) {
  return <article className="flex min-h-[330px] flex-col rounded-2xl border border-border bg-white p-6 shadow-sm sm:p-7"><div className="flex items-center justify-between gap-3"><span className="material-symbols-outlined rounded-xl bg-primary/10 p-3 text-3xl text-primary">{icon}</span><span className="rounded-full bg-surface-container-low px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-primary">{eyebrow}</span></div><h2 className="mt-6 text-2xl font-bold text-on-surface">{title}</h2><p className="mt-3 flex-1 text-sm leading-6 text-secondary">{description}</p><div className="mt-5 border-t border-border pt-4"><p className="text-xs font-semibold text-secondary">{details}</p><button type="button" onClick={onClick} className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover">{button} <span aria-hidden="true">→</span></button></div></article>;
}

export default ModeSelection;
