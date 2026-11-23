import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FileText,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Search,
} from 'lucide-react';
import { ConversationInspector } from '../components/ConversationInspector';
import type { ConversationSummary, DashboardPayload, PricingConfig } from '../shared/types';
import { getGradeBadgeClass } from '../utils/format';

export interface ConversationsPageProps {
  data: DashboardPayload;
  includeSubagents: boolean;
  selectedConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  onSelectProject: (projectId: string) => void;
  onSetModelOverride?: (conversationId: string, modelId: string | null) => Promise<void>;
}

type SortKey = 'lastActive' | 'cost' | 'tokens' | 'steps' | 'cacheHit' | 'subagents' | 'title';
type SortDir = 'asc' | 'desc';

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0.00';
  if (Math.abs(value) < 0.001) return '<$0.001';
  if (Math.abs(value) < 10) return `$${value.toFixed(3)}`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getAgentBadgeColor(agentName: string | null): string {
  if (!agentName) return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
  const lower = agentName.toLowerCase();
  if (lower.includes('research') || lower.includes('search'))
    return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
  if (lower.includes('browser') || lower.includes('web'))
    return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (lower.includes('verif') || lower.includes('test') || lower.includes('review'))
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  if (lower.includes('self') || lower.includes('coord'))
    return 'bg-violet-500/15 text-violet-400 border-violet-500/30';
  return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
}

function getModelColor(modelId: string, pricing: PricingConfig): string {
  if (pricing.models[modelId]?.color) return pricing.models[modelId].color;
  const lower = modelId.toLowerCase();
  if (lower.includes('claude')) return '#fb923c';
  if (lower.includes('flash')) return '#34d399';
  if (lower.includes('gemini')) return '#60a5fa';
  if (lower.includes('gpt')) return '#a78bfa';
  if (lower.includes('deepseek')) return '#06b6d4';
  return '#94a3b8';
}

function getModelShortLabel(modelId: string, pricing: PricingConfig): string {
  const full = pricing.models[modelId]?.label ?? modelId;
  return full.length > 22 ? `${full.slice(0, 20)}…` : full;
}

function getActivityTimestamp(c: ConversationSummary): number {
  const raw = c.lastStepAt ?? c.lastModifiedTime ?? c.firstStepAt;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function ConversationsPage({
  data,
  includeSubagents,
  selectedConversationId,
  onSelectConversation,
  onSelectProject,
  onSetModelOverride,
}: ConversationsPageProps) {
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'transcript' | 'subagents' | 'errors'>(
    'all',
  );
  const [metricMode, setMetricMode] = useState<'rolledUp' | 'direct'>(
    includeSubagents ? 'rolledUp' : 'direct',
  );
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setMetricMode(includeSubagents ? 'rolledUp' : 'direct');
  }, [includeSubagents]);

  // Build parent -> children map from data.conversations
  const { byId, childrenMap, rootConversations } = useMemo(() => {
    const map = new Map<string, ConversationSummary>();
    for (const c of data.conversations) {
      map.set(c.id, c);
    }

    const childMap = new Map<string, ConversationSummary[]>();
    for (const c of data.conversations) {
      if (c.parentConversationId && map.has(c.parentConversationId)) {
        const list = childMap.get(c.parentConversationId) ?? [];
        list.push(c);
        childMap.set(c.parentConversationId, list);
      }
    }

    // Sort children chronologically / by cost
    for (const [, list] of childMap) {
      list.sort((a, b) => {
        const ta = a.firstStepAt ?? a.lastModifiedTime ?? '';
        const tb = b.firstStepAt ?? b.lastModifiedTime ?? '';
        if (ta && tb && ta !== tb) return ta.localeCompare(tb);
        return b.rolledUp.cost.totalCost - a.rolledUp.cost.totalCost;
      });
    }

    const roots = data.conversations.filter(
      (c) => !c.parentConversationId || !map.has(c.parentConversationId),
    );

    return { byId: map, childrenMap: childMap, rootConversations: roots };
  }, [data.conversations]);

  // Helper to check if a conversation or any descendant matches search/filter
  const matchesSingle = (c: ConversationSummary, q: string): boolean => {
    if (quickFilter === 'transcript' && !c.hasTranscript) return false;
    if (quickFilter === 'subagents' && c.subagentCount === 0 && !c.parentConversationId)
      return false;
    if (quickFilter === 'errors' && c.errorCount === 0) return false;
    if (!q) return true;
    return (
      (c.title || '').toLowerCase().includes(q) ||
      c.projectDisplayName.toLowerCase().includes(q) ||
      (c.workspacePath || '').toLowerCase().includes(q) ||
      (c.agentName || '').toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.modelsUsed.some((m) => m.toLowerCase().includes(q))
    );
  };

  const filteredRoots = useMemo(() => {
    const q = search.trim().toLowerCase();

    const subtreeMatches = (c: ConversationSummary): boolean => {
      if (matchesSingle(c, q)) return true;
      const kids = childrenMap.get(c.id) ?? [];
      return kids.some((k) => subtreeMatches(k));
    };

    const list = rootConversations.filter((r) => subtreeMatches(r));

    const getBundle = (c: ConversationSummary) =>
      metricMode === 'rolledUp' ? c.rolledUp : c.direct;

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'cost':
          cmp = getBundle(a).cost.totalCost - getBundle(b).cost.totalCost;
          break;
        case 'tokens':
          cmp = getBundle(a).tokens.totalTokens - getBundle(b).tokens.totalTokens;
          break;
        case 'steps':
          cmp = getBundle(a).stepCount - getBundle(b).stepCount;
          break;
        case 'cacheHit':
          cmp = getBundle(a).tokens.cacheHitRatio - getBundle(b).tokens.cacheHitRatio;
          break;
        case 'subagents':
          cmp = a.subagentCount - b.subagentCount;
          break;
        case 'title':
          cmp = (a.title || a.id).localeCompare(b.title || b.id);
          break;
        case 'lastActive':
        default:
          cmp = getActivityTimestamp(a) - getActivityTimestamp(b);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [rootConversations, childrenMap, search, quickFilter, metricMode, sortKey, sortDir]);

  const expandableIds = useMemo(() => {
    const ids: string[] = [];
    for (const [id, kids] of childrenMap) {
      if (kids.length > 0) ids.push(id);
    }
    return ids;
  }, [childrenMap]);

  // If inspecting a specific conversation, render the Deep Conversation Inspector
  if (selectedConversationId) {
    return (
      <ConversationInspector
        conversationId={selectedConversationId}
        onBack={() => onSelectConversation(null)}
        onSelectConversation={(id) => onSelectConversation(id)}
        onSelectProject={onSelectProject}
        onSetModelOverride={onSetModelOverride}
        pricing={data.pricing}
      />
    );
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'title' ? 'asc' : 'desc');
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedIds(new Set(expandableIds));
  const collapseAll = () => setExpandedIds(new Set());

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === 'desc' ? (
      <ArrowDown className="h-3 w-3 text-[var(--accent-primary)]" />
    ) : (
      <ArrowUp className="h-3 w-3 text-[var(--accent-primary)]" />
    );
  };

  const renderRow = (conv: ConversationSummary, depth: number): ReactNode => {
    const kids = childrenMap.get(conv.id) ?? [];
    const hasKids = kids.length > 0;
    const isExpanded = expandedIds.has(conv.id);
    const activeBundle = metricMode === 'rolledUp' ? conv.rolledUp : conv.direct;
    const showDualCost =
      hasKids &&
      Math.abs(conv.rolledUp.cost.totalCost - conv.direct.cost.totalCost) > 0.0005;

    return (
      <Fragment key={conv.id}>
        <tr
          onClick={() => onSelectConversation(conv.id)}
          className={`group cursor-pointer transition-colors hover:bg-[var(--bg-hover)]/60 ${
            depth > 0 ? 'bg-[var(--bg-elevated)]/30' : ''
          }`}
        >
          {/* Conversation Title & Hierarchy */}
          <td className="py-3 px-4 max-w-[420px]">
            <div
              className="flex items-start gap-2"
              style={{ paddingLeft: `${Math.min(depth, 4) * 20}px` }}
            >
              {hasKids ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(conv.id);
                  }}
                  className="mt-0.5 p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0"
                  title={isExpanded ? 'Collapse subagents' : `Expand ${kids.length} subagents`}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : depth > 0 ? (
                <CornerDownRight className="h-3.5 w-3.5 mt-0.5 text-[var(--text-muted)] shrink-0" />
              ) : (
                <span className="w-4 shrink-0" />
              )}

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  {conv.agentName && (
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-medium shrink-0 ${getAgentBadgeColor(conv.agentName)}`}
                    >
                      <Bot className="h-2.5 w-2.5" />
                      {conv.agentName}
                    </span>
                  )}
                  <span className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors truncate">
                    {conv.title || 'Untitled Conversation'}
                  </span>
                  {conv.direct.tokenStepCount > 0 && (
                    <span
                      className={`mono-num rounded border px-1 py-0 text-[9px] font-bold shrink-0 ${getGradeBadgeClass(conv.efficiencyGrade)}`}
                      title={`Efficiency Score: ${conv.efficiencyScore}/100`}
                    >
                      {conv.efficiencyGrade}
                    </span>
                  )}
                  {conv.errorCount > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium bg-rose-500/15 text-rose-400 shrink-0"
                      title={`${conv.errorCount} step error(s)`}
                    >
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {conv.errorCount}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectProject(conv.projectId);
                    }}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    title={conv.workspacePath ?? conv.projectDisplayName}
                  >
                    <FolderOpen className="h-3 w-3" />
                    <span className="truncate max-w-[180px]">{conv.projectDisplayName}</span>
                  </button>

                  {conv.subagentCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[var(--accent-primary)] mono-num">
                      <GitBranch className="h-3 w-3" />
                      {conv.subagentCount} subagent{conv.subagentCount === 1 ? '' : 's'}
                    </span>
                  )}

                  {!conv.hasTranscript && (
                    <span className="inline-flex items-center gap-1 text-[var(--text-muted)] italic">
                      <FileText className="h-3 w-3" />
                      metadata only
                    </span>
                  )}
                </div>
              </div>
            </div>
          </td>

          {/* Models */}
          <td className="py-3 px-3 whitespace-nowrap">
            <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
              {conv.modelsUsed.slice(0, 2).map((m) => {
                const isUntaggedFallback =
                  conv.hasFallbackSteps &&
                  m === data.pricing.fallbackModelId &&
                  !conv.manualModelOverride;
                return (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium surface-elevated text-[var(--text-secondary)]"
                    title={
                      isUntaggedFallback
                        ? `Older transcript without model ID — estimated using ${getModelShortLabel(m, data.pricing)}`
                        : m
                    }
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: getModelColor(m, data.pricing) }}
                    />
                    {isUntaggedFallback
                      ? `Untagged (est. ${getModelShortLabel(m, data.pricing)})`
                      : getModelShortLabel(m, data.pricing)}
                  </span>
                );
              })}
              {conv.modelsUsed.length > 2 && (
                <span className="text-[10px] text-[var(--text-muted)] mono-num">
                  +{conv.modelsUsed.length - 2}
                </span>
              )}
              {conv.manualModelOverride && (
                <span className="rounded px-1 py-0 text-[9px] font-medium bg-violet-500/15 text-violet-400">
                  Tagged
                </span>
              )}
              {conv.modelsUsed.length === 0 && (
                <span className="text-[11px] text-[var(--text-muted)]">—</span>
              )}
            </div>
          </td>

          {/* Steps */}
          <td className="py-3 px-3 text-right mono-num whitespace-nowrap">
            <div className="text-[var(--text-primary)]">
              {activeBundle.stepCount.toLocaleString()}
            </div>
            {conv.userPrompts > 0 && (
              <div className="text-[10px] text-[var(--text-muted)]">
                {conv.userPrompts} prompt{conv.userPrompts === 1 ? '' : 's'}
              </div>
            )}
          </td>

          {/* Tokens */}
          <td className="py-3 px-3 text-right mono-num whitespace-nowrap">
            <div className="text-[var(--text-primary)]">
              {formatTokens(activeBundle.tokens.totalTokens)}
            </div>
            {showDualCost && (
              <div className="text-[10px] text-[var(--text-muted)]">
                {metricMode === 'rolledUp'
                  ? `Direct ${formatTokens(conv.direct.tokens.totalTokens)}`
                  : `Total ${formatTokens(conv.rolledUp.tokens.totalTokens)}`}
              </div>
            )}
          </td>

          {/* Cache Hit % */}
          <td className="py-3 px-3 text-right mono-num whitespace-nowrap">
            {activeBundle.tokens.totalContext > 0 ? (
              <div className="inline-flex flex-col items-end gap-1">
                <span className="text-[var(--accent-savings)] font-medium">
                  {(activeBundle.tokens.cacheHitRatio * 100).toFixed(1)}%
                </span>
                <div className="w-14 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent-cache)]"
                    style={{
                      width: `${Math.min(100, Math.round(activeBundle.tokens.cacheHitRatio * 100))}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <span className="text-[var(--text-muted)]">—</span>
            )}
          </td>

          {/* Cost */}
          <td className="py-3 px-4 text-right mono-num whitespace-nowrap">
            <div className="font-semibold text-[var(--text-primary)]">
              {formatCurrency(activeBundle.cost.totalCost)}
            </div>
            {showDualCost ? (
              <div className="text-[10px] text-[var(--text-muted)]">
                {metricMode === 'rolledUp'
                  ? `Direct ${formatCurrency(conv.direct.cost.totalCost)}`
                  : `Rolled-up ${formatCurrency(conv.rolledUp.cost.totalCost)}`}
              </div>
            ) : activeBundle.cost.cacheSavings > 0.001 ? (
              <div className="text-[10px] text-[var(--accent-savings)]">
                saved {formatCurrency(activeBundle.cost.cacheSavings)}
              </div>
            ) : null}
          </td>

          {/* Last Active */}
          <td
            className="py-3 px-4 text-right text-[11px] text-[var(--text-secondary)] whitespace-nowrap"
            title={conv.lastStepAt ?? conv.lastModifiedTime ?? undefined}
          >
            {formatRelativeTime(conv.lastStepAt ?? conv.lastModifiedTime)}
          </td>
        </tr>

        {hasKids && isExpanded && kids.map((child) => renderRow(child, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            Conversations & Subagent Trees
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Click any conversation to inspect its context-window growth, per-step costs, and
            execution trace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs mono-num">
          <span className="surface-card rounded-lg px-2.5 py-1.5 text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">
              {rootConversations.length}
            </span>{' '}
            root chats
          </span>
          <span className="surface-card rounded-lg px-2.5 py-1.5 text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--accent-primary)]">
              {data.conversations.length - rootConversations.length}
            </span>{' '}
            subagents
          </span>
        </div>
      </div>

      {/* Filter & Controls Toolbar */}
      <div className="surface-card rounded-xl p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, project, agent, model..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg surface-elevated text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] w-64"
            />
          </div>

          {/* Quick Filters */}
          <div className="inline-flex rounded-lg p-0.5 surface-elevated text-[11px]">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'transcript', label: 'With Transcript' },
                { id: 'subagents', label: 'Has Subagents' },
                { id: 'errors', label: 'Errors' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setQuickFilter(f.id)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                  quickFilter === f.id
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Rolled-Up vs Direct toggle */}
          <div className="inline-flex rounded-lg p-0.5 surface-elevated text-[11px]">
            <button
              type="button"
              onClick={() => setMetricMode('rolledUp')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                metricMode === 'rolledUp'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="Include descendant subagent tokens and costs on parent rows"
            >
              Rolled-Up
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('direct')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                metricMode === 'direct'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="Show direct tokens and costs for each conversation alone"
            >
              Direct Only
            </button>
          </div>

          {expandableIds.length > 0 && (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={expandAll}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium surface-elevated hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                Expand All
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium surface-elevated hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                Collapse
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Conversations Table */}
      <div className="surface-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                <th className="py-2.5 px-4">
                  <button
                    type="button"
                    onClick={() => handleSort('title')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer uppercase"
                  >
                    Conversation
                    {renderSortIcon('title')}
                  </button>
                </th>
                <th className="py-2.5 px-3">Models</th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('steps')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer uppercase ml-auto"
                  >
                    Steps
                    {renderSortIcon('steps')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('tokens')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer uppercase ml-auto"
                  >
                    Tokens
                    {renderSortIcon('tokens')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('cacheHit')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer uppercase ml-auto"
                  >
                    Cache Hit
                    {renderSortIcon('cacheHit')}
                  </button>
                </th>
                <th className="py-2.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('cost')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer uppercase ml-auto"
                  >
                    {metricMode === 'rolledUp' ? 'Rolled-Up Cost' : 'Direct Cost'}
                    {renderSortIcon('cost')}
                  </button>
                </th>
                <th className="py-2.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('lastActive')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer uppercase ml-auto"
                  >
                    Last Active
                    {renderSortIcon('lastActive')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredRoots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-[var(--text-muted)]">
                      <MessageSquare className="h-6 w-6 opacity-50" />
                      <p className="text-sm text-[var(--text-secondary)]">
                        No conversations match your filters.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRoots.map((root) => renderRow(root, 0))
              )}
            </tbody>
          </table>
        </div>
        {byId.size > 0 && (
          <div className="px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>
              Showing {filteredRoots.length} top-level conversation
              {filteredRoots.length === 1 ? '' : 's'}
            </span>
            <span>Click any row to open the Deep Conversation Inspector</span>
          </div>
        )}
      </div>
    </div>
  );
}
