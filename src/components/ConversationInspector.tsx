import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from './EChart';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  ChevronRight,
  Clock,
  Cpu,
  Flame,
  FolderOpen,
  GitBranch,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Wrench,
} from 'lucide-react';
import { EChart, useChartTheme } from './EChart';
import type {
  ConversationDetailResponse,
  ConversationSummary,
  PricingConfig,
  StepCostBreakdown,
  StepRecord,
} from '../shared/types';
import {
  cn,
  formatDateTime,
  formatDuration,
  formatLatency,
  formatModelLabel,
  formatNumber,
  formatPercent,
  formatTokens,
  formatUsd,
  getGradeBadgeClass,
  getModelColor,
} from '../utils/format';
import { escapeHtml, sanitizeCssColor } from '../utils/sanitize';

export interface ConversationInspectorProps {
  conversationId: string;
  pricing: PricingConfig;
  onBack: () => void;
  onSelectConversation: (id: string) => void;
  onSelectProject?: (projectId: string) => void;
  onSetModelOverride?: (conversationId: string, modelId: string | null) => Promise<void>;
}

type StepFilter = 'all' | 'tokens' | 'tools' | 'cacheMiss' | 'errors';
type StepBarMetric = 'cost' | 'output' | 'latency';

function formatShortTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function ConversationInspector({
  conversationId,
  pricing,
  onBack,
  onSelectConversation,
  onSelectProject,
  onSetModelOverride,
}: ConversationInspectorProps) {
  const [detail, setDetail] = useState<ConversationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepFilter, setStepFilter] = useState<StepFilter>('all');
  const [stepSearch, setStepSearch] = useState('');
  const [barMetric, setBarMetric] = useState<StepBarMetric>('cost');
  const [savingOverride, setSavingOverride] = useState(false);
  const theme = useChartTheme();

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? 'Conversation not found' : `HTTP ${res.status}`);
      }
      const json: ConversationDetailResponse = await res.json();
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail, pricing]);

  const handleModelOverrideChange = async (value: string) => {
    if (!onSetModelOverride) return;
    setSavingOverride(true);
    try {
      await onSetModelOverride(conversationId, value === '' ? null : value);
      await fetchDetail();
    } finally {
      setSavingOverride(false);
    }
  };

  const tokenSteps = useMemo(() => {
    if (!detail) return [];
    return detail.steps.filter(
      (s) => s.inputTokens > 0 || s.cacheReadTokens > 0 || s.outputTokens > 0,
    );
  }, [detail]);

  // ECharts Context Window Growth + Cache Miss Markers + >200k Threshold Line
  const contextOption = useMemo<EChartsCoreOption>(() => {
    const labels = tokenSteps.map((s) => `#${s.stepIndex}`);
    const threshold = pricing.longContextThreshold || 200_000;
    const maxContext = Math.max(
      ...tokenSteps.map((s) => s.inputTokens + s.cacheReadTokens),
      0,
    );
    const showThreshold = maxContext > threshold * 0.65;
    const spikePoints = tokenSteps
      .map((s, idx) =>
        s.isCacheMissSpike
          ? {
              value: [idx, s.inputTokens + s.cacheReadTokens],
              step: s,
            }
          : null,
      )
      .filter(Boolean);

    const enableZoom = tokenSteps.length > 30;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [];
          if (!arr[0]) return '';
          const idx = (arr[0] as { dataIndex: number }).dataIndex;
          const s = tokenSteps[idx];
          if (!s) return '';
          const ctx = s.inputTokens + s.cacheReadTokens;
          const hit = ctx > 0 ? s.cacheReadTokens / ctx : 0;
          const modelLbl = escapeHtml(
            s.isFallbackModel
              ? `Untagged (est. ${formatModelLabel(s.model, pricing.models)})`
              : formatModelLabel(s.model, pricing.models),
          );
          const safeMuted = sanitizeCssColor(theme.textMuted);
          const safeSecondary = sanitizeCssColor(theme.textSecondary);
          return `<div style="min-width:210px;">
            <div style="display:flex;justify-content:space-between;font-weight:600;margin-bottom:4px;">
              <span>Step #${escapeHtml(s.stepIndex)}</span>
              <span style="font-weight:400;color:${safeMuted};">${escapeHtml(formatShortTime(s.createdAt))}</span>
            </div>
            <div style="font-size:11px;color:${safeSecondary};margin-bottom:5px;">${modelLbl}</div>
            <div style="font-family:monospace;font-size:11px;display:grid;gap:2px;">
              <div>Total Context: <b>${escapeHtml(formatTokens(ctx))}</b> (${escapeHtml(formatPercent(hit))} cache)</div>
              <div style="color:#38bdf8;">Uncached In: ${escapeHtml(formatTokens(s.inputTokens))}</div>
              <div style="color:#34d399;">Cache Read: ${escapeHtml(formatTokens(s.cacheReadTokens))}</div>
              <div style="color:#a78bfa;">Output: ${escapeHtml(formatTokens(s.outputTokens))}</div>
              <div>Step Cost: <b>${escapeHtml(formatUsd(s.cost.totalCost))}</b></div>
              ${s.isCacheMissSpike ? `<div style="color:#f59e0b;font-weight:600;">⚡ Cache Miss Spike (+${escapeHtml(formatUsd(s.cacheMissWastedCost ?? 0))} wasted)</div>` : ''}
              ${s.isLongContext ? `<div style="color:#f472b6;">⚠ Long Context (&gt;${escapeHtml(formatTokens(threshold))})</div>` : ''}
            </div>
          </div>`;
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
        top: 30,
        left: 10,
        right: 16,
        bottom: enableZoom ? 44 : 14,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
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
          formatter: (v: number) => formatTokens(v),
        },
      },
      ...(enableZoom
        ? {
            dataZoom: [
              { type: 'inside' },
              {
                type: 'slider',
                height: 18,
                bottom: 4,
                borderColor: theme.borderSubtle,
                fillerColor: 'rgba(56, 189, 248, 0.14)',
                handleStyle: { color: '#38bdf8' },
                textStyle: { color: theme.textMuted, fontSize: 10 },
              },
            ],
          }
        : {}),
      series: [
        {
          name: 'Cache Read',
          type: 'line',
          stack: 'ctx',
          smooth: 0.15,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#34d399' },
          itemStyle: { color: '#34d399' },
          areaStyle: { color: 'rgba(52, 211, 153, 0.28)' },
          data: tokenSteps.map((s) => s.cacheReadTokens),
          ...(showThreshold
            ? {
                markLine: {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: '#f472b6', type: 'dashed', width: 1.5 },
                  label: {
                    formatter: `${formatTokens(threshold)} tier`,
                    color: '#f472b6',
                    fontSize: 10,
                    position: 'insideEndTop',
                  },
                  data: [{ yAxis: threshold }],
                },
              }
            : {}),
        },
        {
          name: 'Uncached Input',
          type: 'line',
          stack: 'ctx',
          smooth: 0.15,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#38bdf8' },
          itemStyle: { color: '#38bdf8' },
          areaStyle: { color: 'rgba(56, 189, 248, 0.35)' },
          data: tokenSteps.map((s) => s.inputTokens),
        },
        ...(spikePoints.length > 0
          ? [
              {
                name: 'Cache Miss Spike',
                type: 'scatter',
                symbol: 'diamond',
                symbolSize: 11,
                z: 10,
                itemStyle: { color: '#f59e0b', borderColor: '#ffffff', borderWidth: 1 },
                data: spikePoints,
              },
            ]
          : []),
      ],
    };
  }, [tokenSteps, pricing, theme]);

  // ECharts Per-Step Cost / Output / Latency Bar Chart
  const stepBarOption = useMemo<EChartsCoreOption>(() => {
    const labels = tokenSteps.map((s) => `#${s.stepIndex}`);
    const values = tokenSteps.map((s) => {
      if (barMetric === 'cost') return s.cost.totalCost;
      if (barMetric === 'output') return s.outputTokens;
      return s.latencyMs != null ? s.latencyMs / 1000 : 0;
    });
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [];
          if (!arr[0]) return '';
          const idx = (arr[0] as { dataIndex: number }).dataIndex;
          const s = tokenSteps[idx];
          if (!s) return '';
          const safeSecondary = sanitizeCssColor(theme.textSecondary);
          return `<div style="min-width:190px;">
            <div style="font-weight:600;margin-bottom:4px;">Step #${escapeHtml(s.stepIndex)} · ${escapeHtml(formatShortTime(s.createdAt))}</div>
            <div style="font-family:monospace;font-size:11px;display:grid;gap:2px;">
              <div>Cost: <b>${escapeHtml(formatUsd(s.cost.totalCost))}</b></div>
              <div>Output: <b>${escapeHtml(formatTokens(s.outputTokens))}</b></div>
              <div>Latency: <b>${escapeHtml(formatLatency(s.latencyMs))}</b></div>
              ${s.toolCalls.length > 0 ? `<div style="color:${safeSecondary};">Tools: ${escapeHtml(s.toolCalls.join(', '))}</div>` : ''}
              ${s.hasError ? `<div style="color:#f43f5e;">Error step</div>` : ''}
            </div>
          </div>`;
        },
      },
      grid: { top: 16, left: 10, right: 16, bottom: 14, containLabel: true },
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
          formatter: (v: number) => {
            if (barMetric === 'cost') return formatUsd(v, { compact: true });
            if (barMetric === 'output') return formatTokens(v);
            return `${v.toFixed(0)}s`;
          },
        },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 20,
          data: tokenSteps.map((s, idx) => {
            const val = values[idx];
            let color = barMetric === 'cost' ? '#6366f1' : barMetric === 'output' ? '#a78bfa' : '#38bdf8';
            if (s.hasError) color = '#f43f5e';
            else if (s.isCacheMissSpike) color = '#f59e0b';
            else if (avg > 0 && val >= avg * 2.5) color = '#fb923c';
            return { value: val, itemStyle: { color, borderRadius: [3, 3, 0, 0] } };
          }),
        },
      ],
    };
  }, [tokenSteps, barMetric, theme]);

  const filteredSteps = useMemo(() => {
    if (!detail) return [];
    const q = stepSearch.trim().toLowerCase();
    return detail.steps.filter((s) => {
      if (stepFilter === 'tokens' && s.inputTokens === 0 && s.cacheReadTokens === 0 && s.outputTokens === 0) {
        return false;
      }
      if (stepFilter === 'tools' && s.toolCalls.length === 0) return false;
      if (stepFilter === 'cacheMiss' && !s.isCacheMissSpike) return false;
      if (stepFilter === 'errors' && !s.hasError) return false;
      if (q) {
        const hay = `${s.stepIndex} ${s.type} ${s.model} ${s.toolCalls.join(' ')} ${s.errorText ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [detail, stepFilter, stepSearch]);

  // All selectable models for manual override dropdown
  const selectableModels = useMemo(() => {
    return Object.values(pricing.models).sort((a, b) => a.label.localeCompare(b.label));
  }, [pricing.models]);

  if (loading && !detail) {
    return (
      <div className="surface-card flex h-[420px] flex-col items-center justify-center gap-3 rounded-xl">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-primary)]" />
        <span className="text-xs text-[var(--text-muted)]">Loading conversation trace...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="surface-card flex flex-col items-center justify-center gap-3 rounded-xl p-10 text-center">
        <AlertCircle className="h-7 w-7 text-rose-400" />
        <div className="text-sm font-medium text-[var(--text-primary)]">
          {error ?? 'Conversation unavailable'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] cursor-pointer"
          >
            Back to Conversations
          </button>
          <button
            type="button"
            onClick={() => void fetchDetail()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const { conversation: conv, subagents, ancestors } = detail;
  const hasUntaggedSteps = detail.steps.some((s) => s.rawModel === null);

  return (
    <div className="space-y-5">
      {/* Top Back + Breadcrumb + Manual Tagging Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Conversations
          </button>

          {ancestors.map((anc) => (
            <div key={anc.id} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <ChevronRight className="h-3.5 w-3.5" />
              <button
                type="button"
                onClick={() => onSelectConversation(anc.id)}
                className="truncate max-w-[180px] hover:text-[var(--accent-primary)] cursor-pointer"
              >
                {anc.agentName ? `@${anc.agentName}` : anc.title}
              </button>
            </div>
          ))}
        </div>

        {/* Per-Conversation Manual Model Override (great for pre-Nov-21 untagged chats) */}
        {onSetModelOverride && (hasUntaggedSteps || conv.manualModelOverride) && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs">
            <Tag className="h-3.5 w-3.5 text-violet-400 shrink-0" />
            <span className="text-[var(--text-muted)]">Tag untagged steps as:</span>
            <select
              disabled={savingOverride}
              value={conv.manualModelOverride ?? ''}
              onChange={(e) => void handleModelOverrideChange(e.target.value)}
              className="rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--text-primary)] outline-none cursor-pointer"
            >
              <option value="" className="bg-[var(--bg-surface)]">
                Auto Fallback ({formatModelLabel(pricing.fallbackModelId, pricing.models)})
              </option>
              {selectableModels.map((m) => (
                <option key={m.id} value={m.id} className="bg-[var(--bg-surface)]">
                  {m.label}
                </option>
              ))}
            </select>
            {savingOverride && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-primary)]" />}
          </div>
        )}
      </div>

      {/* Header Summary Card */}
      <section className="surface-card rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {conv.agentName && (
                <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-400">
                  <Bot className="h-3.5 w-3.5" />@{conv.agentName}
                </span>
              )}
              <h2 className="text-base font-semibold text-[var(--text-primary)] break-words">
                {conv.title || 'Untitled Conversation'}
              </h2>
              {conv.direct.tokenStepCount > 0 && (
                <span
                  className={cn(
                    'mono-num rounded border px-1.5 py-0.5 text-[11px] font-bold',
                    getGradeBadgeClass(conv.efficiencyGrade),
                  )}
                  title={`Conversation Efficiency Score: ${conv.efficiencyScore}/100`}
                >
                  Grade {conv.efficiencyGrade} ({conv.efficiencyScore})
                </span>
              )}
              {conv.manualModelOverride && (
                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                  Manual Tag: {formatModelLabel(conv.manualModelOverride, pricing.models)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
              <button
                type="button"
                onClick={() => onSelectProject?.(conv.projectId)}
                className="inline-flex items-center gap-1 hover:text-[var(--accent-primary)] cursor-pointer"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>{conv.projectDisplayName}</span>
              </button>
              <span className="inline-flex items-center gap-1 mono-num">
                <Clock className="h-3.5 w-3.5" />
                Active {formatDuration(conv.activeDurationMs)}
                {conv.medianLatencyMs ? ` · Median turn ${formatLatency(conv.medianLatencyMs)}` : ''}
              </span>
              <span className="mono-num">
                {formatDateTime(conv.firstStepAt)} → {formatDateTime(conv.lastStepAt)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {conv.modelsUsed.map((mId) => (
                <span
                  key={mId}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: getModelColor(mId, pricing.models) }}
                  />
                  {conv.hasFallbackSteps && mId === pricing.fallbackModelId && !conv.manualModelOverride
                    ? `Untagged (est. ${formatModelLabel(mId, pricing.models)})`
                    : formatModelLabel(mId, pricing.models)}
                </span>
              ))}
            </div>
          </div>

          {/* Right Cost Summary Pills */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 shrink-0">
            <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">
                {subagents.length > 0 ? 'Rolled-Up Spend' : 'API Spend'}
              </div>
              <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                {formatUsd(conv.rolledUp.cost.totalCost)}
              </div>
              {subagents.length > 0 && (
                <div className="mono-num text-[10px] text-[var(--text-muted)]">
                  Direct: {formatUsd(conv.direct.cost.totalCost)}
                </div>
              )}
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Cache Savings</div>
              <div className="mono-num text-sm font-semibold text-emerald-400">
                {formatUsd(conv.rolledUp.cost.cacheSavings)}
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                {formatPercent(conv.direct.tokens.cacheHitRatio)} hit
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Total Tokens</div>
              <div className="mono-num text-sm font-semibold text-[var(--text-primary)]">
                {formatTokens(conv.rolledUp.tokens.totalTokens)}
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                {formatNumber(conv.direct.stepCount)} steps
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)]">Spikes / Errors</div>
              <div className="mono-num text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <span className={conv.cacheMissSpikes > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}>
                  {conv.cacheMissSpikes}⚡
                </span>
                <span className={conv.errorCount > 0 ? 'text-rose-400' : 'text-[var(--text-muted)]'}>
                  {conv.errorCount}⚠
                </span>
              </div>
              <div className="mono-num text-[10px] text-[var(--text-muted)]">
                {conv.cacheMissWastedCost > 0 ? `-${formatUsd(conv.cacheMissWastedCost)}` : 'Clean'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Grid: Charts + Subagent Tree Sidebar */}
      <div className={cn('grid grid-cols-1 gap-4', subagents.length > 0 && 'xl:grid-cols-12')}>
        <div className={cn('space-y-4', subagents.length > 0 ? 'xl:col-span-9' : 'col-span-1')}>
          {/* Context Window Growth Chart */}
          <section className="surface-card rounded-xl p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Context Window Growth & Cache Warm-Up
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Stacked uncached input + cache read across billable turns · amber diamonds mark detected cache-miss spikes
                </p>
              </div>
              {conv.longContextSteps > 0 && (
                <span className="mono-num rounded-md bg-pink-500/12 px-2 py-0.5 text-[11px] font-medium text-pink-400">
                  {conv.longContextSteps} turns &gt;{formatTokens(pricing.longContextThreshold)}
                </span>
              )}
            </div>
            {tokenSteps.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                No token-bearing steps in this transcript.
              </div>
            ) : (
              <div className="h-[270px] w-full">
                <EChart option={contextOption} />
              </div>
            )}
          </section>

          {/* Per-Step Cost / Output / Latency Bar Chart */}
          <section className="surface-card rounded-xl p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Per-Step Cost, Output & Turn Latency
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Amber = cache-miss spike · Rose = error step · Orange = &gt;2.5× outlier
                </p>
              </div>
              <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
                {(
                  [
                    { id: 'cost', label: 'Cost ($)' },
                    { id: 'output', label: 'Output' },
                    { id: 'latency', label: 'Latency (s)' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setBarMetric(opt.id)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                      barMetric === opt.id
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {tokenSteps.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                No billable turns recorded.
              </div>
            ) : (
              <div className="h-[235px] w-full">
                <EChart option={stepBarOption} />
              </div>
            )}
          </section>
        </div>

        {/* Subagent & Swarm Tree Sidebar */}
        {subagents.length > 0 && (
          <aside className="surface-card rounded-xl p-4 xl:col-span-3 flex flex-col">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                <GitBranch className="h-4 w-4 text-indigo-400" />
                Subagents ({subagents.length})
              </div>
            </div>
            <div className="space-y-2 overflow-y-auto max-h-[540px] pr-1">
              {subagents.map((sub: ConversationSummary) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => onSelectConversation(sub.id)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-2.5 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-indigo-400">
                      @{sub.agentName || 'subagent'}
                    </span>
                    <span className="mono-num text-xs font-semibold text-[var(--text-primary)]">
                      {formatUsd(sub.rolledUp.cost.totalCost)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-[var(--text-primary)]">
                    {sub.title || 'Untitled Subagent'}
                  </div>
                  <div className="mono-num mt-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span>{formatTokens(sub.direct.tokens.totalTokens)}</span>
                    <span>
                      {formatNumber(sub.direct.stepCount)} steps · {formatDuration(sub.activeDurationMs)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* Step-by-Step Execution Trace Table */}
      <section className="surface-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Step-by-Step Execution Trace ({filteredSteps.length} / {detail.steps.length})
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'tokens', label: 'LLM Turns' },
                  { id: 'tools', label: 'Tool Calls' },
                  { id: 'cacheMiss', label: 'Cache Misses' },
                  { id: 'errors', label: 'Errors' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStepFilter(f.id)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                    stepFilter === f.id
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1 border border-[var(--border-subtle)]">
              <Search className="mr-1.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={stepSearch}
                onChange={(e) => setStepSearch(e.target.value)}
                placeholder="Filter step, tool, model..."
                className="w-40 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
            </div>
          </div>
        </div>

        <div className="max-h-[560px] overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] text-[11px] font-medium text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="px-3 py-2">Step</th>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2 text-right">Uncached</th>
                <th className="px-3 py-2 text-right">Cache Read</th>
                <th className="px-3 py-2 text-right">Output</th>
                <th className="px-3 py-2 text-right">Latency</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2">Tools / Diagnostics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredSteps.map((s: StepRecord & { cost: StepCostBreakdown }) => {
                const isTok = s.inputTokens > 0 || s.cacheReadTokens > 0 || s.outputTokens > 0;
                const ctx = s.inputTokens + s.cacheReadTokens;
                const hit = ctx > 0 ? s.cacheReadTokens / ctx : 0;
                return (
                  <tr
                    key={`${s.stepIndex}-${s.createdAt ?? ''}`}
                    className={cn(
                      'transition-colors hover:bg-[var(--bg-hover)]/45',
                      s.hasError && 'bg-rose-500/6',
                      s.isCacheMissSpike && !s.hasError && 'bg-amber-500/5',
                    )}
                  >
                    <td className="mono-num px-3 py-2 font-medium text-[var(--text-primary)]">
                      #{s.stepIndex}
                    </td>
                    <td className="mono-num px-3 py-2 text-[var(--text-muted)]">
                      {formatShortTime(s.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                        {s.type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {isTok ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px]">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: getModelColor(s.model, pricing.models) }}
                          />
                          <span className="text-[var(--text-primary)]">
                            {s.isFallbackModel
                              ? `Untagged (est. ${formatModelLabel(s.model, pricing.models)})`
                              : formatModelLabel(s.model, pricing.models)}
                          </span>
                          {s.isOverriddenModel && (
                            <span className="rounded bg-violet-500/15 px-1 text-[9px] text-violet-400">
                              tagged
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="mono-num px-3 py-2 text-right text-sky-400">
                      {isTok ? formatNumber(s.inputTokens) : '—'}
                    </td>
                    <td className="mono-num px-3 py-2 text-right text-emerald-400">
                      {s.cacheReadTokens > 0 ? (
                        <>
                          {formatNumber(s.cacheReadTokens)}{' '}
                          <span className="text-[10px] text-[var(--text-muted)]">
                            ({Math.round(hit * 100)}%)
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="mono-num px-3 py-2 text-right text-violet-400">
                      {s.outputTokens > 0 ? formatNumber(s.outputTokens) : '—'}
                    </td>
                    <td className="mono-num px-3 py-2 text-right text-[var(--text-secondary)]">
                      {formatLatency(s.latencyMs)}
                    </td>
                    <td className="mono-num px-3 py-2 text-right font-medium text-[var(--text-primary)]">
                      {isTok ? formatUsd(s.cost.totalCost, { decimals: 4 }) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {s.isCacheMissSpike && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            <Flame className="h-2.5 w-2.5" /> Cache Miss
                          </span>
                        )}
                        {s.isLongContext && (
                          <span className="rounded bg-pink-500/15 px-1.5 py-0.5 text-[10px] font-medium text-pink-400">
                            &gt;{formatTokens(pricing.longContextThreshold)}
                          </span>
                        )}
                        {s.hasError && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400"
                            title={s.errorText}
                          >
                            <AlertTriangle className="h-2.5 w-2.5" /> Error
                          </span>
                        )}
                        {s.toolCalls.map((tc, i) => (
                          <span
                            key={`${tc}-${i}`}
                            className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 border border-indigo-500/20"
                          >
                            <Wrench className="h-2.5 w-2.5" />
                            {tc}
                          </span>
                        ))}
                        {s.thinkingChars > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                            <Sparkles className="h-2.5 w-2.5" />
                            {formatTokens(s.thinkingChars)}c
                          </span>
                        )}
                        {!isTok && s.toolCalls.length === 0 && !s.hasError && s.type === 'USER_INPUT' && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                            <MessageSquare className="h-2.5 w-2.5" /> User prompt
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
