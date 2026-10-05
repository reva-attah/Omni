import React, { useState } from "react";

const pageTitles = {
  dashboard: "Operations Dashboard",
  benchmark: "Venture Benchmarking Engine",
  scraping: "Autonomous Continuous Scout",
  automations: "Automations & Pipelines",
  sources: "Curated Source Registry",
  emails: "DIT Notification Audit Trail",
};

export function Header({ activeTab, setActiveTab, user, onLogout, sidebarCollapsed = false }) {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <header className={`fixed right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-amber-900/10 bg-[#fbf9f4]/95 px-3 shadow-[0_1px_6px_rgba(0,0,0,0.03)] backdrop-blur-md sm:px-5 lg:px-space-lg ${sidebarCollapsed ? "left-[72px]" : "left-[72px] lg:left-[260px]"}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-primary">Trium</span>
        <span className="text-secondary/50">/</span>
        <span className="text-sm font-bold text-on-surface font-headline">{pageTitles[activeTab] || "Omni"}</span>
      </div>

      <div className="relative">
        <button
          type="button"
          aria-expanded={showDropdown}
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-low border border-amber-900/10 transition-all"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden max-w-48 truncate text-xs font-semibold text-on-surface sm:block">
            {user?.name || user?.email || "Studio Partner"}
          </span>
          <span className="material-symbols-outlined text-[16px] text-secondary">
            {showDropdown ? "expand_less" : "expand_more"}
          </span>
        </button>

        {showDropdown && (
          <div className="absolute right-0 mt-2 w-60 rounded-xl border border-amber-900/15 bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100 z-50">
            <div className="border-b border-amber-900/10 px-3 py-2">
              <p className="truncate text-xs font-bold text-on-surface">{user?.name || "Studio Partner"}</p>
              <p className="truncate text-[11px] text-secondary">{user?.email || "partner@trium.ng"}</p>
            </div>
            <button
              type="button"
              onClick={() => { setActiveTab("automations"); setShowDropdown(false); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-low transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">smart_toy</span>
              <span>Automations Hub</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab("sources"); setShowDropdown(false); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-low transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">database</span>
              <span>Source Registry</span>
            </button>
            <button
              type="button"
              onClick={() => { setShowDropdown(false); onLogout(); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">logout</span>
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
