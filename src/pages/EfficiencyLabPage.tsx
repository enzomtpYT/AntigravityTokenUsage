import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from '../components/EChart';
import {
  AlertTriangle,
  Award,
  Brain,
  Calendar,
  Clock,
  Flame,
  Gauge,
  GitMerge,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { EChart, useChartTheme } from '../components/EChart';
import type { DashboardPayload } from '../shared/types';
import {
  cn,
  formatDuration,
  formatLatency,
  formatModelLabel,
  formatNumber,
  formatPercent,
  formatTokens,
  formatUsd,
  getGradeBadgeClass,
} from '../utils/format';
import { escapeHtml, sanitizeCssColor } from '../utils/sanitize';

export interface EfficiencyLabPageProps {
  data: DashboardPayload;
  onSelectConversation: (id: string) => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function EfficiencyLabPage({ data, onSelectConversation }: EfficiencyLabPageProps) {
  const {
    efficiency,
    pricing,
    calendarHeatmap,
    hourDayHeatmap,
    scatterTurns,
    tools,
    toolChains,
    expensiveTurns,
  } = data;
  const [scatterY, setScatterY] = useState<'cost' | 'output'>('cost');
  const [calendarMetric, setCalendarMetric] = useState<'cost' | 'tokens'>('cost');
  const [matrixMetric, setMatrixMetric] = useState<'steps' | 'cost' | 'tokens'>('cost');
  const theme = useChartTheme();

  // 1. Apache ECharts Context Size vs. Turn Cost / Output Scatter Plot
  const scatterOption = useMemo<EChartsCoreOption>(() => {
    const normalPts: unknown[] = [];
    const spikePts: unknown[] = [];
    const longCtxPts: unknown[] = [];
    const errorPts: unknown[] = [];

    for (const pt of scatterTurns) {
      const yVal = scatterY === 'cost' ? pt.cost : pt.outputTokens;
      const item = {
        value: [pt.totalContext, yVal, pt.cost, pt.outputTokens],
        turn: pt,
      };
      if (pt.hasError) errorPts.push(item);
      else if (pt.isCacheMissSpike) spikePts.push(item);
      else if (pt.isLongContext) longCtxPts.push(item);
      else normalPts.push(item);
    }

    const threshold = pricing.longContextThreshold || 200_000;
    const maxCtx = Math.max(...scatterTurns.map((t) => t.totalContext), 0);

    const symbolSize = (val: number[]) => {
      const cost = val[2] ?? 0;
      return Math.max(6, Math.min(24, 6 + Math.sqrt(cost) * 20));
    };

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { data?: { turn?: (typeof scatterTurns)[number] } };
          const t = p.data?.turn;
          if (!t) return '';
          const safeMuted = sanitizeCssColor(theme.textMuted);
          const safeSecondary = sanitizeCssColor(theme.textSecondary);
          return `<div style="max-width:290px;">
            <div style="font-weight:600;margin-bottom:3px;word-break:break-word;">${escapeHtml(t.conversationTitle || 'Untitled')} <span style="color:${safeMuted};">#${escapeHtml(t.stepIndex)}</span></div>
            <div style="font-size:11px;color:${safeSecondary};margin-bottom:5px;">${escapeHtml(t.projectDisplayName)} · ${escapeHtml(formatModelLabel(t.model, pricing.models))}</div>
            <div style="font-family:monospace;font-size:11px;display:grid;gap:2px;">
              <div>Context: <b>${escapeHtml(formatTokens(t.totalContext))}</b> (${escapeHtml(formatPercent(t.cacheHitRatio))} cache)</div>
              <div>Uncached: <span style="color:#38bdf8;">${escapeHtml(formatTokens(t.uncachedInput))}</span> · Output: <span style="color:#a78bfa;">${escapeHtml(formatTokens(t.outputTokens))}</span></div>
              <div>Turn Cost: <b style="color:#34d399;">${escapeHtml(formatUsd(t.cost, { decimals: 4 }))}</b>${t.latencyMs ? ` · Lat: ${escapeHtml(formatLatency(t.latencyMs))}` : ''}</div>
              ${t.isCacheMissSpike ? `<div style="color:#f59e0b;font-weight:600;">⚡ Cache-Miss Spike</div>` : ''}
              ${t.hasError ? `<div style="color:#f43f5e;font-weight:600;">⚠ Error Step</div>` : ''}
            </div>
            <div style="margin-top:5px;font-size:10px;color:${safeMuted};">Click dot to open Conversation Inspector</div>
          </div>`;
        },
      },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: theme.textSecondary, fontSize: 11 },
      },
      grid: { top: 32, left: 12, right: 24, bottom: 38, containLabel: true },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0 },
        { type: 'inside', yAxisIndex: 0 },
      ],
      xAxis: {
        type: 'value',
        name: 'Context Size (tokens)',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: theme.textMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 11,
          formatter: (v: number) => formatTokens(v),
        },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 11,
          formatter: (v: number) =>
            scatterY === 'cost' ? formatUsd(v, { compact: true }) : formatTokens(v),
        },
      },
      series: [
        {
          name: 'Normal Turn',
          type: 'scatter',
          symbolSize,
          itemStyle: { color: 'rgba(99, 102, 241, 0.55)', borderColor: '#818cf8', borderWidth: 1 },
          data: normalPts,
          markLine:
            maxCtx > threshold * 0.6
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: '#f472b6', type: 'dashed', width: 1.5 },
                  label: {
                    formatter: `${formatTokens(threshold)} long-ctx`,
                    color: '#f472b6',
                    fontSize: 10,
                    position: 'insideEndTop',
                  },
                  data: [{ xAxis: threshold }],
                }
              : undefined,
        },
        {
          name: `>${formatTokens(threshold)} Context`,
          type: 'scatter',
          symbolSize,
          itemStyle: { color: 'rgba(244, 114, 182, 0.72)', borderColor: '#f472b6', borderWidth: 1 },
          data: longCtxPts,
        },
        {
          name: 'Cache Miss Spike',
          type: 'scatter',
          symbol: 'diamond',
          symbolSize: (val: number[]) => Math.max(9, symbolSize(val)),
          itemStyle: { color: '#f59e0b', borderColor: '#ffffff', borderWidth: 1 },
          data: spikePts,
        },
        {
          name: 'Error Step',
          type: 'scatter',
          symbol: 'triangle',
          symbolSize: (val: number[]) => Math.max(9, symbolSize(val)),
          itemStyle: { color: '#f43f5e', borderColor: '#ffffff', borderWidth: 1 },
          data: errorPts,
        },
      ],
    };
  }, [scatterTurns, scatterY, pricing, theme]);

  // 2. ECharts Daily Activity Calendar Heatmap
  const calendarOption = useMemo<EChartsCoreOption>(() => {
    if (calendarHeatmap.length === 0) return {};
    const sorted = [...calendarHeatmap].sort((a, b) => a.date.localeCompare(b.date));
    const endDate = sorted[sorted.length - 1].date;
    const endDt = new Date(`${endDate}T00:00:00Z`);
    const startDt = new Date(endDt.getTime() - 120 * 86_400_000);
    const earliestDt = new Date(`${sorted[0].date}T00:00:00Z`);
    const rangeStart = (earliestDt < startDt ? earliestDt : startDt).toISOString().slice(0, 10);

    const seriesData = sorted.map((d) => [
      d.date,
      calendarMetric === 'cost' ? Number(d.totalCost.toFixed(4)) : d.totalTokens,
      d.steps,
      d.conversations,
      d.totalCost,
      d.totalTokens,
    ]);
    const maxVal = Math.max(...seriesData.map((r) => Number(r[1])), 0.01);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { value?: [string, number, number, number, number, number] };
          const v = p.value;
          if (!v) return '';
          return `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(v[0])}</div>
            <div style="font-family:monospace;font-size:11px;">Spend: <b style="color:#34d399;">${escapeHtml(formatUsd(v[4]))}</b> · Tokens: ${escapeHtml(formatTokens(v[5]))}</div>
            <div style="font-family:monospace;font-size:11px;color:${sanitizeCssColor(theme.textSecondary)};">${escapeHtml(formatNumber(v[2]))} steps · ${escapeHtml(formatNumber(v[3]))} chats</div>`;
        },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        show: true,
        orient: 'horizontal',
        left: 'right',
        bottom: 0,
        itemWidth: 12,
        itemHeight: 80,
        textStyle: { color: theme.textMuted, fontSize: 10 },
        formatter: (v: number) =>
          calendarMetric === 'cost' ? formatUsd(v, { compact: true }) : formatTokens(v),
        inRange: {
          color: theme.isLight
            ? ['#e4e4e7', '#a7f3d0', '#34d399', '#10b981', '#047857']
            : ['#18181f', '#064e3b', '#059669', '#10b981', '#34d399'],
        },
      },
      calendar: {
        top: 26,
        left: 34,
        right: 16,
        bottom: 34,
        range: [rangeStart, endDate],
        cellSize: ['auto', 16],
        splitLine: { show: true, lineStyle: { color: theme.borderSubtle, width: 1 } },
        itemStyle: {
          color: theme.isLight ? '#f4f4f5' : '#14141a',
          borderColor: theme.bgSurface,
          borderWidth: 2,
        },
        dayLabel: { color: theme.textMuted, fontSize: 10, firstDay: 1 },
        monthLabel: { color: theme.textSecondary, fontSize: 11 },
        yearLabel: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: seriesData,
        },
      ],
    };
  }, [calendarHeatmap, calendarMetric, theme]);

  // 3. ECharts 7x24 Day-of-Week x Hour-of-Day Matrix
  const hourDayOption = useMemo<EChartsCoreOption>(() => {
    const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`);
    const cells = hourDayHeatmap.map((c) => {
      const val =
        matrixMetric === 'cost'
          ? Number(c.totalCost.toFixed(4))
          : matrixMetric === 'tokens'
            ? c.totalTokens
            : c.steps;
      return [c.hour, c.dayOfWeek, val, c.steps, c.totalCost, c.totalTokens];
    });
    const maxVal = Math.max(...cells.map((c) => Number(c[2])), 1);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { value?: [number, number, number, number, number, number] };
          const v = p.value;
          if (!v) return '';
          return `<div style="font-weight:600;margin-bottom:3px;">${escapeHtml(DAY_LABELS[v[1]])} ${String(v[0]).padStart(2, '0')}:00 UTC</div>
            <div style="font-family:monospace;font-size:11px;">Spend: <b>${escapeHtml(formatUsd(v[4]))}</b> · Tokens: ${escapeHtml(formatTokens(v[5]))}</div>
            <div style="font-family:monospace;font-size:11px;color:${sanitizeCssColor(theme.textSecondary)};">${escapeHtml(formatNumber(v[3]))} steps</div>`;
        },
      },
      grid: { top: 8, left: 38, right: 12, bottom: 26 },
      xAxis: {
        type: 'category',
        data: hours,
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textMuted, fontSize: 10, interval: 1 },
      },
      yAxis: {
        type: 'category',
        data: DAY_LABELS,
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 11 },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        show: false,
        inRange: {
          color: theme.isLight
            ? ['#f4f4f5', '#c7d2fe', '#818cf8', '#6366f1', '#4338ca']
            : ['#14141a', '#1e1b4b', '#3730a3', '#6366f1', '#818cf8'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data: cells,
          itemStyle: {
            borderRadius: 3,
            borderColor: theme.bgSurface,
            borderWidth: 2,
          },
          emphasis: {
            itemStyle: { borderColor: '#ffffff', borderWidth: 1.5 },
          },
        },
      ],
    };
  }, [hourDayHeatmap, matrixMetric, theme]);

  // 4. ECharts Top Tools Horizontal Bar
  const toolsOption = useMemo<EChartsCoreOption>(() => {
    const top = tools.slice(0, 12).reverse();
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
          const t = top[(arr[0] as { dataIndex: number }).dataIndex];
          if (!t) return '';
          return `<div style="font-weight:600;font-family:monospace;margin-bottom:3px;">${escapeHtml(t.name)}</div>
            <div style="font-family:monospace;font-size:11px;">Calls: <b>${escapeHtml(formatNumber(t.calls))}</b> · Chats: ${escapeHtml(t.conversationCount)}</div>
            ${t.errorCount > 0 ? `<div style="font-family:monospace;font-size:11px;color:#f43f5e;">Errors: ${escapeHtml(t.errorCount)}</div>` : ''}`;
        },
      },
      grid: { top: 8, left: 10, right: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: { color: theme.textMuted, fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        data: top.map((t) => t.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 11, fontFamily: 'monospace' },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          data: top.map((t) => ({
            value: t.calls,
            itemStyle: { color: '#38bdf8', borderRadius: [0, 4, 4, 0] },
          })),
        },
      ],
    };
  }, [tools, theme]);

  // 5. ECharts Tool Chain Workflows (Bigrams)
  const toolChainsOption = useMemo<EChartsCoreOption>(() => {
    const top = toolChains.slice(0, 10).reverse();
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
          const c = top[(arr[0] as { dataIndex: number }).dataIndex];
          if (!c) return '';
          return `<div style="font-weight:600;font-family:monospace;margin-bottom:3px;">${escapeHtml(c.from)} → ${escapeHtml(c.to)}</div>
            <div style="font-family:monospace;font-size:11px;">Occurrences: <b>${escapeHtml(formatNumber(c.count))}</b></div>`;
        },
      },
      grid: { top: 8, left: 10, right: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: { color: theme.textMuted, fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        data: top.map((c) => `${c.from} → ${c.to}`),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 10, fontFamily: 'monospace' },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          data: top.map((c) => ({
            value: c.count,
            itemStyle: { color: '#a78bfa', borderRadius: [0, 4, 4, 0] },
          })),
        },
      ],
    };
  }, [toolChains, theme]);

  return (
    <div className="space-y-5">
      {/* Efficiency Score + Actionable Optimization Tips */}
      <section className="surface-card rounded-xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={cn(
                'mono-num flex h-12 w-12 items-center justify-center rounded-xl border text-2xl font-bold',
                getGradeBadgeClass(efficiency.efficiencyGrade),
              )}
            >
              {efficiency.efficiencyGrade}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Workspace Efficiency Score:{' '}
                  <span className="mono-num">{efficiency.efficiencyScore}/100</span>
                </h2>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Composite of prompt cache hit rate (45%), low cache-miss spikes (20%), low error rate (20%), and output leverage (15%)
              </p>
            </div>
          </div>

          {efficiency.optimizationTips.length > 0 && (
            <div className="flex-1 min-w-[280px] space-y-1.5">
              {efficiency.optimizationTips.map((tip, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg bg-[var(--bg-elevated)]/70 px-3 py-1.5 text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                >
                  <Lightbulb className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 3 V2 Diagnostic Pillars */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Pillar 1: Cache Miss & Context Bloat Detector */}
        <div className="surface-card rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
                <Flame className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Cache-Miss & Bloat Detector
              </h3>
            </div>
            <span className="mono-num rounded bg-amber-500/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
              {formatNumber(efficiency.cacheMissSpikes)} spikes
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg bg-[var(--bg-elevated)] p-2.5 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Wasted on Cache Misses</div>
              <div className="mono-num mt-0.5 text-base font-bold text-amber-400">
                {formatUsd(efficiency.cacheMissWastedCost)}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] p-2.5 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">
                &gt;{formatTokens(pricing.longContextThreshold)} Turns
              </div>
              <div className="mono-num mt-0.5 text-base font-bold text-pink-400">
                {formatNumber(efficiency.longContextSteps)}
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                {formatUsd(efficiency.longContextSurcharge)} tier impact
              </div>
            </div>
          </div>
        </div>

        {/* Pillar 2: Active Time, Pacing & Latency */}
        <div className="surface-card rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
                <Clock className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Active Time & Latency
              </h3>
            </div>
            <span className="mono-num rounded bg-sky-500/12 px-1.5 py-0.5 text-[11px] font-medium text-sky-400">
              {formatUsd(efficiency.costPerActiveHour)}/hr
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-[var(--bg-elevated)] p-2.5 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Active Time</div>
              <div className="mono-num mt-0.5 text-sm font-bold text-[var(--text-primary)]">
                {formatDuration(efficiency.totalActiveMs)}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] p-2.5 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Median / P95</div>
              <div className="mono-num mt-0.5 text-sm font-bold text-sky-400">
                {formatLatency(efficiency.medianLatencyMs)}
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                p95 {formatLatency(efficiency.p95LatencyMs)}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] p-2.5 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Throughput</div>
              <div className="mono-num mt-0.5 text-sm font-bold text-emerald-400">
                {efficiency.avgOutputTokensPerSec.toFixed(1)}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">out tok/s</div>
            </div>
          </div>
        </div>

        {/* Pillar 3: Error & Retry Cost Tracker */}
        <div className="surface-card rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Error & Retry Cost Tracker
              </h3>
            </div>
            <span className="mono-num rounded bg-rose-500/12 px-1.5 py-0.5 text-[11px] font-medium text-rose-400">
              {formatPercent(efficiency.errorRate)} rate
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg bg-[var(--bg-elevated)] p-2.5 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Estimated Error Burn</div>
              <div className="mono-num mt-0.5 text-base font-bold text-rose-400">
                {formatUsd(efficiency.errorCost)}
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                {formatTokens(efficiency.errorTokens)} tok
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] p-2.5 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Top Error Project</div>
              <div className="mt-0.5 truncate text-xs font-semibold text-[var(--text-primary)]">
                {efficiency.errorCostByProject[0]?.displayName ?? 'None'}
              </div>
              <div className="mono-num text-[10px] text-rose-400">
                {efficiency.errorCostByProject[0]
                  ? `${efficiency.errorCostByProject[0].errors} err · ${formatUsd(efficiency.errorCostByProject[0].errorCost)}`
                  : 'Clean'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Secondary Leverage KPI Row */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="surface-card rounded-xl px-3.5 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Thinking / Output Ratio</div>
            <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
              {efficiency.thinkingToOutputRatio.toFixed(2)}×
            </div>
          </div>
          <Brain className="h-4 w-4 text-violet-400" />
        </div>
        <div className="surface-card rounded-xl px-3.5 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Output / User Prompt</div>
            <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
              {formatTokens(efficiency.promptToOutputLeverage)}
            </div>
          </div>
          <Sparkles className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="surface-card rounded-xl px-3.5 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Tool Calls / Chat</div>
            <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
              {efficiency.toolCallsPerConversation.toFixed(1)}
            </div>
          </div>
          <Wrench className="h-4 w-4 text-sky-400" />
        </div>
        <div className="surface-card rounded-xl px-3.5 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Multimodal / Media Steps</div>
            <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
              {formatNumber(efficiency.mediaSteps)}
            </div>
          </div>
          <ImageIcon className="h-4 w-4 text-amber-400" />
        </div>
      </section>

      {/* Context Size vs Turn Cost / Output Scatter Plot */}
      <section className="surface-card rounded-xl p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Context Size vs. {scatterY === 'cost' ? 'Turn Cost ($)' : 'Output Tokens'} Scatter Plot
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Each dot is an LLM turn (bubble size = cost) · scroll to zoom · click any outlier dot to jump into its Conversation Inspector
            </p>
          </div>
          <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setScatterY('cost')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                scatterY === 'cost'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
              )}
            >
              Y: Cost ($)
            </button>
            <button
              type="button"
              onClick={() => setScatterY('output')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                scatterY === 'output'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
              )}
            >
              Y: Output Tokens
            </button>
          </div>
        </div>

        {scatterTurns.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
            No billable turns match current filters.
          </div>
        ) : (
          <div className="h-[340px] w-full">
            <EChart
              option={scatterOption}
              onClick={(params) => {
                const p = params as { data?: { turn?: { conversationId?: string } } };
                if (p?.data?.turn?.conversationId) {
                  onSelectConversation(p.data.turn.conversationId);
                }
              }}
            />
          </div>
        )}
      </section>

      {/* Heatmaps Grid: Daily Calendar + 7x24 Hour x Day */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="surface-card rounded-xl p-4 sm:p-5 xl:col-span-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Daily Activity Calendar Heatmap
              </h3>
            </div>
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setCalendarMetric('cost')}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer',
                  calendarMetric === 'cost'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] border border-transparent',
                )}
              >
                Cost
              </button>
              <button
                type="button"
                onClick={() => setCalendarMetric('tokens')}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer',
                  calendarMetric === 'tokens'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] border border-transparent',
                )}
              >
                Tokens
              </button>
            </div>
          </div>
          {calendarHeatmap.length === 0 ? (
            <div className="flex h-[210px] items-center justify-center text-xs text-[var(--text-muted)]">
              No daily activity recorded.
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <EChart option={calendarOption} />
            </div>
          )}
        </div>

        <div className="surface-card rounded-xl p-4 sm:p-5 xl:col-span-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Peak Activity Matrix (Day × Hour UTC)
              </h3>
            </div>
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              {(['cost', 'tokens', 'steps'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMatrixMetric(m)}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[11px] font-medium capitalize cursor-pointer',
                    matrixMetric === m
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                      : 'text-[var(--text-secondary)] border border-transparent',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[220px] w-full">
            <EChart option={hourDayOption} />
          </div>
        </div>
      </section>

      {/* Top Tools + Error Cost by Project */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="surface-card rounded-xl p-4 sm:p-5 xl:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Top Tool Invocations ({formatNumber(efficiency.totalToolCalls)} total)
              </h3>
            </div>
            <span className="mono-num text-xs text-[var(--text-muted)]">
              {efficiency.toolCallsPerTurn.toFixed(2)} calls/turn
            </span>
          </div>
          {tools.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-xs text-[var(--text-muted)]">
              No tool calls recorded.
            </div>
          ) : (
            <div className="h-[290px] w-full">
              <EChart option={toolsOption} />
            </div>
          )}
        </div>

        <div className="surface-card rounded-xl p-4 sm:p-5 xl:col-span-5 flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Error Burn by Project
              </h3>
            </div>
            <span className="mono-num text-xs text-rose-400 font-medium">
              {formatUsd(efficiency.errorCost)}
            </span>
          </div>
          {efficiency.errorCostByProject.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-[var(--text-muted)]">
              Zero error steps recorded in this window.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {efficiency.errorCostByProject.map((p) => (
                <div key={p.projectId} className="flex items-center justify-between py-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--text-primary)]">
                      {p.displayName}
                    </div>
                    <div className="mono-num text-[11px] text-[var(--text-muted)]">
                      {p.errors} errors · {formatTokens(p.errorTokens)} tok
                    </div>
                  </div>
                  <span className="mono-num font-semibold text-rose-400 shrink-0">
                    {formatUsd(p.errorCost)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Top Tool Chain Workflows (Bigrams) */}
      {toolChains.length > 0 && (
        <section className="surface-card rounded-xl p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitMerge className="h-4 w-4 text-violet-400" />
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Top Agent Tool-Chain Workflows (Consecutive Bigrams)
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Most frequent two-step tool sequences executed across your conversations
                </p>
              </div>
            </div>
            <span className="mono-num text-xs text-[var(--text-muted)]">
              Top {toolChains.length} pipelines
            </span>
          </div>
          <div className="h-[265px] w-full">
            <EChart option={toolChainsOption} />
          </div>
        </section>
      )}

      {/* Top 25 Most Expensive Turns (Outliers) */}
      <section className="surface-card overflow-hidden rounded-xl">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Top 25 Most Expensive Turns (Outliers)
            </h3>
          </div>
          <span className="text-xs text-[var(--text-muted)]">Click any row to inspect</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 text-[11px] font-medium text-[var(--text-muted)]">
                <th className="px-4 py-2.5">Conversation / Step</th>
                <th className="px-3 py-2.5">Model</th>
                <th className="px-3 py-2.5 text-right">Uncached</th>
                <th className="px-3 py-2.5 text-right">Cache Read</th>
                <th className="px-3 py-2.5 text-right">Output</th>
                <th className="px-3 py-2.5 text-right">Latency</th>
                <th className="px-3 py-2.5">Flags</th>
                <th className="px-4 py-2.5 text-right">Turn Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {expensiveTurns.map((t, idx) => (
                <tr
                  key={`${t.conversationId}-${t.stepIndex}-${idx}`}
                  onClick={() => onSelectConversation(t.conversationId)}
                  className="hover:bg-[var(--bg-hover)]/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-[var(--text-primary)] truncate max-w-[260px]">
                      {t.conversationTitle || 'Untitled'}{' '}
                      <span className="mono-num text-[var(--text-muted)]">#{t.stepIndex}</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {t.projectDisplayName}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
                    {t.isFallbackModel
                      ? `Untagged (est. ${formatModelLabel(t.model, pricing.models)})`
                      : formatModelLabel(t.model, pricing.models)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-sky-400">
                    {formatTokens(t.inputTokens)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-emerald-400">
                    {formatTokens(t.cacheReadTokens)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-violet-400">
                    {formatTokens(t.outputTokens)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-[var(--text-secondary)]">
                    {formatLatency(t.latencyMs)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {t.isCacheMissSpike && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                          ⚡ Spike
                        </span>
                      )}
                      {t.isLongContext && (
                        <span className="rounded bg-pink-500/15 px-1.5 py-0.5 text-[10px] font-medium text-pink-400">
                          &gt;200k
                        </span>
                      )}
                      {t.hasError && (
                        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                          Error
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="mono-num px-4 py-2.5 text-right font-semibold text-[var(--text-primary)]">
                    {formatUsd(t.cost, { decimals: 4 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
