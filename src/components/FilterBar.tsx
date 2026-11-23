import { useEffect, useRef, useState } from 'react';
import { Calendar, Cpu, Download, Folder, GitBranch, RotateCcw, Search, X } from 'lucide-react';
import type { DashboardFilterState, DatePreset } from '../hooks/useDashboardData';
import type { DashboardPayload } from '../shared/types';
import {
  exportConversationsCsv,
  exportDashboardJson,
  exportModelsCsv,
  exportProjectsCsv,
} from '../utils/export';
import { cn } from '../utils/format';

export interface FilterBarProps {
  filters: DashboardFilterState;
  data?: DashboardPayload | null;
  availableProjects: { id: string; displayName: string }[];
  availableModels: { id: string; label: string; isFallback?: boolean }[];
  onDatePresetChange: (preset: DatePreset) => void;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onProjectChange: (projectId: string) => void;
  onModelChange: (model: string) => void;
  onIncludeSubagentsChange: (include: boolean) => void;
  onSearchChange: (search: string) => void;
  onResetFilters: () => void;
}

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'all', label: 'All' },
];

export function FilterBar({
  filters,
  data,
  availableProjects,
  availableModels,
  onDatePresetChange,
  onStartDateChange,
  onEndDateChange,
  onProjectChange,
  onModelChange,
  onIncludeSubagentsChange,
  onSearchChange,
  onResetFilters,
}: FilterBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

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

      {/* Custom Date Inputs */}
      <div className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] px-2 py-1 border border-[var(--border-subtle)]">
        <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        <input
          type="date"
          aria-label="Start date"
          value={filters.startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="mono-num bg-transparent text-xs text-[var(--text-primary)] outline-none w-[114px]"
        />
        <span className="text-xs text-[var(--text-muted)]">→</span>
        <input
          type="date"
          aria-label="End date"
          value={filters.endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          className="mono-num bg-transparent text-xs text-[var(--text-primary)] outline-none w-[114px]"
        />
      </div>

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
