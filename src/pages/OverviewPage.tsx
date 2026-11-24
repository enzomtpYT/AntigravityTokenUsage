import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from '../components/EChart';
import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  BookOpen,
  CalendarDays,
  Clock,
  Code2,
  Coins,
  Cpu,
  Flame,
  FolderKanban,
  Layers,
  MessageSquareText,
  MoonStar,
  Sparkles,
  Timer,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import { EChart, useChartTheme } from '../components/EChart';
import { KpiCard } from '../components/KpiCard';
import type { NavTab } from '../components/Layout';
import type { DashboardPayload, ResetCycleSummary, TimeSeriesPoint } from '../shared/types';
import {
  cn,
  formatDateTime,
  formatDuration,
  formatModelLabel,
  formatMultiplier,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  formatUsd,
  getGradeBadgeClass,
  getModelColor,
} from '../utils/format';
import { escapeHtml, sanitizeCssColor } from '../utils/sanitize';

export interface OverviewPageProps {
  data: DashboardPayload;
  includeSubagents: boolean;
  onSelectProject: (projectId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onNavigateTab: (tab: Exclude<NavTab, 'overview'>) => void;
  onFilterToWindow: (startIso: string, endIso: string, label: string) => void;
}

type Granularity = 'daily' | 'hourly' | 'cumulative' | 'reset5h' | 'resetWeekly';
type ChartMetric = 'cost' | 'tokens';
type StackMode = 'tokenType' | 'model';

function computeMovingAverage(values: number[], windowSize: number): (number | null)[] {
  return values.map((_, idx) => {
    const start = Math.max(0, idx - windowSize + 1);
    const slice = values.slice(start, idx + 1);
    if (slice.length === 0) return null;
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / slice.length;
  });
}

export function OverviewPage({
  data,
  includeSubagents,
  onSelectProject,
  onSelectConversation,
  onNavigateTab,
  onFilterToWindow,
}: OverviewPageProps) {
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [metric, setMetric] = useState<ChartMetric>('cost');
  const [stackMode, setStackMode] = useState<StackMode>('tokenType');
  const [showMovingAvg, setShowMovingAvg] = useState(true);
  const theme = useChartTheme();

  const { kpis, pricing, efficiency, subscriptionRoi, funInsights, periodDeltas, resetAnalytics } =
    data;

  const totalTok = Math.max(kpis.tokens.totalTokens, 1);
  const uncachedPct = (kpis.tokens.uncachedInput / totalTok) * 100;
  const cachePct = (kpis.tokens.cacheRead / totalTok) * 100;
  const outputPct = (kpis.tokens.output / totalTok) * 100;

  const topModelIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const m of data.models) {
      if (!seen.has(m.modelId)) {
        seen.add(m.modelId);
        ids.push(m.modelId);
      }
      if (ids.length >= 6) break;
    }
    return ids;
  }, [data.models]);

  const resetCycleSeries = useMemo<{
    points: TimeSeriesPoint[];
    cycles: ResetCycleSummary[];
  }>(() => {
    const raw =
      granularity === 'reset5h'
        ? resetAnalytics?.fiveHourCycles ?? []
        : granularity === 'resetWeekly'
          ? resetAnalytics?.weeklyCycles ?? []
          : [];
    const chronological = [...raw].slice(0, 32).reverse();
    let runCost = 0;
    const points: TimeSeriesPoint[] = chronological.map((c) => {
      runCost += c.combined.cost.totalCost;
      const prefix = c.startedByServerReset ? '⚡ ' : '';
      const suffix = c.isCurrent ? ' ★' : '';
      return {
        bucket: c.id,
        label: `${prefix}${c.label}${suffix}`,
        uncachedInput: c.combined.tokens.uncachedInput,
        cacheRead: c.combined.tokens.cacheRead,
        output: c.combined.tokens.output,
        totalTokens: c.combined.tokens.totalTokens,
        totalCost: c.combined.cost.totalCost,
        cumulativeCost: runCost,
        cacheSavings: c.combined.cost.cacheSavings,
        steps: c.combined.tokenSteps,
        byModelCost: c.byModelCost,
        byModelTokens: c.byModelTokens,
        byProjectCost: c.byProjectCost ?? {},
      };
    });
    return { points, cycles: chronological };
  }, [granularity, resetAnalytics]);

  const isResetGranularity = granularity === 'reset5h' || granularity === 'resetWeekly';
  const seriesSource = isResetGranularity
    ? resetCycleSeries.points
    : granularity === 'hourly'
      ? data.hourlySeries
      : data.dailySeries;

  // Quick Per-Reset summary metrics for the Overview Per-Reset Snapshot Strip
  const resetSummary = useMemo(() => {
    if (!resetAnalytics) return null;
    const gem5h = resetAnalytics.pools?.gemini?.current5h ?? resetAnalytics.current5h;
    const gemWeek = resetAnalytics.pools?.gemini?.currentWeekly ?? resetAnalytics.currentWeekly;
    const active5h = resetAnalytics.fiveHourCycles.filter((c) => c.combined.tokenSteps > 0);
    const activeWeekly = resetAnalytics.weeklyCycles.filter((c) => c.combined.tokenSteps > 0);
    const avg5hCost =
      active5h.length > 0
        ? active5h.reduce((s, c) => s + c.combined.cost.totalCost, 0) / active5h.length
        : 0;
    const avgWeeklyCost =
      activeWeekly.length > 0
        ? activeWeekly.reduce((s, c) => s + c.combined.cost.totalCost, 0) / activeWeekly.length
        : 0;
    const latestServerReset =
      [...(resetAnalytics.config.customResets ?? [])].sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      )[0] ?? null;
    return {
      gem5h,
      gemWeek,
      active5hCount: active5h.length,
      activeWeeklyCount: activeWeekly.length,
      avg5hCost,
      avgWeeklyCost,
      latestServerReset,
    };
  }, [resetAnalytics]);

  // Build ECharts Time-Series option
  const timeSeriesOption = useMemo<EChartsCoreOption>(() => {
    const labels = seriesSource.map((p) => p.label);
    const series: Record<string, unknown>[] = [];
    const enableZoom = seriesSource.length > 10;

    if (granularity === 'cumulative') {
      let runTok = 0;
      const values = seriesSource.map((p) => {
        runTok += p.totalTokens;
        return metric === 'cost' ? p.cumulativeCost : runTok;
      });
      series.push({
        name: metric === 'cost' ? 'Cumulative Spend' : 'Cumulative Tokens',
        type: 'line',
        smooth: 0.25,
        showSymbol: seriesSource.length <= 24,
        symbolSize: 5,
        data: values,
        lineStyle: { width: 2.5, color: '#6366f1' },
        itemStyle: { color: '#6366f1' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(99, 102, 241, 0.35)' },
              { offset: 1, color: 'rgba(99, 102, 241, 0.02)' },
            ],
          },
        },
      });
    } else if (stackMode === 'tokenType') {
      if (metric === 'cost') {
        series.push(
          {
            name: 'Estimated Spend',
            type: 'bar',
            stack: 'cost',
            barMaxWidth: 28,
            itemStyle: { color: '#6366f1', borderRadius: [0, 0, 0, 0] },
            data: seriesSource.map((p) => p.totalCost),
          },
          {
            name: 'Cache Savings',
            type: 'bar',
            stack: 'cost',
            barMaxWidth: 28,
            itemStyle: { color: 'rgba(16, 185, 129, 0.45)', borderRadius: [3, 3, 0, 0] },
            data: seriesSource.map((p) => p.cacheSavings),
          },
        );
      } else {
        series.push(
          {
            name: 'Uncached Input',
            type: 'bar',
            stack: 'tok',
            barMaxWidth: 28,
            itemStyle: { color: '#38bdf8' },
            data: seriesSource.map((p) => p.uncachedInput),
          },
          {
            name: 'Cache Read',
            type: 'bar',
            stack: 'tok',
            barMaxWidth: 28,
            itemStyle: { color: '#34d399' },
            data: seriesSource.map((p) => p.cacheRead),
          },
          {
            name: 'Output',
            type: 'bar',
            stack: 'tok',
            barMaxWidth: 28,
            itemStyle: { color: '#a78bfa', borderRadius: [3, 3, 0, 0] },
            data: seriesSource.map((p) => p.output),
          },
        );
      }
    } else {
      const otherVals = seriesSource.map((p) => {
        const map = metric === 'cost' ? p.byModelCost : p.byModelTokens;
        let sum = 0;
        for (const [mId, v] of Object.entries(map)) {
          if (!topModelIds.includes(mId)) sum += v;
        }
        return sum;
      });
      const hasOther = otherVals.some((v) => v > 0);

      topModelIds.forEach((mId, idx) => {
        const isTop = !hasOther && idx === topModelIds.length - 1;
        series.push({
          name: formatModelLabel(mId, pricing.models),
          type: 'bar',
          stack: 'model',
          barMaxWidth: 28,
          itemStyle: {
            color: getModelColor(mId, pricing.models),
            borderRadius: isTop ? [3, 3, 0, 0] : [0, 0, 0, 0],
          },
          data: seriesSource.map((p) => {
            const map = metric === 'cost' ? p.byModelCost : p.byModelTokens;
            return map[mId] ?? 0;
          }),
        });
      });

      if (hasOther) {
        series.push({
          name: 'Other Models',
          type: 'bar',
          stack: 'model',
          barMaxWidth: 28,
          itemStyle: { color: '#94a3b8', borderRadius: [3, 3, 0, 0] },
          data: otherVals,
        });
      }
    }

    // Add moving average overlay for Daily/Hourly/Per-Reset
    if (granularity !== 'cumulative' && showMovingAvg && seriesSource.length >= 3) {
      const rawTotals = seriesSource.map((p) => (metric === 'cost' ? p.totalCost : p.totalTokens));
      const maWindow = granularity === 'daily' ? 7 : granularity === 'hourly' ? 6 : 4;
      const ma = computeMovingAverage(rawTotals, maWindow);
      series.push({
        name:
          granularity === 'daily'
            ? '7d Moving Avg'
            : granularity === 'hourly'
              ? '6h Moving Avg'
              : '4-Reset Avg',
        type: 'line',
        smooth: 0.3,
        symbol: 'none',
        z: 10,
        lineStyle: { width: 2, type: 'dashed', color: '#f59e0b' },
        itemStyle: { color: '#f59e0b' },
        data: ma,
      });
    }

    return {
      backgroundColor: 'transparent',
      animationDuration: 350,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: granularity === 'cumulative' ? 'line' : 'shadow' },
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [];
          if (list.length === 0) return '';
          const title = escapeHtml((list[0] as { axisValueLabel?: string }).axisValueLabel ?? '');
          const rows = list
            .filter((item) => Number((item as { value?: number }).value ?? 0) > 0)
            .map((item) => {
              const p = item as { seriesName: string; value: number; color: string };
              const fmt = escapeHtml(metric === 'cost' ? formatUsd(p.value) : formatTokens(p.value));
              const safeColor = sanitizeCssColor(p.color);
              return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin:2px 0;">
                <span style="display:inline-flex;align-items:center;gap:6px;color:${sanitizeCssColor(theme.textSecondary)};">
                  <span style="width:8px;height:8px;border-radius:2px;background:${safeColor};display:inline-block;"></span>
                  ${escapeHtml(p.seriesName)}
                </span>
                <span style="font-family:monospace;font-weight:600;color:${sanitizeCssColor(theme.textPrimary)};">${fmt}</span>
              </div>`;
            });
          return `<div style="font-weight:600;margin-bottom:6px;color:${sanitizeCssColor(theme.textPrimary)};">${title}</div>${rows.join('')}`;
        },
      },
      legend: {
        top: 0,
        right: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 8,
        textStyle: { color: theme.textSecondary, fontSize: 11 },
      },
      grid: {
        top: 34,
        left: 12,
        right: 16,
        bottom: enableZoom ? 48 : 16,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: theme.gridLine } },
        axisTick: { show: false },
        axisLabel: { color: theme.textMuted, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 11,
          formatter: (v: number) =>
            metric === 'cost' ? formatUsd(v, { compact: true }) : formatTokens(v),
        },
      },
      ...(enableZoom
        ? {
            dataZoom: [
              {
                type: 'inside',
                start: 0,
                end: 100,
              },
              {
                type: 'slider',
                height: 20,
                bottom: 6,
                borderColor: theme.borderSubtle,
                fillerColor: 'rgba(99, 102, 241, 0.16)',
                handleStyle: { color: '#6366f1' },
                textStyle: { color: theme.textMuted, fontSize: 10 },
                dataBackground: {
                  lineStyle: { color: theme.textMuted, opacity: 0.35 },
                  areaStyle: { color: '#6366f1', opacity: 0.1 },
                },
              },
            ],
          }
        : {}),
      series,
    };
  }, [seriesSource, granularity, metric, stackMode, topModelIds, pricing.models, showMovingAvg, theme]);

  // Build Cost Flow Sankey Diagram option
  const sankeyOption = useMemo<EChartsCoreOption>(() => {
    const labelByName = new Map(data.sankey.nodes.map((n) => [n.name, n.label]));
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as {
            dataType?: string;
            data?: { source?: string; target?: string; value?: number; name?: string; label?: string };
            value?: number;
          };
          if (p.dataType === 'edge' && p.data) {
            const src = escapeHtml(labelByName.get(p.data.source ?? '') ?? p.data.source);
            const tgt = escapeHtml(labelByName.get(p.data.target ?? '') ?? p.data.target);
            return `<div style="font-weight:600;margin-bottom:4px;">${src} → ${tgt}</div>
              <div style="font-family:monospace;color:#34d399;font-weight:600;">${escapeHtml(formatUsd(p.data.value ?? 0))}</div>`;
          }
          const lbl = escapeHtml(labelByName.get(p.data?.name ?? '') ?? p.data?.name ?? '');
          return `<div style="font-weight:600;margin-bottom:4px;">${lbl}</div>
            <div style="font-family:monospace;">${escapeHtml(formatUsd(p.value ?? 0))}</div>`;
        },
      },
      series: [
        {
          type: 'sankey',
          left: 14,
          right: 135,
          top: 12,
          bottom: 12,
          nodeWidth: 14,
          nodeGap: 12,
          draggable: false,
          emphasis: { focus: 'adjacency' },
          lineStyle: { color: 'gradient', curveness: 0.48, opacity: 0.35 },
          label: {
            color: theme.textPrimary,
            fontSize: 11,
            formatter: (p: { name: string }) => {
              const lbl = labelByName.get(p.name) ?? p.name;
              return lbl.length > 22 ? `${lbl.slice(0, 21)}…` : lbl;
            },
          },
          data: data.sankey.nodes.map((n) => ({
            name: n.name,
            itemStyle: { color: n.color ?? '#6366f1', borderColor: 'transparent' },
          })),
          links: data.sankey.links,
        },
      ],
    };
  }, [data.sankey, theme]);

  const topProjects = useMemo(() => {
    return [...data.projects]
      .sort((a, b) => {
        const costA = includeSubagents ? a.rolledUp.cost.totalCost : a.direct.cost.totalCost;
        const costB = includeSubagents ? b.rolledUp.cost.totalCost : b.direct.cost.totalCost;
        return costB - costA;
      })
      .slice(0, 6);
  }, [data.projects, includeSubagents]);

  const maxProjectCost = useMemo(() => {
    return Math.max(
      ...topProjects.map((p) =>
        includeSubagents ? p.rolledUp.cost.totalCost : p.direct.cost.totalCost,
      ),
      0.0001,
    );
  }, [topProjects, includeSubagents]);

  const topConversations = useMemo(() => {
    return [...data.conversations]
      .filter((c) => includeSubagents || !c.parentConversationId)
      .sort((a, b) => {
        const costA = includeSubagents ? a.rolledUp.cost.totalCost : a.direct.cost.totalCost;
        const costB = includeSubagents ? b.rolledUp.cost.totalCost : b.direct.cost.totalCost;
        return costB - costA;
      })
      .slice(0, 8);
  }, [data.conversations, includeSubagents]);

  return (
    <div className="space-y-5">
      {/* 6 Hero KPI Cards */}
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          title="Estimated API Spend"
          value={formatUsd(kpis.cost.totalCost)}
          accentColor="var(--accent-cost)"
          icon={<Coins className="h-4 w-4" />}
          badge={
            <span className="mono-num rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
              {formatUsd(kpis.projectedMonthlyCost, { compact: true })}/30d
            </span>
          }
          subtitle={
            <span className="flex items-center justify-between gap-2">
              <span>
                Burn rate:{' '}
                <span className="mono-num text-[var(--text-primary)]">
                  {formatUsd(kpis.dailyBurnRate)}/day
                </span>
              </span>
              <span className="mono-num text-[var(--text-muted)]">
                No cache: {formatUsd(kpis.cost.costWithoutCache)}
              </span>
            </span>
          }
        />

        <KpiCard
          title="Cache Savings"
          value={formatUsd(kpis.cost.cacheSavings)}
          accentColor="var(--accent-savings)"
          icon={<Sparkles className="h-4 w-4" />}
          badge={
            <span className="mono-num rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[11px] font-medium text-emerald-400">
              {formatPercent(kpis.tokens.cacheHitRatio)} hit
            </span>
          }
          subtitle={
            <span className="flex items-center justify-between gap-2">
              <span>
                Reduced bill by{' '}
                <span className="mono-num text-emerald-400 font-medium">
                  {formatPercent(kpis.cacheSavingsPercent)}
                </span>
              </span>
              <span className="mono-num text-[var(--text-muted)]">
                {formatTokens(kpis.tokens.cacheRead)} cached
              </span>
            </span>
          }
        />

        <KpiCard
          title="Total Tokens"
          value={formatTokens(kpis.tokens.totalTokens)}
          accentColor="var(--accent-uncached)"
          icon={<Layers className="h-4 w-4" />}
          badge={
            <span className="mono-num text-[11px] text-[var(--text-muted)]">
              {formatTokens(kpis.avgTokensPerTurn)}/turn
            </span>
          }
          footer={
            <div className="space-y-1.5">
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                <div
                  style={{ width: `${uncachedPct}%`, backgroundColor: 'var(--accent-uncached)' }}
                  title={`Uncached Input: ${formatTokens(kpis.tokens.uncachedInput)}`}
                />
                <div
                  style={{ width: `${cachePct}%`, backgroundColor: 'var(--accent-cache)' }}
                  title={`Cache Read: ${formatTokens(kpis.tokens.cacheRead)}`}
                />
                <div
                  style={{ width: `${outputPct}%`, backgroundColor: 'var(--accent-output)' }}
                  title={`Output: ${formatTokens(kpis.tokens.output)}`}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-uncached)]" />
                  In <span className="mono-num text-[var(--text-secondary)]">{formatTokens(kpis.tokens.uncachedInput)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cache)]" />
                  Cache <span className="mono-num text-[var(--text-secondary)]">{formatTokens(kpis.tokens.cacheRead)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-output)]" />
                  Out <span className="mono-num text-[var(--text-secondary)]">{formatTokens(kpis.tokens.output)}</span>
                </span>
              </div>
            </div>
          }
        />

        <KpiCard
          title="Conversations"
          value={formatNumber(kpis.conversationCount)}
          accentColor="var(--accent-primary)"
          icon={<MessageSquareText className="h-4 w-4" />}
          badge={
            <span className="mono-num rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
              {formatNumber(kpis.totalSteps)} steps
            </span>
          }
          subtitle={
            <span className="flex items-center justify-between gap-2">
              <span>
                <span className="mono-num text-[var(--text-primary)]">{formatNumber(kpis.mainConversationCount)}</span> main ·{' '}
                <span className="mono-num text-[var(--text-primary)]">{formatNumber(kpis.subagentCount)}</span> subagents
              </span>
              <span className="mono-num text-[var(--text-muted)]">
                {formatNumber(kpis.transcriptCount)} logs
              </span>
            </span>
          }
        />

        <KpiCard
          title="Avg Cost / Chat"
          value={formatUsd(kpis.avgCostPerConversation)}
          accentColor="var(--accent-output)"
          icon={<TrendingUp className="h-4 w-4" />}
          badge={
            <span className="mono-num rounded-md bg-violet-500/12 px-1.5 py-0.5 text-[11px] font-medium text-violet-400">
              {formatUsd(kpis.avgCostPerPrompt)}/prompt
            </span>
          }
          subtitle={
            <span className="flex items-center justify-between gap-2">
              <span>
                <span className="mono-num text-[var(--text-primary)]">{formatNumber(kpis.userPrompts)}</span> user prompts
              </span>
              <span className="mono-num text-[var(--text-muted)]">
                {formatNumber(kpis.tokenBearingSteps)} billable turns
              </span>
            </span>
          }
        />

        <KpiCard
          title="Active Days & Streak"
          value={`${formatNumber(kpis.activeDays)} days`}
          accentColor="var(--accent-cache)"
          icon={<CalendarDays className="h-4 w-4" />}
          badge={
            <span className="mono-num rounded-md bg-indigo-500/12 px-1.5 py-0.5 text-[11px] font-medium text-indigo-400">
              {kpis.currentStreakDays}d streak
            </span>
          }
          subtitle={
            <span className="flex items-center justify-between gap-2">
              <span>
                Longest streak:{' '}
                <span className="mono-num text-[var(--text-primary)]">{kpis.longestStreakDays} days</span>
              </span>
              <span className="mono-num text-[var(--text-muted)]">
                {data.projects.length} projects
              </span>
            </span>
          }
        />
      </section>

      {/* V2 Intelligence Strip (ROI, Active Time, Cache Miss Waste, Error Burn) */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => onNavigateTab('models')}
          className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-400">
              <Zap className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--text-muted)]">
                Subscription ROI ({formatUsd(subscriptionRoi.monthlyPriceUsd)}/mo)
              </div>
              <div className="mono-num text-sm font-semibold text-emerald-400">
                {formatMultiplier(subscriptionRoi.roiMultiplier)} value
              </div>
            </div>
          </div>
          <span className="mono-num text-[11px] text-[var(--text-secondary)]">
            {subscriptionRoi.monthlyNetSavingsUsd >= 0 ? '+' : ''}
            {formatUsd(subscriptionRoi.monthlyNetSavingsUsd, { compact: true })}/mo
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('efficiency')}
          className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/12 text-sky-400">
              <Clock className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--text-muted)]">Active Agent Time</div>
              <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                {formatDuration(efficiency.totalActiveMs)}
              </div>
            </div>
          </div>
          <span className="mono-num text-[11px] text-[var(--text-secondary)]">
            {formatUsd(efficiency.costPerActiveHour)}/hr
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('efficiency')}
          className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-400">
              <Flame className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--text-muted)]">Cache-Miss Waste</div>
              <div className="mono-num text-sm font-semibold text-amber-400">
                {formatUsd(efficiency.cacheMissWastedCost)}
              </div>
            </div>
          </div>
          <span className="mono-num text-[11px] text-[var(--text-secondary)]">
            {formatNumber(efficiency.cacheMissSpikes)} spikes
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('efficiency')}
          className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/12 text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--text-muted)]">Error & Retry Burn</div>
              <div className="mono-num text-sm font-semibold text-rose-400">
                {formatUsd(efficiency.errorCost)}
              </div>
            </div>
          </div>
          <span className="mono-num text-[11px] text-[var(--text-secondary)]">
            {formatNumber(efficiency.totalErrors)} errors
          </span>
        </button>
      </section>

      {/* V3 Scale, Coding Persona, Records & Efficiency Grade Spotlight */}
      <section className="surface-card rounded-xl p-3.5 sm:p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-elevated)]/65 px-3 py-2 border border-[var(--border-subtle)]">
            <BookOpen className="h-4 w-4 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--text-muted)]">Books Read (Context)</div>
              <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                {funInsights.booksRead >= 10
                  ? formatNumber(funInsights.booksRead)
                  : funInsights.booksRead.toFixed(1)}
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                {funInsights.novelsWritten.toFixed(1)} novels written
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-elevated)]/65 px-3 py-2 border border-[var(--border-subtle)]">
            <Code2 className="h-4 w-4 text-violet-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--text-muted)]">Est. Code Authored</div>
              <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                {formatTokens(funInsights.estimatedLinesOfCode)} LOC
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">from output tokens</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-elevated)]/65 px-3 py-2 border border-[var(--border-subtle)]">
            <MoonStar className="h-4 w-4 text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--text-muted)]">Coding Persona</div>
              <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                {funInsights.codingPersona.title}
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                Peak {String(funInsights.codingPersona.peakHourUtc).padStart(2, '0')}:00 UTC
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-elevated)]/65 px-3 py-2 border border-[var(--border-subtle)]">
            <Trophy className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--text-muted)]">Peak Day Record</div>
              <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                {funInsights.peakDay ? formatUsd(funInsights.peakDay.cost) : '—'}
              </div>
              <div className="truncate text-[10px] text-[var(--text-muted)]">
                {funInsights.peakDay ? `${funInsights.peakDay.label} · ${formatTokens(funInsights.peakDay.tokens)}` : 'No data'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-elevated)]/65 px-3 py-2 border border-[var(--border-subtle)]">
            <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-[var(--text-muted)]">7-Day Velocity (WoW)</div>
              <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                {periodDeltas.hasPriorData && periodDeltas.spendDeltaPct !== null ? (
                  <span className={periodDeltas.spendDeltaPct >= 0 ? 'text-amber-400' : 'text-emerald-400'}>
                    {periodDeltas.spendDeltaPct >= 0 ? '+' : ''}
                    {(periodDeltas.spendDeltaPct * 100).toFixed(0)}%
                  </span>
                ) : (
                  formatUsd(periodDeltas.current7dCost)
                )}
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                {periodDeltas.hasPriorData
                  ? `${formatUsd(periodDeltas.current7dCost, { compact: true })} vs ${formatUsd(periodDeltas.previous7dCost, { compact: true })}`
                  : 'Last 7d spend'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('efficiency')}
            className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-elevated)]/65 px-3 py-2 border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors text-left cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Award className="h-4 w-4 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-[var(--text-muted)]">Efficiency Grade</div>
                <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                  {efficiency.efficiencyScore}/100
                </div>
              </div>
            </div>
            <span
              className={cn(
                'mono-num rounded-md border px-2 py-0.5 text-sm font-bold',
                getGradeBadgeClass(efficiency.efficiencyGrade),
              )}
            >
              {efficiency.efficiencyGrade}
            </span>
          </button>
        </div>
      </section>

      {/* Per-Reset Quick Snapshot Strip */}
      {resetSummary && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() =>
              onFilterToWindow(
                resetSummary.gem5h.startAt,
                resetSummary.gem5h.endAt,
                `5h Reset: ${resetSummary.gem5h.label}`,
              )
            }
            className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-sky-500/40 cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/12 text-sky-400">
                <Timer className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] text-[var(--text-muted)]">Current 5h Reset</div>
                <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                  {formatUsd(resetSummary.gem5h.combined.cost.totalCost)}
                </div>
              </div>
            </div>
            <div className="mono-num text-right text-[10px] text-[var(--text-secondary)]">
              <div>{formatTokens(resetSummary.gem5h.combined.tokens.totalTokens)}</div>
              <div className="text-[var(--text-muted)]">
                {formatNumber(resetSummary.gem5h.combined.tokenSteps)} turns
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              onFilterToWindow(
                resetSummary.gemWeek.startAt,
                resetSummary.gemWeek.endAt,
                `Weekly Reset: ${resetSummary.gemWeek.label}`,
              )
            }
            className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-indigo-500/40 cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/12 text-indigo-400">
                <CalendarDays className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] text-[var(--text-muted)]">Current Weekly Reset</div>
                <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                  {formatUsd(resetSummary.gemWeek.combined.cost.totalCost)}
                </div>
              </div>
            </div>
            <div className="mono-num text-right text-[10px] text-[var(--text-secondary)]">
              <div>{formatTokens(resetSummary.gemWeek.combined.tokens.totalTokens)}</div>
              <div className="text-[var(--text-muted)]">
                {formatNumber(resetSummary.gemWeek.combined.tokenSteps)} turns
              </div>
            </div>
          </button>

          {resetSummary.latestServerReset ? (
            <button
              type="button"
              onClick={() =>
                onFilterToWindow(
                  resetSummary.latestServerReset!.timestamp,
                  '',
                  `Since ⚡ ${formatDateTime(resetSummary.latestServerReset!.timestamp)} → Today`,
                )
              }
              className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-amber-500/40 cursor-pointer"
              title={`Filter all tabs since ${resetSummary.latestServerReset.label} until today`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-400">
                  <Zap className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] text-[var(--text-muted)]">Since Last Server Reset</div>
                  <div className="truncate text-xs font-semibold text-amber-300">
                    {formatDateTime(resetSummary.latestServerReset.timestamp)} → Today
                  </div>
                </div>
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-amber-300" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigateTab('resets')}
              className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-400">
                  <Zap className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] text-[var(--text-muted)]">Server Reset Cutlines</div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    Sync official resets
                  </div>
                </div>
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigateTab('resets')}
            className="surface-card group flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-400">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] text-[var(--text-muted)]">Avg Spend per Reset</div>
                <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                  {formatUsd(resetSummary.avg5hCost)}{' '}
                  <span className="text-[11px] font-normal text-[var(--text-muted)]">/ 5h</span>
                </div>
              </div>
            </div>
            <div className="mono-num text-right text-[10px] text-[var(--text-secondary)]">
              <div>{formatUsd(resetSummary.avgWeeklyCost, { compact: true })}/wk</div>
              <div className="text-[var(--accent-primary)]">Resets →</div>
            </div>
          </button>
        </section>
      )}

      {/* Main Interactive Apache ECharts Time-Series */}
      <section className="surface-card rounded-xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {granularity === 'cumulative'
                ? `Cumulative ${metric === 'cost' ? 'API Spend' : 'Token Volume'}`
                : granularity === 'reset5h'
                  ? `Per 5-Hour Reset ${metric === 'cost' ? 'API Spend' : 'Token Usage'}`
                  : granularity === 'resetWeekly'
                    ? `Per Weekly Reset ${metric === 'cost' ? 'API Spend' : 'Token Usage'}`
                    : `${granularity === 'daily' ? 'Daily' : 'Hourly'} ${metric === 'cost' ? 'API Spend' : 'Token Usage'}`}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {isResetGranularity
                ? 'Aggregated per quota reset window · ⚡ marks server-reset cycles · click any bar to filter all tabs to that reset'
                : granularity === 'cumulative'
                  ? 'Running total across the selected window (scroll or drag slider to zoom)'
                  : stackMode === 'model'
                    ? 'Stacked by model · scroll or drag slider to zoom'
                    : metric === 'cost'
                      ? 'Estimated API spend vs. cache savings · dashed amber line = moving average'
                      : 'Stacked by uncached input, cache read, and output tokens'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Granularity */}
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              {(
                [
                  { id: 'daily', label: 'Daily' },
                  { id: 'hourly', label: 'Hourly' },
                  { id: 'cumulative', label: 'Cumulative' },
                  { id: 'reset5h', label: '5h Resets' },
                  { id: 'resetWeekly', label: 'Weekly Resets' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setGranularity(opt.id)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                    granularity === opt.id
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Metric */}
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              {(
                [
                  { id: 'cost', label: 'Cost ($)' },
                  { id: 'tokens', label: 'Tokens' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMetric(opt.id)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                    metric === opt.id
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Stack Mode */}
            {granularity !== 'cumulative' && (
              <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
                {(
                  [
                    { id: 'tokenType', label: metric === 'cost' ? 'Cost & Savings' : 'Token Type' },
                    { id: 'model', label: 'By Model' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStackMode(opt.id)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                      stackMode === opt.id
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Moving Avg Toggle */}
            {granularity !== 'cumulative' && (
              <button
                type="button"
                onClick={() => setShowMovingAvg((v) => !v)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer',
                  showMovingAvg
                    ? 'bg-amber-500/12 border-amber-500/35 text-amber-400'
                    : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-muted)]',
                )}
              >
                Avg Line
              </button>
            )}
          </div>
        </div>

        {seriesSource.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
            No usage data matches the current filters.
          </div>
        ) : (
          <div className="h-[340px] w-full">
            <EChart
              key={`${granularity}-${stackMode}`}
              option={timeSeriesOption}
              onClick={(params) => {
                if (!isResetGranularity) return;
                const idx = (params as { dataIndex?: number })?.dataIndex;
                if (typeof idx !== 'number') return;
                const cycle = resetCycleSeries.cycles[idx];
                if (cycle) {
                  onFilterToWindow(
                    cycle.startAt,
                    cycle.endAt,
                    `${cycle.scope === '5h' ? '5h' : 'Week'}: ${cycle.label}`,
                  );
                }
              }}
            />
          </div>
        )}
      </section>

      {/* Cost Flow Sankey Diagram */}
      {data.sankey.links.length > 0 && (
        <section className="surface-card rounded-xl p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Cost Flow Sankey (Projects → Models → Cost Component)
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Hover any node or ribbon to trace exact USD spend from workspaces through models into uncached input, cache read, and output
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-[#38bdf8]" /> Uncached Input
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-[#34d399]" /> Cache Read
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-[#a78bfa]" /> Output
              </span>
            </div>
          </div>
          <div className="h-[310px] w-full">
            <EChart option={sankeyOption} />
          </div>
        </section>
      )}

      {/* Bottom 3-Column Analytics Grid */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Model Cost Breakdown */}
        <div className="surface-card flex flex-col rounded-xl p-4 xl:col-span-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Model Breakdown</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('models')}
              className="flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
            >
              Rates & ROI
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {data.models.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-10 text-xs text-[var(--text-muted)]">
              No model usage in this window.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                {data.models.map((m) => (
                  <div
                    key={`${m.modelId}-${m.isFallback}`}
                    style={{
                      width: `${Math.max(m.costShare * 100, m.cost.totalCost > 0 ? 1.5 : 0)}%`,
                      backgroundColor: m.color,
                    }}
                    title={`${m.label}: ${formatUsd(m.cost.totalCost)} (${formatPercent(m.costShare)})`}
                  />
                ))}
              </div>

              <div className="space-y-2.5">
                {data.models.slice(0, 7).map((m) => (
                  <div
                    key={`${m.modelId}-${m.isFallback}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-xs"
                        style={{ backgroundColor: m.color }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-[var(--text-primary)]">
                            {m.label}
                          </span>
                          {m.isFallback && (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.2 text-[9px] font-medium text-amber-400">
                              est
                            </span>
                          )}
                        </div>
                        <div className="mono-num text-[11px] text-[var(--text-muted)]">
                          {formatTokens(m.tokens.totalTokens)} · {formatPercent(m.tokens.cacheHitRatio)} cache
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="mono-num font-medium text-[var(--text-primary)]">
                        {formatUsd(m.cost.totalCost)}
                      </div>
                      <div className="mono-num text-[11px] text-[var(--text-muted)]">
                        {formatPercent(m.costShare)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Top Projects Leaderboard */}
        <div className="surface-card flex flex-col rounded-xl p-4 xl:col-span-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top Projects</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('projects')}
              className="flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
            >
              Treemap
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {topProjects.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-10 text-xs text-[var(--text-muted)]">
              No projects match current filters.
            </div>
          ) : (
            <div className="space-y-2.5">
              {topProjects.map((project) => {
                const bundle = includeSubagents ? project.rolledUp : project.direct;
                const widthPct = Math.max((bundle.cost.totalCost / maxProjectCost) * 100, 2);
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onSelectProject(project.id)}
                    className="group block w-full rounded-lg p-2 -mx-2 text-left transition-colors hover:bg-[var(--bg-hover)]/70 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
                        {project.displayName}
                      </span>
                      <span className="mono-num shrink-0 font-medium text-[var(--text-primary)]">
                        {formatUsd(bundle.cost.totalCost)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent-primary)] transition-all"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <span className="mono-num text-[11px] text-[var(--text-muted)] shrink-0">
                        {formatTokens(bundle.tokens.totalTokens)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                      <span>
                        {project.conversationCount} chats
                        {project.subagentCount > 0 ? ` · ${project.subagentCount} sub` : ''}
                      </span>
                      <span className="mono-num">
                        {formatPercent(bundle.tokens.cacheHitRatio)} cache · {formatDuration(project.activeDurationMs)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Most Expensive Conversations */}
        <div className="surface-card flex flex-col rounded-xl p-4 xl:col-span-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Top Spend Conversations
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('conversations')}
              className="flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
            >
              Inspect all
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {topConversations.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-10 text-xs text-[var(--text-muted)]">
              No conversations in this window.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {topConversations.map((conv) => {
                const bundle = includeSubagents ? conv.rolledUp : conv.direct;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => onSelectConversation(conv.id)}
                    className="group flex w-full items-center justify-between gap-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]/50 px-1.5 -mx-1.5 rounded-md cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
                          {conv.title || 'Untitled Conversation'}
                        </span>
                        {conv.agentName && (
                          <span className="shrink-0 rounded bg-indigo-500/12 px-1 py-0.5 text-[10px] font-medium text-indigo-400">
                            {conv.agentName}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                        <span className="truncate max-w-[130px]">{conv.projectDisplayName}</span>
                        <span>·</span>
                        <span className="mono-num">{formatTokens(bundle.tokens.totalTokens)}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(conv.lastStepAt ?? conv.lastModifiedTime)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="mono-num text-xs font-semibold text-[var(--text-primary)]">
                        {formatUsd(bundle.cost.totalCost)}
                      </div>
                      {conv.subagentCount > 0 && includeSubagents && (
                        <div className="mono-num text-[10px] text-[var(--text-muted)]">
                          +{conv.subagentCount} sub
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
