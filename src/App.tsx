import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { FilterBar } from './components/FilterBar';
import { Layout, type NavTab } from './components/Layout';
import { LiveToast } from './components/LiveToast';
import { useDashboardData } from './hooks/useDashboardData';
import { OverviewPage } from './pages/OverviewPage';

// Lazy-loaded secondary tabs and command palette to keep initial bundle lean
const ProjectsPage = lazy(() =>
  import('./pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
);
const ConversationsPage = lazy(() =>
  import('./pages/ConversationsPage').then((m) => ({ default: m.ConversationsPage })),
);
const SwarmsPage = lazy(() =>
  import('./pages/SwarmsPage').then((m) => ({ default: m.SwarmsPage })),
);
const ResetsPage = lazy(() =>
  import('./pages/ResetsPage').then((m) => ({ default: m.ResetsPage })),
);
const ModelsPage = lazy(() =>
  import('./pages/ModelsPage').then((m) => ({ default: m.ModelsPage })),
);
const EfficiencyLabPage = lazy(() =>
  import('./pages/EfficiencyLabPage').then((m) => ({ default: m.EfficiencyLabPage })),
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const {
    data,
    pricing,
    loading,
    refreshing,
    error,
    connectionStatus,
    lastUpdatedAt,
    filters,
    setDatePreset,
    setStartDate,
    setEndDate,
    applyTimeRange,
    setProjectId,
    setModel,
    setIncludeSubagents,
    setSearch,
    resetFilters,
    refresh,
    savePricing,
    resetPricing,
    saveResetConfig,
    syncResetFeed,
    setConversationModelOverride,
    liveDelta,
    dismissLiveDelta,
  } = useDashboardData();

  // Global Cmd/Ctrl+K shortcut for Command Palette
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleOpenConversation = useCallback((conversationId: string | null) => {
    setSelectedConversationId(conversationId);
    if (conversationId) {
      setActiveTab('conversations');
    }
  }, []);

  const handleJumpToProject = useCallback(
    (projectId: string) => {
      setProjectId(projectId);
      setActiveTab('projects');
    },
    [setProjectId],
  );

  const handleFilterProject = useCallback(
    (projectId: string) => {
      setProjectId(projectId);
      setActiveTab('overview');
    },
    [setProjectId],
  );

  const filterBar = (
    <FilterBar
      filters={filters}
      data={data}
      availableProjects={data?.availableProjects ?? []}
      availableModels={data?.availableModels ?? []}
      onDatePresetChange={setDatePreset}
      onStartDateChange={setStartDate}
      onEndDateChange={setEndDate}
      onApplyTimeRange={applyTimeRange}
      onProjectChange={setProjectId}
      onModelChange={setModel}
      onIncludeSubagentsChange={setIncludeSubagents}
      onSearchChange={setSearch}
      onResetFilters={resetFilters}
    />
  );

  return (
    <>
      <Layout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        connectionStatus={connectionStatus}
        lastUpdatedAt={lastUpdatedAt}
        watchedFiles={data?.watchedFiles}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        filterBar={filterBar}
      >
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 px-2.5 py-1 font-medium text-rose-200 hover:bg-rose-500/30 transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        {loading && !data ? (
          <LoadingSkeleton />
        ) : data ? (
          <Suspense fallback={<LoadingSkeleton />}>
            {activeTab === 'overview' && (
              <OverviewPage
                data={data}
                includeSubagents={filters.includeSubagents}
                onSelectProject={handleJumpToProject}
                onSelectConversation={(id) => handleOpenConversation(id)}
                onNavigateTab={(tab) => setActiveTab(tab)}
                onFilterToWindow={(startIso, endIso, label) => applyTimeRange(startIso, endIso, label)}
              />
            )}

            {activeTab === 'projects' && (
              <ProjectsPage
                data={data}
                defaultIncludeSubagents={filters.includeSubagents}
                onSelectConversation={(id) => handleOpenConversation(id)}
                onFilterByProject={handleFilterProject}
                onFilterToWindow={(startIso, endIso, label) => applyTimeRange(startIso, endIso, label)}
              />
            )}

            {activeTab === 'conversations' && (
              <ConversationsPage
                data={data}
                includeSubagents={filters.includeSubagents}
                selectedConversationId={selectedConversationId}
                onSelectConversation={handleOpenConversation}
                onSelectProject={handleJumpToProject}
                onSetModelOverride={setConversationModelOverride}
              />
            )}

            {activeTab === 'swarms' && (
              <SwarmsPage
                data={data}
                onSelectConversation={(id) => handleOpenConversation(id)}
              />
            )}

            {activeTab === 'resets' && (
              <ResetsPage
                data={data}
                onSaveResetConfig={saveResetConfig}
                onSyncResetFeed={syncResetFeed}
                onFilterToWindow={(startIso, endIso, label) => {
                  applyTimeRange(startIso, endIso, label);
                  setActiveTab('overview');
                }}
              />
            )}

            {activeTab === 'models' && (
              <ModelsPage
                data={data}
                pricing={pricing}
                onSavePricing={savePricing}
                onResetPricing={resetPricing}
              />
            )}

            {activeTab === 'efficiency' && (
              <EfficiencyLabPage
                data={data}
                onSelectConversation={(id: string) => handleOpenConversation(id)}
              />
            )}
          </Suspense>
        ) : (
          <div className="surface-card flex flex-col items-center justify-center rounded-xl py-16 text-center">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Unable to load Antigravity analytics
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Make sure the local Bun API server is running on port 3001.
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry Connection
            </button>
          </div>
        )}
      </Layout>

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            data={data}
            onNavigateTab={setActiveTab}
            onSelectProject={handleJumpToProject}
            onSelectConversation={(id) => handleOpenConversation(id)}
          />
        </Suspense>
      )}

      <LiveToast delta={liveDelta} onDismiss={dismissLiveDelta} />
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="surface-card h-[126px] rounded-xl p-4">
            <div className="h-3 w-28 rounded bg-[var(--bg-elevated)]" />
            <div className="mt-4 h-7 w-36 rounded bg-[var(--bg-elevated)]" />
            <div className="mt-4 h-3 w-48 rounded bg-[var(--bg-elevated)]" />
          </div>
        ))}
      </div>
      <div className="surface-card h-[360px] rounded-xl p-5">
        <div className="h-4 w-44 rounded bg-[var(--bg-elevated)]" />
        <div className="mt-6 h-[270px] rounded-lg bg-[var(--bg-elevated)]/60" />
      </div>
    </div>
  );
}

export default App;
