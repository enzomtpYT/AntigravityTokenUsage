import { useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from '../components/EChart';
import {
  Check,
  Coins,
  Cpu,
  Flame,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react';
import { EChart, useChartTheme } from '../components/EChart';
import { calculateSubscriptionRoi, calculateWhatIfComparisons } from '../shared/pricing';
import type { DashboardPayload, ModelPricing, PricingConfig } from '../shared/types';
import {
  cn,
  formatLatency,
  formatMultiplier,
  formatNumber,
  formatPercent,
  formatTokens,
  formatUsd,
} from '../utils/format';
import { escapeHtml } from '../utils/sanitize';

export interface ModelsPageProps {
  data: DashboardPayload;
  pricing: PricingConfig;
  onSavePricing: (next: PricingConfig) => Promise<void>;
  onResetPricing: () => Promise<void>;
}

const PLAN_PRESETS = [20, 100, 200];

function clonePricing(p: PricingConfig): PricingConfig {
  const models: Record<string, ModelPricing> = {};
  for (const [k, v] of Object.entries(p.models)) {
    models[k] = { ...v };
  }
  return {
    ...p,
    models,
    conversationModelOverrides: { ...(p.conversationModelOverrides ?? {}) },
  };
}

export function ModelsPage({
  data,
  pricing,
  onSavePricing,
  onResetPricing,
}: ModelsPageProps) {
  const [draft, setDraft] = useState<PricingConfig>(() => clonePricing(pricing));
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showRefModelsInEditor, setShowRefModelsInEditor] = useState(false);
  const theme = useChartTheme();

  useEffect(() => {
    setDraft(clonePricing(pricing));
  }, [pricing]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(pricing),
    [draft, pricing],
  );

  // Live Subscription ROI preview using draft.monthlySubscriptionUsd
  const liveRoi = useMemo(
    () =>
      calculateSubscriptionRoi(
        draft.monthlySubscriptionUsd,
        data.kpis.projectedMonthlyCost,
        data.kpis.cost.totalCost,
        data.kpis.dailyBurnRate,
      ),
    [
      draft.monthlySubscriptionUsd,
      data.kpis.projectedMonthlyCost,
      data.kpis.cost.totalCost,
      data.kpis.dailyBurnRate,
    ],
  );

  // Live What-If comparisons using draft pricing
  const whatIfList = useMemo(
    () =>
      calculateWhatIfComparisons(
        data.kpis.tokens,
        data.kpis.cost.totalCost,
        draft,
      ),
    [data.kpis.tokens, data.kpis.cost.totalCost, draft],
  );

  // ECharts Subscription ROI Comparison Bar
  const roiChartOption = useMemo<EChartsCoreOption>(() => {
    const subCost = liveRoi.monthlyPriceUsd;
    const apiProj = liveRoi.monthlyProjectedApiUsd;
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
          const p = arr[0] as { name: string; value: number };
          return `<div style="font-weight:600;">${escapeHtml(p.name)}</div><div style="font-family:monospace;font-size:12px;">${escapeHtml(formatUsd(p.value))} / 30d</div>`;
        },
      },
      grid: { top: 8, left: 10, right: 65, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 11,
          formatter: (v: number) => formatUsd(v, { compact: true }),
        },
      },
      yAxis: {
        type: 'category',
        data: ['Your Plan', 'API Equivalent'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 22,
          label: {
            show: true,
            position: 'right',
            color: theme.textPrimary,
            fontFamily: 'monospace',
            fontSize: 11,
            formatter: (p: { value: number }) => formatUsd(p.value),
          },
          data: [
            { value: subCost, itemStyle: { color: '#38bdf8', borderRadius: [0, 4, 4, 0] } },
            { value: apiProj, itemStyle: { color: '#10b981', borderRadius: [0, 4, 4, 0] } },
          ],
        },
      ],
    };
  }, [liveRoi, theme]);

  // ECharts What-If Public API Simulator Chart
  const whatIfOption = useMemo<EChartsCoreOption>(() => {
    const sorted = [...whatIfList].reverse();
    const baseline = data.kpis.cost.totalCost;
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
          const w = sorted[(arr[0] as { dataIndex: number }).dataIndex];
          if (!w) return '';
          const deltaSign = w.deltaCost >= 0 ? '+' : '';
          const deltaColor = w.deltaCost <= 0 ? '#34d399' : '#fb923c';
          return `<div style="min-width:200px;">
            <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(w.label)}</div>
            <div style="font-family:monospace;font-size:11px;display:grid;gap:2px;">
              <div>Projected API Spend: <b>${escapeHtml(formatUsd(w.projectedCost))}</b></div>
              <div>No-Cache Spend: ${escapeHtml(formatUsd(w.projectedCostWithoutCache))}</div>
              <div style="color:${deltaColor};">vs. Current: ${deltaSign}${escapeHtml(formatUsd(w.deltaCost))} (${deltaSign}${(w.deltaPercent * 100).toFixed(1)}%)</div>
            </div>
          </div>`;
        },
      },
      grid: { top: 22, left: 10, right: 64, bottom: 10, containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 11,
          formatter: (v: number) => formatUsd(v, { compact: true }),
        },
      },
      yAxis: {
        type: 'category',
        data: sorted.map((w) => w.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 20,
          label: {
            show: true,
            position: 'right',
            color: theme.textSecondary,
            fontFamily: 'monospace',
            fontSize: 11,
            formatter: (p: { value: number }) => formatUsd(p.value, { compact: true }),
          },
          markLine:
            baseline > 0
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: '#f59e0b', type: 'dashed', width: 1.5 },
                  label: {
                    formatter: `Current ${formatUsd(baseline, { compact: true })}`,
                    color: '#f59e0b',
                    fontSize: 10,
                    position: 'end',
                  },
                  data: [{ xAxis: baseline }],
                }
              : undefined,
          data: sorted.map((w) => ({
            value: w.projectedCost,
            itemStyle: { color: w.color, borderRadius: [0, 4, 4, 0] },
          })),
        },
      ],
    };
  }, [whatIfList, data.kpis.cost.totalCost, theme]);

  const updateRate = (
    modelId: string,
    field: 'inputPer1M' | 'cacheReadPer1M' | 'outputPer1M',
    rawVal: string,
  ) => {
    const num = Number(rawVal);
    if (Number.isNaN(num) || num < 0) return;
    setDraft((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        [modelId]: {
          ...prev.models[modelId],
          [field]: num,
        },
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      await onSavePricing(draft);
      setSavedNotice('Pricing & ROI settings saved');
      window.setTimeout(() => setSavedNotice(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save pricing');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      await onResetPricing();
      setSavedNotice('Reset to defaults (Gemini 3.8 Flash fallback)');
      window.setTimeout(() => setSavedNotice(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reset pricing');
    } finally {
      setResetting(false);
    }
  };

  const editorModels = useMemo(() => {
    const all = Object.values(draft.models);
    return all
      .filter((m) => showRefModelsInEditor || !m.isReference)
      .sort((a, b) => {
        if (Boolean(a.isReference) !== Boolean(b.isReference)) return a.isReference ? 1 : -1;
        return a.label.localeCompare(b.label);
      });
  }, [draft.models, showRefModelsInEditor]);

  const allFallbackCandidates = useMemo(
    () => Object.values(draft.models).sort((a, b) => a.label.localeCompare(b.label)),
    [draft.models],
  );

  return (
    <div className="space-y-5">
      {/* Subscription ROI & Savings Calculator */}
      <section className="surface-card rounded-xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Subscription ROI & Value Calculator
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Compare your projected 30-day API equivalent spend against your monthly subscription plan
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              {PLAN_PRESETS.map((price) => (
                <button
                  key={price}
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, monthlySubscriptionUsd: price }))
                  }
                  className={cn(
                    'mono-num rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                    draft.monthlySubscriptionUsd === price
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent',
                  )}
                >
                  ${price}/mo
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1 border border-[var(--border-subtle)] text-xs">
              <span className="text-[var(--text-muted)]">$</span>
              <input
                type="number"
                min={0}
                step={5}
                value={draft.monthlySubscriptionUsd}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v) && v >= 0) {
                    setDraft((prev) => ({ ...prev, monthlySubscriptionUsd: v }));
                  }
                }}
                className="mono-num w-16 bg-transparent text-xs font-medium text-[var(--text-primary)] outline-none"
                aria-label="Monthly subscription USD"
              />
              <span className="text-[var(--text-muted)]">/mo</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-center">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-7">
            <div className="rounded-lg bg-[var(--bg-elevated)] p-3 border border-[var(--border-subtle)]">
              <div className="text-[11px] text-[var(--text-muted)]">ROI Multiplier</div>
              <div className="mono-num mt-1 text-xl font-bold text-emerald-400">
                {formatMultiplier(liveRoi.roiMultiplier)}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">API value / plan</div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] p-3 border border-[var(--border-subtle)]">
              <div className="text-[11px] text-[var(--text-muted)]">30d Net Savings</div>
              <div
                className={cn(
                  'mono-num mt-1 text-xl font-bold',
                  liveRoi.monthlyNetSavingsUsd >= 0 ? 'text-emerald-400' : 'text-amber-400',
                )}
              >
                {liveRoi.monthlyNetSavingsUsd >= 0 ? '+' : ''}
                {formatUsd(liveRoi.monthlyNetSavingsUsd, { compact: true })}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">vs. paying API rates</div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] p-3 border border-[var(--border-subtle)]">
              <div className="text-[11px] text-[var(--text-muted)]">Break-Even Day</div>
              <div className="mono-num mt-1 text-xl font-bold text-sky-400">
                {liveRoi.breakEvenDay ? `Day ${liveRoi.breakEvenDay}` : '—'}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">of active usage</div>
            </div>
            <div className="rounded-lg bg-[var(--bg-elevated)] p-3 border border-[var(--border-subtle)]">
              <div className="text-[11px] text-[var(--text-muted)]">30d Projected API</div>
              <div className="mono-num mt-1 text-xl font-bold text-[var(--text-primary)]">
                {formatUsd(liveRoi.monthlyProjectedApiUsd, { compact: true })}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                Actual: {formatUsd(liveRoi.totalApiUsd)}
              </div>
            </div>
          </div>

          <div className="h-[115px] w-full lg:col-span-5">
            <EChart option={roiChartOption} />
          </div>
        </div>
      </section>

      {/* Per-Model Usage & Diagnostics Table */}
      <section className="surface-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Per-Model Usage, Latency & Spend ({data.models.length})
            </h2>
          </div>
          <span className="mono-num text-xs text-[var(--text-muted)]">
            Total: <strong className="text-[var(--text-primary)]">{formatUsd(data.kpis.cost.totalCost)}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 text-[11px] font-medium text-[var(--text-muted)]">
                <th className="px-4 py-2.5">Model</th>
                <th className="px-3 py-2.5 text-right">Turns</th>
                <th className="px-3 py-2.5 text-right">Uncached</th>
                <th className="px-3 py-2.5 text-right">Cache Read</th>
                <th className="px-3 py-2.5 text-right">Output</th>
                <th className="px-3 py-2.5 text-right">Cache %</th>
                <th className="px-3 py-2.5 text-right">Median Lat.</th>
                <th className="px-3 py-2.5 text-right">Spikes / &gt;200k</th>
                <th className="px-3 py-2.5 text-right">API Spend</th>
                <th className="px-4 py-2.5 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {data.models.map((m) => (
                <tr
                  key={`${m.modelId}-${m.isFallback}`}
                  className="hover:bg-[var(--bg-hover)]/45 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-xs"
                        style={{ backgroundColor: m.color }}
                      />
                      <div>
                        <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                          <span>{m.label}</span>
                          {m.isFallback && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                              untagged est.
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--text-muted)]">
                          {m.modelId} · {m.conversations} chats
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-[var(--text-secondary)]">
                    {formatNumber(m.steps)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-sky-400">
                    {formatTokens(m.tokens.uncachedInput)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-emerald-400">
                    {formatTokens(m.tokens.cacheRead)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-violet-400">
                    {formatTokens(m.tokens.output)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-[var(--text-primary)]">
                    {formatPercent(m.tokens.cacheHitRatio)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-[var(--text-secondary)]">
                    {formatLatency(m.medianLatencyMs)}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right">
                    <span className={m.cacheMissSpikes > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}>
                      {m.cacheMissSpikes}⚡
                    </span>
                    {' / '}
                    <span className={m.longContextSteps > 0 ? 'text-pink-400' : 'text-[var(--text-muted)]'}>
                      {m.longContextSteps}
                    </span>
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right font-semibold text-[var(--text-primary)]">
                    {formatUsd(m.cost.totalCost)}
                  </td>
                  <td className="mono-num px-4 py-2.5 text-right text-[var(--text-muted)]">
                    {formatPercent(m.costShare)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* What-If Public API Cost Simulator (Apache ECharts) */}
      <section className="surface-card rounded-xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                What-If Public API Cost Simulator
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Exact projected cost if all {formatTokens(data.kpis.tokens.totalTokens)} filtered tokens had run on each public API model
              </p>
            </div>
          </div>
          <span className="mono-num rounded-md bg-amber-500/12 px-2 py-0.5 text-xs font-medium text-amber-400">
            Baseline: {formatUsd(data.kpis.cost.totalCost)}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="h-[290px] w-full xl:col-span-7">
            <EChart option={whatIfOption} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:col-span-5 content-start">
            {whatIfList.map((w) => {
              const cheaper = w.deltaCost <= 0;
              return (
                <div
                  key={w.modelId}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: w.color }}
                      />
                      {w.label}
                    </span>
                    <span className="mono-num text-xs font-semibold text-[var(--text-primary)]">
                      {formatUsd(w.projectedCost)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] mono-num">
                    <span className="text-[var(--text-muted)]">
                      No cache: {formatUsd(w.projectedCostWithoutCache, { compact: true })}
                    </span>
                    <span className={cheaper ? 'text-emerald-400' : 'text-amber-400'}>
                      {w.deltaCost >= 0 ? '+' : ''}
                      {(w.deltaPercent * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Editable Rate Card & Pricing Controls */}
      <section className="surface-card rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[var(--accent-primary)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Editable Rate Card & Tiered Pricing Rules
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Rates in USD per 1M tokens · saved locally to <code className="text-[var(--text-secondary)]">data/pricing-overrides.json</code>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {savedNotice && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-2 py-1 text-xs font-medium text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                {savedNotice}
              </span>
            )}
            {errorMsg && (
              <span className="rounded-md bg-rose-500/12 px-2 py-1 text-xs text-rose-400">
                {errorMsg}
              </span>
            )}
            <button
              type="button"
              disabled={resetting}
              onClick={() => void handleReset()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
            >
              {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Reset Defaults
            </button>
            <button
              type="button"
              disabled={saving || !isDirty}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-95 cursor-pointer disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Pricing
            </button>
          </div>
        </div>

        {/* Fallback + Long-Context Tier Controls */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Older Untagged Transcripts (pre-Nov 21)
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.includeUntagged}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, includeUntagged: e.target.checked }))
                  }
                  className="accent-[var(--accent-primary)]"
                />
                Include untagged
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--text-muted)] shrink-0">Default Fallback:</span>
              <select
                value={draft.fallbackModelId}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, fallbackModelId: e.target.value }))
                }
                className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] outline-none cursor-pointer"
              >
                {allFallbackCandidates.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[var(--bg-surface)]">
                    {m.label} (${m.inputPer1M} / ${m.cacheReadPer1M} / ${m.outputPer1M})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <Layers className="h-3.5 w-3.5 text-pink-400" />
                Long-Context Tiered Pricing (&gt;{formatTokens(draft.longContextThreshold)})
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.longContextEnabled}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, longContextEnabled: e.target.checked }))
                  }
                  className="accent-pink-500"
                />
                Enable surcharge
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 text-[var(--text-muted)]">
                Input ×
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  value={draft.longContextInputMultiplier}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v) && v >= 1) {
                      setDraft((prev) => ({ ...prev, longContextInputMultiplier: v }));
                    }
                  }}
                  className="mono-num w-14 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-xs text-[var(--text-primary)]"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[var(--text-muted)]">
                Output ×
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  value={draft.longContextOutputMultiplier}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v) && v >= 1) {
                      setDraft((prev) => ({ ...prev, longContextOutputMultiplier: v }));
                    }
                  }}
                  className="mono-num w-14 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-xs text-[var(--text-primary)]"
                />
              </label>
              <span className="mono-num text-[11px] text-pink-400">
                {data.efficiency.longContextSteps} turns affected ({formatUsd(data.efficiency.longContextSurcharge)} impact)
              </span>
            </div>
          </div>
        </div>

        {/* Toggle reference models in editor */}
        <div className="flex items-center justify-between pt-1">
          <div className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Coins className="h-3.5 w-3.5" />
            Showing {editorModels.length} editable models
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={showRefModelsInEditor}
              onChange={(e) => setShowRefModelsInEditor(e.target.checked)}
              className="accent-[var(--accent-primary)]"
            />
            Also edit What-If reference models
          </label>
        </div>

        {/* Editable Table */}
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 text-[11px] font-medium text-[var(--text-muted)]">
                <th className="px-3.5 py-2">Model</th>
                <th className="px-3 py-2 text-right">Uncached Input ($/1M)</th>
                <th className="px-3 py-2 text-right">Cache Read ($/1M)</th>
                <th className="px-3 py-2 text-right">Output ($/1M)</th>
                <th className="px-3.5 py-2">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {editorModels.map((m) => (
                <tr key={m.id} className="hover:bg-[var(--bg-hover)]/35">
                  <td className="px-3.5 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: m.color }}
                      />
                      <div>
                        <div className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          <span>{m.label}</span>
                          {m.id === draft.fallbackModelId && (
                            <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[9px] font-medium text-teal-400">
                              fallback
                            </span>
                          )}
                          {m.isReference && (
                            <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-medium text-indigo-400">
                              ref
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--text-muted)]">{m.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.05}
                      value={m.inputPer1M}
                      onChange={(e) => updateRate(m.id, 'inputPer1M', e.target.value)}
                      className="mono-num w-24 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-right text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={m.cacheReadPer1M}
                      onChange={(e) => updateRate(m.id, 'cacheReadPer1M', e.target.value)}
                      className="mono-num w-24 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-right text-xs text-emerald-400 focus:border-[var(--accent-primary)] outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.25}
                      value={m.outputPer1M}
                      onChange={(e) => updateRate(m.id, 'outputPer1M', e.target.value)}
                      className="mono-num w-24 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-right text-xs text-violet-400 focus:border-[var(--accent-primary)] outline-none"
                    />
                  </td>
                  <td className="px-3.5 py-2 text-[11px] text-[var(--text-muted)] max-w-[260px] truncate">
                    {m.note ?? '—'}
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
