import React, { lazy, Suspense, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { Login } from "./components/Login";

const Dashboard = lazy(() => import("./components/Dashboard").then((module) => ({ default: module.Dashboard })));
const GlobalBenchmark = lazy(() => import("./components/GlobalBenchmark").then((module) => ({ default: module.GlobalBenchmark })));
const ContinuousScout = lazy(() => import("./components/ContinuousScout").then((module) => ({ default: module.ContinuousScout })));
const Automations = lazy(() => import("./components/Automations").then((module) => ({ default: module.Automations })));
const SourceRegistry = lazy(() => import("./components/SourceRegistry").then((module) => ({ default: module.SourceRegistry })));
const EmailAuditLogs = lazy(() => import("./components/EmailAuditLogs").then((module) => ({ default: module.EmailAuditLogs })));

import { useRevaData } from "./convexClient";

export function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem("reva.nav.active");
    return saved && saved !== "start" ? saved : "dashboard";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("reva.nav.collapsed") === "true");

  const navigate = (tab) => {
    localStorage.setItem("reva.nav.active", tab);
    setActiveTab(tab);
  };

  const toggleSidebar = () =>
    setSidebarCollapsed((value) => {
      localStorage.setItem("reva.nav.collapsed", String(!value));
      return !value;
    });

  const { isLoading, isAuthenticated } = useConvexAuth();
  const identity = useQuery(api.users.currentIdentity, isAuthenticated ? {} : "skip");
  const { signOut } = useAuthActions();

  const {
    benchmarks,
    benchmarkDraft,
    benchmarkJobs,
    saveBenchmarkDraft,
    initiatives,
    emailLogs,
    runBenchmark,
    extractBrief,
    uploadDocument,
    scoutOverview,
    scoutFindings,
  } = useRevaData(Boolean(identity?.authorized));

  if (isLoading || (isAuthenticated && identity === undefined)) {
    return <main className="min-h-screen bg-background grid place-items-center text-secondary text-sm">Loading secure session…</main>;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  if (!identity || !identity.authorized) {
    return (
      <Login
        accessDenied
        accessEmail={identity?.email}
        onSignOut={() => void signOut()}
      />
    );
  }

  const user = identity || {};

  const counts = {
    benchmarks: benchmarks?.length || 0,
    initiatives: initiatives?.length || 0,
    emails: emailLogs?.length || 0,
    findings: scoutOverview?.ideasLastDay || 0
  };

  return (
    <div className="bg-background min-h-screen text-on-surface antialiased font-body">
      {/* Fixed Left Navigation Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={navigate}
        counts={counts}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      {/* Main Content Area */}
      <div className={sidebarCollapsed ? "pl-[72px]" : "pl-[72px] md:pl-[260px] transition-all duration-200"}>
        {/* Fixed Top Header */}
        <Header
          activeTab={activeTab}
          setActiveTab={navigate}
          user={user}
          onLogout={() => void signOut()}
          sidebarCollapsed={sidebarCollapsed}
        />

        {/* Dynamic Page Views */}
        <main className="relative pt-16 bg-background min-h-screen">
          <Suspense fallback={<div className="grid min-h-64 place-items-center text-xs text-secondary">Loading workspace…</div>}>
            <div className="w-full px-3 sm:px-5 lg:px-space-lg py-5 max-w-7xl mx-auto">
              {activeTab === "dashboard" && (
                <Dashboard
                  user={user}
                  counts={counts}
                  initiatives={initiatives}
                  overview={scoutOverview}
                  recentFindings={scoutFindings}
                  onNavigate={navigate}
                />
              )}

              {activeTab === "benchmark" && (
                <GlobalBenchmark
                  benchmarks={benchmarks}
                  benchmarkDraft={benchmarkDraft}
                  benchmarkJobs={benchmarkJobs}
                  saveBenchmarkDraft={saveBenchmarkDraft}
                  onExtractBrief={extractBrief}
                  onRunBenchmark={runBenchmark}
                  onUploadDocument={uploadDocument}
                />
              )}

              {activeTab === "scraping" && (
                <ContinuousScout onNavigate={navigate} />
              )}

              {activeTab === "automations" && (
                <Automations />
              )}

              {activeTab === "sources" && (
                <SourceRegistry />
              )}

              {activeTab === "emails" && (
                <EmailAuditLogs emailLogs={emailLogs} />
              )}
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default App;
