import React from "react";

export function Sidebar({ activeTab, setActiveTab, counts, collapsed = false, onToggle }) {
  const navItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: "dashboard",
    },
    {
      id: "benchmark",
      label: "Benchmarking",
      icon: "query_stats",
      badge: counts.benchmarks > 0 ? String(counts.benchmarks) : null,
    },
    {
      id: "scraping",
      label: "Continuous Scout",
      icon: "travel_explore",
      badge: counts.findings > 0 ? String(counts.findings) : null,
    },
    {
      id: "automations",
      label: "Automations",
      icon: "smart_toy",
    },
    {
      id: "sources",
      label: "Source Registry",
      icon: "database",
    },
    {
      id: "emails",
      label: "Email Audit Log",
      icon: "mark_email_read",
      badge: counts.emails > 0 ? String(counts.emails) : null,
    },
  ];

  return (
    <aside className={`fixed left-0 top-0 z-50 flex h-dvh flex-col justify-between border-r border-amber-900/15 bg-[#171715] text-white shadow-[0_1px_8px_rgba(0,0,0,0.08)] transition-[width] duration-200 select-none ${collapsed ? "w-[72px]" : "w-[72px] md:w-[260px]"}`}>
      <div className="flex flex-col">
        {/* Brand Header */}
        <div className="h-16 px-3 md:px-space-md flex items-center justify-center md:justify-between gap-space-sm border-b border-white/10">
          <div
            onClick={() => setActiveTab("dashboard")}
            className="flex items-center gap-space-sm overflow-hidden cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center p-1.5 flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" className="w-full h-full">
                <path d="M6 30L20 6L34 30H6Z" stroke="#E07000" strokeWidth="3" strokeLinejoin="round" fill="#FFF4E8" />
                <circle cx="20" cy="22" r="4" fill="#E07000" />
                <path d="M20 6V16" stroke="#E07000" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className={`${collapsed ? "hidden" : "hidden md:flex"} flex-col`}>
              <span className="font-headline text-lg text-white tracking-tight leading-tight font-bold">
                Omni
              </span>
              <span className="text-[10px] text-primary uppercase tracking-wider font-bold">
                Venture Intelligence
              </span>
            </div>
          </div>
          <button type="button" onClick={onToggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden md:grid h-8 w-8 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white">
            <span className="material-symbols-outlined text-[18px]">{collapsed ? "menu_open" : "menu"}</span>
          </button>
        </div>

        {/* Section Label */}
        <div className={`${collapsed ? "hidden" : "hidden md:block"} px-space-md pt-3 pb-1`}>
          <span className="text-[10px] uppercase text-white/40 tracking-wider font-bold">
            Platform Modules
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="px-2 md:px-space-sm flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                className={`w-full flex items-center justify-center md:justify-start gap-space-sm px-1.5 md:px-space-sm py-2 rounded-lg transition-all text-xs group text-left cursor-pointer ${
                  isActive
                    ? "bg-white/10 text-white font-semibold border border-white/10 shadow-xs"
                    : "text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                <div className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                  isActive ? "bg-primary/20 text-[#FF9A47]" : "text-white/60 group-hover:bg-white/10"
                }`}>
                  <span className="material-symbols-outlined text-[18px]">
                    {item.icon}
                  </span>
                </div>

                <span className={`${collapsed ? "hidden" : "hidden md:block"} flex-1 text-xs font-semibold`}>{item.label}</span>

                {item.badge && (
                  <span className={`${collapsed ? "hidden" : "hidden md:inline"} px-1.5 py-0.5 rounded-full ${
                    item.id === "automations" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/75"
                  } text-[10px] font-bold`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

export default Sidebar;
