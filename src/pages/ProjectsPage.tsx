import { Fragment, useMemo, useState } from 'react';
import type { EChartsCoreOption } from '../components/EChart';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Flame,
  FolderKanban,
  GitBranch,
  Layers,
  MessageSquareText,
  Wrench,
} from 'lucide-react';
import { EChart, useChartTheme } from '../components/EChart';
import type { DashboardPayload, ProjectSummary } from '../shared/types';
import {
  cn,
  formatDuration,
  formatModelLabel,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  formatUsd,
  getGradeBadgeClass,
  getModelColor,
} from '../utils/format';
import { escapeHtml, sanitizeCssColor } from '../utils/sanitize';

export interface ProjectsPageProps {
  data: DashboardPayload;
  defaultIncludeSubagents: boolean;
  onSelectConversation: (conversationId: string) => void;
  onFilterByProject: (projectId: string) => void;
}

type SortField =
  | 'displayName'
  | 'conversations'
  | 'tokens'
  | 'cacheHit'
  | 'cost'
  | 'savings'
  | 'activeTime'
  | 'lastActive';
type SortDir = 'asc' | 'desc';
type ChartMetric = 'cost' | 'tokens';
type VisualMode = 'treemap' | 'bar';

const PROJECT_PALETTE = [
  '#6366f1',
  '#38bdf8',
  '#34d399',
  '#a78bfa',
  '#fbbf24',
  '#fb923c',
  '#22d3ee',
  '#f472b6',
  '#818cf8',
  '#10b981',
];

function cacheHitColor(ratio: number): string {
  if (ratio >= 0.9) return '#10b981';
  if (ratio >= 0.75) return '#38bdf8';
  if (ratio >= 0.5) return '#f59e0b';
  return '#f43f5e';
}

export function ProjectsPage({
  data,
  defaultIncludeSubagents,
  onSelectConversation,
  onFilterByProject,
}: ProjectsPageProps) {
  const [rollupMode, setRollupMode] = useState<'rolledUp' | 'direct'>(
    defaultIncludeSubagents ? 'rolledUp' : 'direct',
  );
  const [chartMetric, setChartMetric] = useState<ChartMetric>('cost');
  const [visualMode, setVisualMode] = useState<VisualMode>('treemap');
  const [colorByCache, setColorByCache] = useState(false);
  const [sortField, setSortField] = useState<SortField>('cost');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const theme = useChartTheme();

  const getBundle = (p: ProjectSummary) => (rollupMode === 'rolledUp' ? p.rolledUp : p.direct);

  const conversationsByProject = useMemo(() => {
    const map = new Map<string, DashboardPayload['conversations']>();
    for (const conv of data.conversations) {
      const list = map.get(conv.projectId);
      if (list) list.push(conv);
      else map.set(conv.projectId, [conv]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ca = rollupMode === 'rolledUp' ? a.rolledUp.cost.totalCost : a.direct.cost.totalCost;
        const cb = rollupMode === 'rolledUp' ? b.rolledUp.cost.totalCost : b.direct.cost.totalCost;
        return cb - ca;
      });
    }
    return map;
  }, [data.conversations, rollupMode]);

  const sortedProjects = useMemo(() => {
    const list = [...data.projects];
    list.sort((a, b) => {
      const ba = getBundle(a);
      const bb = getBundle(b);
      let cmp = 0;
      switch (sortField) {
        case 'displayName':
          cmp = a.displayName.localeCompare(b.displayName);
          break;
        case 'conversations':
          cmp =
            a.conversationCount +
            (rollupMode === 'rolledUp' ? a.subagentCount : 0) -
            (b.conversationCount + (rollupMode === 'rolledUp' ? b.subagentCount : 0));
          break;
        case 'tokens':
          cmp = ba.tokens.totalTokens - bb.tokens.totalTokens;
          break;
        case 'cacheHit':
          cmp = ba.tokens.cacheHitRatio - bb.tokens.cacheHitRatio;
          break;
        case 'cost':
          cmp = ba.cost.totalCost - bb.cost.totalCost;
          break;
        case 'savings':
          cmp = ba.cost.cacheSavings - bb.cost.cacheSavings;
          break;
        case 'activeTime':
          cmp = a.activeDurationMs - b.activeDurationMs;
          break;
        case 'lastActive':
          cmp = (a.lastActiveAt ?? '').localeCompare(b.lastActiveAt ?? '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [data.projects, rollupMode, sortField, sortDir]);

  // ECharts Treemap (Project -> Conversation hierarchy)
  const treemapOption = useMemo<EChartsCoreOption>(() => {
    const treeNodes = [...data.projects]
      .sort((a, b) => {
        const va = chartMetric === 'cost' ? getBundle(a).cost.totalCost : getBundle(a).tokens.totalTokens;
        const vb = chartMetric === 'cost' ? getBundle(b).cost.totalCost : getBundle(b).tokens.totalTokens;
        return vb - va;
      })
      .slice(0, 18)
      .map((p, idx) => {
        const bundle = getBundle(p);
        const projConvs = (conversationsByProject.get(p.id) ?? []).filter((c) =>
          rollupMode === 'direct' ? !c.parentConversationId : true,
        );
        const baseColor = colorByCache
          ? cacheHitColor(bundle.tokens.cacheHitRatio)
          : PROJECT_PALETTE[idx % PROJECT_PALETTE.length];

        const children = projConvs
          .map((c) => {
            const cb = rollupMode === 'rolledUp' ? c.direct : c.direct;
            const val = chartMetric === 'cost' ? cb.cost.totalCost : cb.tokens.totalTokens;
            return {
              name: c.title || 'Untitled',
              value: val,
              conversationId: c.id,
              projectId: p.id,
              cost: cb.cost.totalCost,
              tokens: cb.tokens.totalTokens,
              cacheHit: cb.tokens.cacheHitRatio,
              agentName: c.agentName,
              itemStyle: {
                color: colorByCache ? cacheHitColor(cb.tokens.cacheHitRatio) : baseColor,
                borderColor: theme.bgSurface,
                borderWidth: 1,
                gapWidth: 1,
              },
            };
          })
          .filter((c) => c.value > 0);

        const totalVal = chartMetric === 'cost' ? bundle.cost.totalCost : bundle.tokens.totalTokens;
        return {
          name: p.displayName,
          value: totalVal,
          projectId: p.id,
          cost: bundle.cost.totalCost,
          tokens: bundle.tokens.totalTokens,
          cacheHit: bundle.tokens.cacheHitRatio,
          itemStyle: {
            color: baseColor,
            borderColor: theme.bgSurface,
            borderWidth: 2,
            gapWidth: 2,
          },
          children: children.length > 0 ? children : undefined,
        };
      })
      .filter((n) => n.value > 0);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (info: unknown) => {
          const item = info as {
            name?: string;
            data?: {
              cost?: number;
              tokens?: number;
              cacheHit?: number;
              conversationId?: string;
              agentName?: string | null;
            };
            treePathInfo?: { name: string }[];
          };
          const d = item.data ?? {};
          const pathStr = escapeHtml(
            (item.treePathInfo ?? [])
              .slice(1)
              .map((p) => p.name)
              .join(' / ') || item.name || '',
          );
          const safeSecondary = sanitizeCssColor(theme.textSecondary);
          const safeMuted = sanitizeCssColor(theme.textMuted);
          return `<div style="max-width:280px;">
            <div style="font-weight:600;margin-bottom:4px;word-break:break-word;">${pathStr}</div>
            ${d.agentName ? `<div style="font-size:11px;color:#818cf8;margin-bottom:4px;">Agent: @${escapeHtml(d.agentName)}</div>` : ''}
            <div style="display:flex;justify-content:space-between;gap:16px;font-family:monospace;font-size:11px;">
              <span style="color:${safeSecondary};">API Spend:</span>
              <span style="font-weight:600;">${escapeHtml(formatUsd(d.cost ?? 0))}</span>
            </div>
            <div style="display:flex;justify-content:space-between;gap:16px;font-family:monospace;font-size:11px;">
              <span style="color:${safeSecondary};">Tokens:</span>
              <span>${escapeHtml(formatTokens(d.tokens ?? 0))}</span>
            </div>
            <div style="display:flex;justify-content:space-between;gap:16px;font-family:monospace;font-size:11px;">
              <span style="color:${safeSecondary};">Cache Hit:</span>
              <span style="color:#34d399;">${escapeHtml(formatPercent(d.cacheHit ?? 0))}</span>
            </div>
            ${d.conversationId ? `<div style="margin-top:5px;font-size:10px;color:${safeMuted};">Click tile to inspect conversation</div>` : ''}
          </div>`;
        },
      },
      series: [
        {
          name: 'Workspaces',
          type: 'treemap',
          width: '100%',
          height: '90%',
          top: 4,
          roam: false,
          nodeClick: 'zoomToNode',
          breadcrumb: {
            show: true,
            bottom: 2,
            height: 22,
            itemStyle: {
              color: theme.bgElevated,
              borderColor: theme.borderSubtle,
              borderWidth: 1,
              textStyle: { color: theme.textPrimary, fontSize: 11 },
            },
          },
          upperLabel: {
            show: true,
            height: 22,
            color: '#ffffff',
            fontSize: 11,
            fontWeight: 600,
            padding: [2, 6],
            backgroundColor: 'rgba(0,0,0,0.35)',
          },
          label: {
            show: true,
            color: '#ffffff',
            fontSize: 11,
            formatter: (params: { name: string; data?: { cost?: number; tokens?: number } }) => {
              const valStr =
                chartMetric === 'cost'
                  ? formatUsd(params.data?.cost ?? 0, { compact: true })
                  : formatTokens(params.data?.tokens ?? 0);
              return `${params.name}\n${valStr}`;
            },
          },
          levels: [
            { itemStyle: { borderColor: theme.borderSubtle, borderWidth: 0, gapWidth: 3 } },
            {
              itemStyle: { borderColor: theme.bgSurface, borderWidth: 2, gapWidth: 2 },
              emphasis: { itemStyle: { borderColor: '#ffffff' } },
            },
            {
              colorSaturation: [0.35, 0.65],
              itemStyle: { borderWidth: 1, gapWidth: 1, borderColorSaturation: 0.6 },
            },
          ],
          data: treeNodes,
        },
      ],
    };
  }, [data.projects, conversationsByProject, rollupMode, chartMetric, colorByCache, theme]);

  // ECharts Horizontal Bar fallback
  const barOption = useMemo<EChartsCoreOption>(() => {
    const top = [...data.projects]
      .sort((a, b) => {
        const va = chartMetric === 'cost' ? getBundle(a).cost.totalCost : getBundle(a).tokens.totalTokens;
        const vb = chartMetric === 'cost' ? getBundle(b).cost.totalCost : getBundle(b).tokens.totalTokens;
        return vb - va;
      })
      .slice(0, 12)
      .reverse();

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [];
          if (!arr[0]) return '';
          const idx = (arr[0] as { dataIndex: number }).dataIndex;
          const p = top[idx];
          if (!p) return '';
          const b = getBundle(p);
          return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(p.displayName)}</div>
            <div style="font-family:monospace;font-size:11px;">Spend: <b>${escapeHtml(formatUsd(b.cost.totalCost))}</b> · Savings: ${escapeHtml(formatUsd(b.cost.cacheSavings))}</div>
            <div style="font-family:monospace;font-size:11px;">Tokens: ${escapeHtml(formatTokens(b.tokens.totalTokens))} (${escapeHtml(formatPercent(b.tokens.cacheHitRatio))} cache)</div>`;
        },
      },
      grid: { top: 8, left: 12, right: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 11,
          formatter: (v: number) =>
            chartMetric === 'cost' ? formatUsd(v, { compact: true }) : formatTokens(v),
        },
      },
      yAxis: {
        type: 'category',
        data: top.map((p) => (p.displayName.length > 24 ? `${p.displayName.slice(0, 23)}…` : p.displayName)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 20,
          data: top.map((p, idx) => ({
            value: chartMetric === 'cost' ? getBundle(p).cost.totalCost : getBundle(p).tokens.totalTokens,
            projectId: p.id,
            itemStyle: {
              color: PROJECT_PALETTE[(top.length - 1 - idx) % PROJECT_PALETTE.length],
              borderRadius: [0, 4, 4, 0],
            },
          })),
        },
      ],
    };
  }, [data.projects, rollupMode, chartMetric, theme]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir(field === 'displayName' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-[var(--accent-primary)]" />
    ) : (
      <ArrowDown className="h-3 w-3 text-[var(--accent-primary)]" />
    );
  };

  const totalCost = useMemo(
    () => sortedProjects.reduce((sum, p) => sum + getBundle(p).cost.totalCost, 0),
    [sortedProjects, rollupMode],
  );

  return (
    <div className="space-y-5">
      {/* Interactive Spend Treemap / Bar Comparison */}
      <section className="surface-card rounded-xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {visualMode === 'treemap'
                ? 'Interactive Spend Treemap (Project → Conversation)'
                : 'Top Projects Comparison'}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {visualMode === 'treemap'
                ? 'Click a project to zoom in · click a conversation tile to open the Deep Inspector'
                : 'Click a bar to expand project details below'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Visual Mode */}
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setVisualMode('treemap')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                  visualMode === 'treemap'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                )}
              >
                Treemap
              </button>
              <button
                type="button"
                onClick={() => setVisualMode('bar')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                  visualMode === 'bar'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                )}
              >
                Bar Chart
              </button>
            </div>

            {/* Direct vs Rolled-Up */}
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setRollupMode('rolledUp')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                  rollupMode === 'rolledUp'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                )}
              >
                Rolled-Up
              </button>
              <button
                type="button"
                onClick={() => setRollupMode('direct')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                  rollupMode === 'direct'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                )}
              >
                Direct Only
              </button>
            </div>

            {/* Metric */}
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setChartMetric('cost')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                  chartMetric === 'cost'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                )}
              >
                Cost ($)
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('tokens')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                  chartMetric === 'tokens'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                )}
              >
                Tokens
              </button>
            </div>

            {visualMode === 'treemap' && (
              <button
                type="button"
                onClick={() => setColorByCache((v) => !v)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer',
                  colorByCache
                    ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-400'
                    : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-muted)]',
                )}
              >
                Color by Cache %
              </button>
            )}
          </div>
        </div>

        {sortedProjects.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
            No projects match the current filters.
          </div>
        ) : (
          <div className="h-[360px] w-full">
            <EChart
              key={visualMode}
              option={visualMode === 'treemap' ? treemapOption : barOption}
              onClick={(params) => {
                const p = params as { data?: { conversationId?: string; projectId?: string } };
                if (p?.data?.conversationId) {
                  onSelectConversation(p.data.conversationId);
                } else if (visualMode === 'bar' && p?.data?.projectId) {
                  setExpandedId((prev) =>
                    prev === p.data?.projectId ? null : String(p.data?.projectId),
                  );
                }
              }}
            />
          </div>
        )}
      </section>

      {/* Sortable Projects Table */}
      <section className="surface-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Workspaces & Projects ({sortedProjects.length})
            </h2>
          </div>
          <div className="mono-num text-xs text-[var(--text-muted)]">
            Total shown:{' '}
            <span className="font-semibold text-[var(--text-primary)]">
              {formatUsd(totalCost)}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 text-[11px] font-medium text-[var(--text-muted)]">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => handleSort('displayName')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    Project / Workspace {renderSortIcon('displayName')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('conversations')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    Chats {renderSortIcon('conversations')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('tokens')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    Tokens {renderSortIcon('tokens')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('cacheHit')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    Cache Hit {renderSortIcon('cacheHit')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('cost')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    API Cost {renderSortIcon('cost')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('activeTime')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    Active Time {renderSortIcon('activeTime')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">Diagnostics</th>
                <th className="px-3 py-2.5">Primary Model</th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('lastActive')}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    Last Active {renderSortIcon('lastActive')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {sortedProjects.map((project) => {
                const bundle = getBundle(project);
                const isExpanded = expandedId === project.id;
                const projectConvs = conversationsByProject.get(project.id) ?? [];

                return (
                  <Fragment key={project.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : project.id)}
                      className={cn(
                        'transition-colors hover:bg-[var(--bg-hover)]/50 cursor-pointer',
                        isExpanded && 'bg-[var(--bg-elevated)]/50',
                      )}
                    >
                      <td className="px-3 py-2.5 text-[var(--text-muted)]">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--text-primary)]">
                            {project.displayName}
                          </span>
                          {project.rolledUp.tokenStepCount > 0 && (
                            <span
                              className={cn(
                                'mono-num rounded border px-1 py-0 text-[10px] font-bold',
                                getGradeBadgeClass(project.efficiencyGrade),
                              )}
                              title={`Efficiency Score: ${project.efficiencyScore}/100`}
                            >
                              {project.efficiencyGrade}
                            </span>
                          )}
                        </div>
                        {project.workspacePath && (
                          <div className="mono-num truncate max-w-[260px] text-[11px] text-[var(--text-muted)]">
                            {project.workspacePath}
                          </div>
                        )}
                      </td>
                      <td className="mono-num px-3 py-2.5 text-right text-[var(--text-secondary)]">
                        <span>{formatNumber(project.conversationCount)}</span>
                        {project.subagentCount > 0 && (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-indigo-500/12 px-1 py-0.5 text-[10px] text-indigo-400">
                            +{project.subagentCount}
                          </span>
                        )}
                      </td>
                      <td className="mono-num px-3 py-2.5 text-right text-[var(--text-primary)]">
                        {formatTokens(bundle.tokens.totalTokens)}
                      </td>
                      <td className="mono-num px-3 py-2.5 text-right">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-medium',
                            bundle.tokens.cacheHitRatio >= 0.8
                              ? 'bg-emerald-500/12 text-emerald-400'
                              : bundle.tokens.cacheHitRatio >= 0.5
                                ? 'bg-sky-500/12 text-sky-400'
                                : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]',
                          )}
                        >
                          {formatPercent(bundle.tokens.cacheHitRatio)}
                        </span>
                      </td>
                      <td className="mono-num px-3 py-2.5 text-right font-semibold text-[var(--text-primary)]">
                        {formatUsd(bundle.cost.totalCost)}
                      </td>
                      <td className="mono-num px-3 py-2.5 text-right text-[var(--text-secondary)]">
                        {formatDuration(project.activeDurationMs)}
                      </td>
                      <td className="mono-num px-3 py-2.5 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {project.cacheMissSpikes > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded bg-amber-500/12 px-1.5 py-0.5 text-[10px] text-amber-400"
                              title={`${project.cacheMissSpikes} cache-miss spikes (${formatUsd(project.cacheMissWastedCost)} wasted)`}
                            >
                              <Flame className="h-2.5 w-2.5" />
                              {project.cacheMissSpikes}
                            </span>
                          )}
                          {project.errorCount > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded bg-rose-500/12 px-1.5 py-0.5 text-[10px] text-rose-400"
                              title={`${project.errorCount} errors (${formatUsd(project.errorCost)} burned)`}
                            >
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {project.errorCount}
                            </span>
                          )}
                          {project.cacheMissSpikes === 0 && project.errorCount === 0 && (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {project.primaryModel ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                            <span
                              className="h-1.5 w-1.5 rounded-full shrink-0"
                              style={{
                                backgroundColor: getModelColor(
                                  project.primaryModel,
                                  data.pricing.models,
                                ),
                              }}
                            />
                            <span className="truncate max-w-[130px]">
                              {formatModelLabel(project.primaryModel, data.pricing.models)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="mono-num px-3 py-2.5 text-right text-[var(--text-muted)]">
                        {formatRelativeTime(project.lastActiveAt)}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[var(--bg-app)]/70">
                        <td colSpan={10} className="px-4 py-4">
                          <div className="space-y-4">
                            {/* Summary strip */}
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--bg-surface)] px-3.5 py-2.5 border border-[var(--border-subtle)]">
                              <div className="flex flex-wrap items-center gap-4 text-xs">
                                <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                                  <Layers className="h-3.5 w-3.5 text-[var(--accent-uncached)]" />
                                  In: <strong className="mono-num text-[var(--text-primary)]">{formatTokens(bundle.tokens.uncachedInput)}</strong>
                                  · Cache: <strong className="mono-num text-[var(--text-primary)]">{formatTokens(bundle.tokens.cacheRead)}</strong>
                                  · Out: <strong className="mono-num text-[var(--text-primary)]">{formatTokens(bundle.tokens.output)}</strong>
                                </span>
                                <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                                  <Clock className="h-3.5 w-3.5 text-sky-400" />
                                  Active: <strong className="mono-num text-[var(--text-primary)]">{formatDuration(project.activeDurationMs)}</strong>
                                </span>
                                {project.cacheMissWastedCost > 0 && (
                                  <span className="mono-num text-amber-400">
                                    Cache-miss waste: {formatUsd(project.cacheMissWastedCost)}
                                  </span>
                                )}
                                {project.errorCost > 0 && (
                                  <span className="mono-num text-rose-400">
                                    Error burn: {formatUsd(project.errorCost)}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onFilterByProject(project.id);
                                }}
                                className="rounded-md bg-[var(--accent-primary)]/15 px-2.5 py-1 text-xs font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/25 transition-colors cursor-pointer"
                              >
                                Filter entire dashboard to this project
                              </button>
                            </div>

                            {/* Models + Top Tools + Conversations */}
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                              <div className="space-y-3 lg:col-span-4">
                                <div className="rounded-lg bg-[var(--bg-surface)] p-3 border border-[var(--border-subtle)]">
                                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                                    <Cpu className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                    Models Used ({project.modelsUsed.length})
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {project.modelsUsed.length === 0 ? (
                                      <span className="text-[11px] text-[var(--text-muted)]">No token-bearing steps</span>
                                    ) : (
                                      project.modelsUsed.map((mId) => (
                                        <span
                                          key={mId}
                                          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                                        >
                                          <span
                                            className="h-2 w-2 rounded-full"
                                            style={{ backgroundColor: getModelColor(mId, data.pricing.models) }}
                                          />
                                          {formatModelLabel(mId, data.pricing.models)}
                                        </span>
                                      ))
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-lg bg-[var(--bg-surface)] p-3 border border-[var(--border-subtle)]">
                                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                                    <Wrench className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                    Top Tools
                                  </div>
                                  {project.topTools.length === 0 ? (
                                    <span className="text-[11px] text-[var(--text-muted)]">No tool calls recorded</span>
                                  ) : (
                                    <div className="space-y-1.5">
                                      {project.topTools.slice(0, 6).map((tool) => (
                                        <div key={tool.name} className="flex items-center justify-between text-[11px]">
                                          <span className="mono-num truncate text-[var(--text-secondary)]">{tool.name}</span>
                                          <span className="mono-num text-[var(--text-primary)] font-medium">
                                            {formatNumber(tool.calls)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-lg bg-[var(--bg-surface)] p-3 border border-[var(--border-subtle)] lg:col-span-8">
                                <div className="mb-2 flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                                    <MessageSquareText className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                    Conversations ({projectConvs.length})
                                  </div>
                                  <span className="text-[11px] text-[var(--text-muted)]">Click any chat to inspect</span>
                                </div>
                                <div className="max-h-[260px] divide-y divide-[var(--border-subtle)] overflow-y-auto pr-1">
                                  {projectConvs.slice(0, 20).map((conv) => {
                                    const cb = rollupMode === 'rolledUp' ? conv.rolledUp : conv.direct;
                                    return (
                                      <button
                                        key={conv.id}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onSelectConversation(conv.id);
                                        }}
                                        className="group flex w-full items-center justify-between gap-3 py-2 px-1.5 -mx-1.5 rounded-md text-left hover:bg-[var(--bg-hover)]/60 transition-colors cursor-pointer"
                                      >
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5">
                                            <span className="truncate text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]">
                                              {conv.title || 'Untitled Conversation'}
                                            </span>
                                            {conv.agentName && (
                                              <span className="inline-flex items-center gap-0.5 rounded bg-indigo-500/12 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400">
                                                <GitBranch className="h-2.5 w-2.5" />
                                                {conv.agentName}
                                              </span>
                                            )}
                                          </div>
                                          <div className="mono-num mt-0.5 text-[11px] text-[var(--text-muted)]">
                                            {formatNumber(cb.stepCount)} steps · {formatTokens(cb.tokens.totalTokens)} ·{' '}
                                            {formatPercent(cb.tokens.cacheHitRatio)} cache ·{' '}
                                            {formatRelativeTime(conv.lastStepAt ?? conv.lastModifiedTime)}
                                          </div>
                                        </div>
                                        <span className="mono-num shrink-0 text-xs font-semibold text-[var(--text-primary)]">
                                          {formatUsd(cb.cost.totalCost)}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
