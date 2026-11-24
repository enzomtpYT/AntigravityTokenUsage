import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  Cpu,
  Download,
  Folder,
  GitBranch,
  RotateCcw,
  Search,
  Timer,
  X,
  Zap,
} from 'lucide-react';
import type { DashboardFilterState, DatePreset } from '../hooks/useDashboardData';
import type { DashboardPayload, ResetCycleSummary, ResetEventPool } from '../shared/types';
import {
  exportConversationsCsv,
  exportDashboardJson,
  exportModelsCsv,
  exportProjectsCsv,
} from '../utils/export';
import { cn, formatDateTime, formatNumber, formatUsd } from '../utils/format';

export interface FilterBarProps {
  filters: DashboardFilterState;
  data?: DashboardPayload | null;
  availableProjects: { id: string; displayName: string }[];
  availableModels: { id: string; label: string; isFallback?: boolean }[];
  onDatePresetChange: (preset: DatePreset) => void;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onApplyTimeRange: (startIso: string, endIso: string, label?: string) => void;
  onProjectChange: (projectId: string) => void;
  onModelChange: (model: string) => void;
  onIncludeSubagentsChange: (include: boolean) => void;
  onSearchChange: (search: string) => void;
  onResetFilters: () => void;
}

type ResetSourceTab = 'weekly' | '5h' | 'server';
type ResetRangeMode = 'untilNext' | 'toToday';

const PRESETS: { id: DatePreset; label: string; title?: string }[] = [
  { id: '5h', label: '5H', title: 'Current 5-hour quota reset window' },
  { id: 'cycle', label: 'Cycle', title: 'Current weekly quota reset window' },
  { id: '7d', label: '7D', title: 'Last 7 days' },
  { id: '30d', label: '30D', title: 'Last 30 days' },
  { id: 'all', label: 'All', title: 'All time' },
];

export function FilterBar({
  filters,
  data,
  availableProjects,
  availableModels,
  onDatePresetChange,
  onStartDateChange,
  onEndDateChange,
  onApplyTimeRange,
  onProjectChange,
  onModelChange,
  onIncludeSubagentsChange,
  onSearchChange,
  onResetFilters,
}: FilterBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [resetPickerOpen, setResetPickerOpen] = useState(false);
  const [resetSource, setResetSource] = useState<ResetSourceTab>('weekly');
  const [resetRangeMode, setResetRangeMode] = useState<ResetRangeMode>('untilNext');
  const [resetPool, setResetPool] = useState<ResetEventPool>('all');
  const exportRef = useRef<HTMLDivElement | null>(null);
  const resetPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  useEffect(() => {
    if (!resetPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (resetPickerRef.current && !resetPickerRef.current.contains(e.target as Node)) {
        setResetPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [resetPickerOpen]);

  const pickerCycles = useMemo<ResetCycleSummary[]>(() => {
    const ra = data?.resetAnalytics;
    if (!ra) return [];
    if (resetPool === 'gemini' && ra.pools?.gemini) {
      return resetSource === '5h' ? ra.pools.gemini.fiveHourCycles : ra.pools.gemini.weeklyCycles;
    }
    if (resetPool === 'claude_gpt' && ra.pools?.claude_gpt) {
      return resetSource === '5h'
        ? ra.pools.claude_gpt.fiveHourCycles
        : ra.pools.claude_gpt.weeklyCycles;
    }
    return resetSource === '5h' ? ra.fiveHourCycles : ra.weeklyCycles;
  }, [data?.resetAnalytics, resetPool, resetSource]);

  const pickerServerResets = useMemo(() => {
    const raw = data?.resetAnalytics?.config?.customResets ?? [];
    const filtered =
      resetPool === 'all'
        ? raw
        : raw.filter((r) => r.pool === 'all' || r.pool === resetPool);
    return [...filtered].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }, [data?.resetAnalytics?.config?.customResets, resetPool]);

  const handlePickCycle = (cycle: ResetCycleSummary) => {
    const poolTag =
      resetPool === 'gemini' ? 'Gemini ' : resetPool === 'claude_gpt' ? 'Claude ' : '';
    const scopeTag = cycle.scope === '5h' ? '5h' : 'Week';
    if (resetRangeMode === 'toToday') {
      onApplyTimeRange(
        cycle.startAt,
        '',
        `Since ${poolTag}${scopeTag} (${formatDateTime(cycle.startAt)}) → Today`,
      );
    } else {
      onApplyTimeRange(cycle.startAt, cycle.endAt, `${poolTag}${scopeTag}: ${cycle.label}`);
    }
    setResetPickerOpen(false);
  };

  const handlePickServerReset = (index: number) => {
    const marker = pickerServerResets[index];
    if (!marker) return;
    const nextMarker = index > 0 ? pickerServerResets[index - 1] : null;
    const startShort = formatDateTime(marker.timestamp);
    if (resetRangeMode === 'toToday' || !nextMarker) {
      onApplyTimeRange(marker.timestamp, '', `Since ⚡ ${startShort} → Today`);
    } else {
      const endShort = formatDateTime(nextMarker.timestamp);
      onApplyTimeRange(
        marker.timestamp,
        nextMarker.timestamp,
        `⚡ ${startShort} → ${endShort}`,
      );
    }
    setResetPickerOpen(false);
  };
  const hasActiveFilters =
    filters.datePreset !== 'all' ||
    filters.startDate !== '' ||
    filters.endDate !== '' ||
    filters.projectId !== '' ||
    filters.model !== '' ||
    !filters.includeSubagents ||
    filters.search.trim() !== '';

  return (
    <div className="surface-card flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5">
      {/* Date Range Presets */}
      <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
        {PRESETS.map((preset) => {
          const active = filters.datePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.title}
              onClick={() => onDatePresetChange(preset.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                active
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs border border-[var(--border-strong)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* By Reset Window Picker (Since reset -> Today OR Reset -> Next Reset) */}
      {data?.resetAnalytics && (
        <div className="relative" ref={resetPickerRef}>
          <button
            type="button"
            onClick={() => setResetPickerOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer',
              filters.customRangeLabel || resetPickerOpen
                ? 'bg-[var(--accent-primary)]/12 border-[var(--accent-primary)]/40 text-[var(--accent-primary)]'
                : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
            )}
            title="Filter all tabs from a specific reset until today, or from one reset until the next reset"
          >
            <Timer className="h-3.5 w-3.5" />
            <span>By Reset</span>
            <ChevronDown className="h-3 w-3 opacity-75" />
          </button>

          {resetPickerOpen && (
            <div className="absolute left-0 z-40 mt-1.5 w-[380px] max-w-[92vw] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 shadow-2xl space-y-2.5">
              {/* Mode Toggle: Until Next Reset vs Since Reset -> Today */}
              <div className="space-y-1">
                <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Range Mode
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setResetRangeMode('untilNext')}
                    className={cn(
                      'rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                      resetRangeMode === 'untilNext'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                        : 'text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)]',
                    )}
                  >
                    Reset → Next Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetRangeMode('toToday')}
                    className={cn(
                      'rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                      resetRangeMode === 'toToday'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                        : 'text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)]',
                    )}
                  >
                    Since Reset → Today
                  </button>
                </div>
              </div>

              {/* Source & Pool Selectors */}
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
                  {(
                    [
                      { id: 'weekly', label: 'Weekly' },
                      { id: '5h', label: '5-Hour' },
                      { id: 'server', label: '⚡ Server' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setResetSource(t.id)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer',
                        resetSource === t.id
                          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                          : 'text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)]',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <select
                  aria-label="Quota pool for reset picker"
                  value={resetPool}
                  onChange={(e) => setResetPool(e.target.value as ResetEventPool)}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] outline-none cursor-pointer"
                >
                  <option value="all">All Pools</option>
                  <option value="gemini">Gemini Pool</option>
                  <option value="claude_gpt">Claude &amp; GPT</option>
                </select>
              </div>

              {/* Scrollable Reset List */}
              <div className="max-h-[250px] overflow-y-auto divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
                {resetSource === 'server' ? (
                  pickerServerResets.length === 0 ? (
                    <div className="px-3 py-5 text-center text-[11px] text-[var(--text-muted)]">
                      No server reset cutlines synced yet. Sync from Quota &amp; Resets tab.
                    </div>
                  ) : (
                    pickerServerResets.map((marker, idx) => {
                      const nextMarker = idx > 0 ? pickerServerResets[idx - 1] : null;
                      return (
                        <button
                          key={marker.id}
                          type="button"
                          onClick={() => handlePickServerReset(idx)}
                          className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                              <Zap className="h-3 w-3 shrink-0 text-amber-400" />
                              <span className="truncate">{marker.label}</span>
                            </div>
                            <div className="mono-num mt-0.5 text-[10px] text-[var(--text-muted)]">
                              {resetRangeMode === 'toToday' || !nextMarker
                                ? `Since ${formatDateTime(marker.timestamp)} → Today`
                                : `${formatDateTime(marker.timestamp)} → ${formatDateTime(nextMarker.timestamp)}`}
                            </div>
                          </div>
                          <span className="shrink-0 rounded bg-amber-500/12 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                            {marker.pool === 'all' ? 'All' : marker.pool === 'gemini' ? 'Gemini' : 'Claude'}
                          </span>
                        </button>
                      );
                    })
                  )
                ) : pickerCycles.length === 0 ? (
                  <div className="px-3 py-5 text-center text-[11px] text-[var(--text-muted)]">
                    No {resetSource === '5h' ? '5-hour' : 'weekly'} cycles found.
                  </div>
                ) : (
                  pickerCycles.slice(0, 24).map((cycle) => {
                    const pm =
                      resetPool === 'gemini'
                        ? cycle.gemini
                        : resetPool === 'claude_gpt'
                          ? cycle.claudeGpt
                          : cycle.combined;
                    return (
                      <button
                        key={cycle.id}
                        type="button"
                        onClick={() => handlePickCycle(cycle)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                            <span className="mono-num truncate">{cycle.label}</span>
                            {cycle.isCurrent && (
                              <span className="rounded bg-emerald-500/15 px-1 py-0.2 text-[9px] font-semibold text-emerald-400">
                                LIVE
                              </span>
                            )}
                            {cycle.startedByServerReset && (
                              <span className="rounded bg-amber-500/15 px-1 py-0.2 text-[9px] font-medium text-amber-400">
                                ⚡
                              </span>
                            )}
                          </div>
                          <div className="mono-num mt-0.5 text-[10px] text-[var(--text-muted)]">
                            {resetRangeMode === 'toToday'
                              ? `Since ${formatDateTime(cycle.startAt)} → Today`
                              : `${formatDateTime(cycle.startAt)} → ${formatDateTime(cycle.endAt)}`}
                          </div>
                        </div>
                        <div className="mono-num shrink-0 text-right">
                          <div className="text-xs font-semibold text-[var(--text-primary)]">
                            {formatUsd(pm.cost.totalCost)}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {formatNumber(pm.tokenSteps)} turns
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Custom Date Inputs or Active Reset Window Pill */}
      {filters.customRangeLabel ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)]/12 px-2.5 py-1 border border-[var(--accent-primary)]/35 text-xs">
          <button
            type="button"
            onClick={() => setResetPickerOpen((v) => !v)}
            className="flex items-center gap-1.5 cursor-pointer"
            title="Click to change reset window or range mode"
          >
            <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" />
            <span className="mono-num font-medium text-[var(--text-primary)] max-w-[260px] truncate">
              {filters.customRangeLabel}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onDatePresetChange('all')}
            aria-label="Clear reset window filter"
            className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] px-2 py-1 border border-[var(--border-subtle)]">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          <input
            type="date"
            aria-label="Start date"
            value={filters.startDate.slice(0, 10)}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="mono-num bg-transparent text-xs text-[var(--text-primary)] outline-none w-[114px]"
          />
          <span className="text-xs text-[var(--text-muted)]">→</span>
          <input
            type="date"
            aria-label="End date"
            value={filters.endDate.slice(0, 10)}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="mono-num bg-transparent text-xs text-[var(--text-primary)] outline-none w-[114px]"
          />
        </div>
      )}

      {/* Project Selector */}
      <div className="relative flex items-center rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1 border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors">
        <Folder className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        <select
          aria-label="Filter by project"
          value={filters.projectId}
          onChange={(e) => onProjectChange(e.target.value)}
          className="max-w-[160px] truncate bg-transparent text-xs font-medium text-[var(--text-primary)] outline-none cursor-pointer pr-1"
        >
          <option value="" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
            All Projects
          </option>
          {availableProjects.map((project) => (
            <option
              key={project.id}
              value={project.id}
              className="bg-[var(--bg-surface)] text-[var(--text-primary)]"
            >
              {project.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Model Selector */}
      <div className="relative flex items-center rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1 border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors">
        <Cpu className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        <select
          aria-label="Filter by model"
          value={filters.model}
          onChange={(e) => onModelChange(e.target.value)}
          className="max-w-[175px] truncate bg-transparent text-xs font-medium text-[var(--text-primary)] outline-none cursor-pointer pr-1"
        >
          <option value="" className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
            All Models
          </option>
          {availableModels.map((model) => (
            <option
              key={model.id}
              value={model.id}
              className="bg-[var(--bg-surface)] text-[var(--text-primary)]"
            >
              {model.isFallback ? `Untagged (est. ${model.label})` : model.label}
            </option>
          ))}
        </select>
      </div>

      {/* Include Subagents Toggle */}
      <button
        type="button"
        role="switch"
        aria-checked={filters.includeSubagents}
        onClick={() => onIncludeSubagentsChange(!filters.includeSubagents)}
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer',
          filters.includeSubagents
            ? 'bg-[var(--accent-primary)]/12 border-[var(--accent-primary)]/40 text-[var(--text-primary)]'
            : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        )}
        title="Include subagent and swarm worker token usage in aggregates"
      >
        <GitBranch
          className={cn(
            'h-3.5 w-3.5',
            filters.includeSubagents
              ? 'text-[var(--accent-primary)]'
              : 'text-[var(--text-muted)]',
          )}
        />
        <span>Subagents</span>
        <span
          className={cn(
            'inline-flex h-3.5 w-6 items-center rounded-full p-0.5 transition-colors',
            filters.includeSubagents
              ? 'bg-[var(--accent-primary)] justify-end'
              : 'bg-[var(--border-strong)] justify-start',
          )}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-white shadow-xs" />
        </span>
      </button>

      {/* Search Input */}
      <div className="relative flex min-w-[180px] flex-1 items-center rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1 border border-[var(--border-subtle)] focus-within:border-[var(--accent-primary)] transition-colors">
        <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search conversations, projects..."
          className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="ml-1 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Export Dropdown */}
      {data && (
        <div className="relative" ref={exportRef}>
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            title="Export filtered analytics as CSV or JSON"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
          {exportOpen && (
            <div className="absolute right-0 z-30 mt-1.5 w-44 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-1 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  exportProjectsCsv(data);
                  setExportOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <span>Projects</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">CSV</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  exportConversationsCsv(data);
                  setExportOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <span>Conversations</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">CSV</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  exportModelsCsv(data);
                  setExportOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <span>Models</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">CSV</span>
              </button>
              <div className="my-1 border-t border-[var(--border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  exportDashboardJson(data);
                  setExportOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <span>Full Snapshot</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">JSON</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reset Button */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          title="Reset all filters"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>
      )}
    </div>
  );
}
