import { useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from '../components/EChart';
import {
  AlertOctagon,
  CalendarClock,
  Check,
  Clock,
  CloudDownload,
  ExternalLink,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';
import { EChart, useChartTheme } from '../components/EChart';
import type {
  DashboardPayload,
  PoolLimitEstimate,
  QuotaPool,
  ResetCycleSummary,
  ResetEventPool,
  ResetScheduleConfig,
  ResetScope,
} from '../shared/types';
import {
  cn,
  formatDateTime,
  formatModelLabel,
  formatNumber,
  formatPercent,
  formatTokens,
  formatUsd,
  getGradeBadgeClass,
} from '../utils/format';
import { escapeHtml, sanitizeCssColor } from '../utils/sanitize';

export interface ResetsPageProps {
  data: DashboardPayload;
  onSaveResetConfig: (next: ResetScheduleConfig) => Promise<void>;
  onSyncResetFeed: () => Promise<{ added: number; totalFeedMarkers: number; sourceUrl: string }>;
  onFilterToWindow: (startIso: string, endIso: string, label: string) => void;
}

type CycleView = '5h' | 'weekly';
type PoolView = 'all' | 'gemini' | 'claude_gpt';
type ChartMetric = 'cost' | 'tokens';
type ActivePanel = 'none' | 'sync' | 'serverReset' | 'limitHit';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatCountdown(targetIso: string, nowMs: number): string {
  const diff = Date.parse(targetIso) - nowMs;
  if (Number.isNaN(diff) || diff <= 0) return 'Reset ready';
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function toLocalDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ResetsPage({
  data,
  onSaveResetConfig,
  onSyncResetFeed,
  onFilterToWindow,
}: ResetsPageProps) {
  const { resetAnalytics, pricing } = data;
  const { config, fiveHourCycles, weeklyCycles, pools, limitEstimates } = resetAnalytics;
  const theme = useChartTheme();

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cycleView, setCycleView] = useState<CycleView>('5h');
  const [poolView, setPoolView] = useState<PoolView>('all');
  const [metric, setMetric] = useState<ChartMetric>('cost');
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');
  const [saving, setSaving] = useState(false);
  const [syncingFeed, setSyncingFeed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync Timer form state
  const [syncPool, setSyncPool] = useState<QuotaPool>('gemini');
  const [sync5hHours, setSync5hHours] = useState('4');
  const [sync5hMins, setSync5hMins] = useState('30');
  const [syncWeekDays, setSyncWeekDays] = useState('5');
  const [syncWeekHours, setSyncWeekHours] = useState('0');
  const [weekResetDay, setWeekResetDay] = useState(config.weeklyResetDayUtc);
  const [weekResetHour, setWeekResetHour] = useState(config.weeklyResetHourUtc);

  // Server Reset form state
  const [resetTimestamp, setResetTimestamp] = useState(() => toLocalDateTimeInput(new Date()));
  const [resetScope, setResetScope] = useState<ResetScope>('both');
  const [resetPool, setResetPool] = useState<ResetEventPool>('all');
  const [resetLabel, setResetLabel] = useState('Google server-side reset');

  // Limit Hit form state
  const [hitTimestamp, setHitTimestamp] = useState(() => toLocalDateTimeInput(new Date()));
  const [hitScope, setHitScope] = useState<'5h' | 'weekly'>('5h');
  const [hitPool, setHitPool] = useState<QuotaPool>('gemini');
  const [hitNote, setHitNote] = useState('');

  useEffect(() => {
    setWeekResetDay(config.weeklyResetDayUtc);
    setWeekResetHour(config.weeklyResetHourUtc);
  }, [config.weeklyResetDayUtc, config.weeklyResetHourUtc]);

  // 1-second live countdown ticker
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const persistConfig = async (next: ResetScheduleConfig, successText: string) => {
    setSaving(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      await onSaveResetConfig(next);
      setNotice(successText);
      window.setTimeout(() => setNotice(null), 3500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save reset config');
    } finally {
      setSaving(false);
    }
  };

  const handleSync5h = () => {
    const h = Math.max(0, Number(sync5hHours) || 0);
    const m = Math.max(0, Number(sync5hMins) || 0);
    const totalMs = (h * 60 + m) * 60_000;
    if (totalMs <= 0) return;
    const targetIso = new Date(Date.now() + totalMs).toISOString();
    void persistConfig(
      {
        ...config,
        syncedNext5hReset: {
          ...config.syncedNext5hReset,
          [syncPool]: targetIso,
        },
      },
      `Synced 5h reset timer for ${syncPool === 'gemini' ? 'Gemini' : 'Claude & GPT'}`,
    );
  };

  const handleSyncWeekly = () => {
    const d = Math.max(0, Number(syncWeekDays) || 0);
    const h = Math.max(0, Number(syncWeekHours) || 0);
    const totalMs = (d * 24 + h) * 3_600_000;
    if (totalMs <= 0) return;
    const targetIso = new Date(Date.now() + totalMs).toISOString();
    void persistConfig(
      {
        ...config,
        syncedNextWeeklyReset: {
          ...config.syncedNextWeeklyReset,
          [syncPool]: targetIso,
        },
      },
      `Synced weekly reset timer for ${syncPool === 'gemini' ? 'Gemini' : 'Claude & GPT'}`,
    );
  };

  const handleSaveSchedule = () => {
    void persistConfig(
      {
        ...config,
        weeklyResetDayUtc: weekResetDay,
        weeklyResetHourUtc: weekResetHour,
      },
      'Saved weekly reset schedule',
    );
  };

  const handleClearSyncedTimers = (poolOnly?: QuotaPool) => {
    const next5h = { ...config.syncedNext5hReset };
    const nextWeekly = { ...config.syncedNextWeeklyReset };
    if (poolOnly) {
      delete next5h[poolOnly];
      delete nextWeekly[poolOnly];
    }
    void persistConfig(
      {
        ...config,
        syncedNext5hReset: poolOnly ? next5h : {},
        syncedNextWeeklyReset: poolOnly ? nextWeekly : {},
      },
      poolOnly
        ? `Cleared synced timers for ${poolOnly === 'gemini' ? 'Gemini' : 'Claude & GPT'} (reverted to auto)`
        : 'Cleared all synced countdown anchors (reverted to auto-detection)',
    );
  };

  const handleToggleAutoSync = () => {
    const nextAuto = !(config.autoSyncOfficialResets ?? true);
    void persistConfig(
      {
        ...config,
        autoSyncOfficialResets: nextAuto,
      },
      nextAuto
        ? 'Enabled automatic server reset sync on startup'
        : 'Disabled automatic server reset sync on startup',
    );
  };

  const handleLogServerReset = () => {
    const ts = new Date(resetTimestamp);
    if (Number.isNaN(ts.getTime())) {
      setErrorMsg('Please enter a valid reset date/time');
      return;
    }
    const marker = {
      id: `rst-${Date.now()}`,
      timestamp: ts.toISOString(),
      scope: resetScope,
      pool: resetPool,
      label: resetLabel.trim() || 'Server reset',
    };
    void persistConfig(
      {
        ...config,
        customResets: [...config.customResets, marker],
      },
      `Logged server reset "${marker.label}"`,
    );
    setActivePanel('none');
  };

  const handleDeleteServerReset = (id: string) => {
    void persistConfig(
      {
        ...config,
        customResets: config.customResets.filter((r) => r.id !== id),
      },
      'Removed server reset marker',
    );
  };

  const handleLogLimitHit = () => {
    const ts = new Date(hitTimestamp);
    if (Number.isNaN(ts.getTime())) {
      setErrorMsg('Please enter a valid date/time');
      return;
    }
    const marker = {
      id: `hit-${Date.now()}`,
      timestamp: ts.toISOString(),
      scope: hitScope,
      pool: hitPool,
      ...(hitNote.trim() ? { note: hitNote.trim() } : {}),
    };
    void persistConfig(
      {
        ...config,
        limitHits: [...config.limitHits, marker],
      },
      `Logged ${hitScope} limit hit for ${hitPool === 'gemini' ? 'Gemini' : 'Claude & GPT'}`,
    );
    setHitNote('');
    setActivePanel('none');
  };

  const handleDeleteLimitHit = (id: string) => {
    void persistConfig(
      {
        ...config,
        limitHits: config.limitHits.filter((h) => h.id !== id),
      },
      'Removed limit hit marker',
    );
  };

  const handleSyncOfficialFeed = async () => {
    setSyncingFeed(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await onSyncResetFeed();
      setNotice(
        res.added > 0
          ? `Imported ${res.added} confirmed server reset${res.added === 1 ? '' : 's'} from geminireset.com`
          : `Already up to date (${res.totalFeedMarkers} confirmed resets checked)`,
      );
      window.setTimeout(() => setNotice(null), 4500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to sync official reset feed');
    } finally {
      setSyncingFeed(false);
    }
  };

  const activeCycles = useMemo(() => {
    if (poolView === 'gemini' && pools?.gemini) {
      return cycleView === '5h' ? pools.gemini.fiveHourCycles : pools.gemini.weeklyCycles;
    }
    if (poolView === 'claude_gpt' && pools?.claude_gpt) {
      return cycleView === '5h' ? pools.claude_gpt.fiveHourCycles : pools.claude_gpt.weeklyCycles;
    }
    return cycleView === '5h' ? fiveHourCycles : weeklyCycles;
  }, [poolView, cycleView, pools, fiveHourCycles, weeklyCycles]);

  const findEstimate = (pool: QuotaPool, scope: '5h' | 'weekly'): PoolLimitEstimate | undefined =>
    limitEstimates.find((e) => e.pool === pool && e.scope === scope);

  // Build ECharts Per-Cycle Bar Chart (chronological left-to-right)
  const chartOption = useMemo<EChartsCoreOption>(() => {
    const chronological = [...activeCycles].slice(0, 32).reverse();
    const labels = chronological.map((c) => {
      let lbl = c.label;
      if (c.isCurrent) lbl = `${lbl} ★`;
      else if (c.startedByServerReset) lbl = `⚡ ${lbl}`;
      return lbl;
    });

    const getVal = (c: ResetCycleSummary, pool: 'gemini' | 'claude_gpt') => {
      const pm = pool === 'gemini' ? c.gemini : c.claudeGpt;
      return metric === 'cost' ? pm.cost.totalCost : pm.tokens.totalTokens;
    };

    const series: Record<string, unknown>[] = [];
    if (poolView === 'all' || poolView === 'gemini') {
      series.push({
        name: 'Gemini Models',
        type: 'bar',
        stack: 'pool',
        barMaxWidth: 26,
        itemStyle: {
          color: '#38bdf8',
          borderRadius: poolView === 'gemini' ? [3, 3, 0, 0] : [0, 0, 0, 0],
        },
        data: chronological.map((c) => ({
          value: getVal(c, 'gemini'),
          cycle: c,
          itemStyle: c.limitHits.some((h) => h.pool === 'gemini')
            ? { color: '#f43f5e' }
            : undefined,
        })),
      });
    }
    if (poolView === 'all' || poolView === 'claude_gpt') {
      series.push({
        name: 'Claude & GPT Models',
        type: 'bar',
        stack: 'pool',
        barMaxWidth: 26,
        itemStyle: {
          color: '#fb923c',
          borderRadius: [3, 3, 0, 0],
        },
        data: chronological.map((c) => ({
          value: getVal(c, 'claude_gpt'),
          cycle: c,
          itemStyle: c.limitHits.some((h) => h.pool === 'claude_gpt')
            ? { color: '#e11d48' }
            : undefined,
        })),
      });
    }

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
          const c = chronological[idx];
          if (!c) return '';
          const safeMuted = sanitizeCssColor(theme.textMuted);
          const safeSecondary = sanitizeCssColor(theme.textSecondary);
          return `<div style="min-width:230px;">
            <div style="font-weight:600;margin-bottom:3px;">${escapeHtml(c.label)}${c.isCurrent ? ' <span style="color:#34d399;">(Current)</span>' : ''}</div>
            <div style="font-size:10px;color:${safeMuted};margin-bottom:6px;">${escapeHtml(formatDateTime(c.startAt))} → ${escapeHtml(formatDateTime(c.endAt))}</div>
            ${c.startedByServerReset ? `<div style="font-size:11px;color:#f59e0b;margin-bottom:4px;">⚡ Post-reset: ${escapeHtml(c.serverResetLabel || 'Server reset')}</div>` : ''}
            ${c.endedEarlyByServerReset ? `<div style="font-size:11px;color:#f59e0b;margin-bottom:4px;">⚡ Closed early by server reset</div>` : ''}
            ${c.limitHits.length > 0 ? `<div style="font-size:11px;color:#f43f5e;font-weight:600;margin-bottom:4px;">⛔ Limit hit logged (${escapeHtml(c.limitHits.length)})</div>` : ''}
            <div style="font-family:monospace;font-size:11px;display:grid;gap:3px;">
              <div style="display:flex;justify-content:space-between;gap:14px;">
                <span style="color:#38bdf8;">● Gemini Pool</span>
                <span><b>${escapeHtml(formatUsd(c.gemini.cost.totalCost))}</b> · ${escapeHtml(formatTokens(c.gemini.tokens.totalTokens))}</span>
              </div>
              <div style="display:flex;justify-content:space-between;gap:14px;">
                <span style="color:#fb923c;">● Claude &amp; GPT</span>
                <span><b>${escapeHtml(formatUsd(c.claudeGpt.cost.totalCost))}</b> · ${escapeHtml(formatTokens(c.claudeGpt.tokens.totalTokens))}</span>
              </div>
              <div style="display:flex;justify-content:space-between;gap:14px;border-top:1px solid ${sanitizeCssColor(theme.borderSubtle)};padding-top:3px;margin-top:2px;">
                <span style="color:${safeSecondary};">Combined</span>
                <span><b>${escapeHtml(formatUsd(c.combined.cost.totalCost))}</b> · ${escapeHtml(formatTokens(c.combined.tokens.totalTokens))}</span>
              </div>
            </div>
            <div style="margin-top:5px;font-size:10px;color:${safeMuted};">Click bar to filter entire dashboard to this window</div>
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
      grid: { top: 32, left: 12, right: 16, bottom: 20, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: theme.gridLine } },
        axisTick: { show: false },
        axisLabel: { color: theme.textMuted, fontSize: 10 },
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
      series,
    };
  }, [activeCycles, poolView, metric, theme]);

  const renderPoolWindowBlock = (
    cycle: ResetCycleSummary,
    pool: QuotaPool,
    scope: '5h' | 'weekly',
    accentBarClass: string,
    accentTextClass: string,
  ) => {
    const startMs = Date.parse(cycle.startAt);
    const endMs = Date.parse(cycle.endAt);
    const isIdle = Boolean(cycle.isIdle);
    const elapsedPct =
      !isIdle && !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs
        ? Math.min(100, Math.max(0, ((nowMs - startMs) / (endMs - startMs)) * 100))
        : 0;
    const pm = pool === 'gemini' ? cycle.gemini : cycle.claudeGpt;
    const est = findEstimate(pool, scope);
    const poolLabel = pool === 'gemini' ? 'Gemini' : 'Claude & GPT';

    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {scope === '5h' ? '5-Hour Limit' : 'Weekly Limit'}
              </span>
              {isIdle ? (
                <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                  IDLE · 100% READY
                </span>
              ) : (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                  LIVE
                </span>
              )}
              {cycle.isSynced && (
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                  Synced
                </span>
              )}
              {cycle.startedByServerReset && (
                <span
                  className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
                  title={cycle.serverResetLabel}
                >
                  ⚡ Post-Reset
                </span>
              )}
            </div>
            <div className="mono-num mt-0.5 text-[11px] text-[var(--text-muted)]">
              {isIdle
                ? 'Starts automatically on next prompt in this pool'
                : `${formatDateTime(cycle.startAt)} → ${formatDateTime(cycle.endAt)}`}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {isIdle ? 'Status' : 'Resets in'}
            </div>
            <div
              className={cn(
                'mono-num text-base font-bold',
                isIdle ? 'text-emerald-400' : 'text-[var(--text-primary)]',
              )}
            >
              {isIdle ? 'Ready' : formatCountdown(cycle.endAt, nowMs)}
            </div>
          </div>
        </div>

        {/* Elapsed Progress Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <span>{isIdle ? 'No active window' : 'Window elapsed'}</span>
            <span className="mono-num">{isIdle ? '0%' : `${elapsedPct.toFixed(0)}%`}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
            <div
              className={cn('h-full rounded-full transition-all', accentBarClass)}
              style={{ width: `${elapsedPct}%` }}
            />
          </div>
        </div>

        {/* Pool Metrics + Filter Button */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="mono-num text-base font-bold text-[var(--text-primary)]">
              {formatUsd(pm.cost.totalCost)}
            </span>
            <span className="mono-num text-xs text-[var(--text-secondary)]">
              {formatTokens(pm.tokens.totalTokens)} tok
            </span>
            {pm.tokenSteps > 0 && (
              <span className="mono-num text-xs text-emerald-400">
                {formatPercent(pm.tokens.cacheHitRatio)} cache
              </span>
            )}
            <span className="mono-num text-[11px] text-[var(--text-muted)]">
              {formatNumber(pm.tokenSteps)} turns · {pm.conversations} chats
            </span>
          </div>
          {!isIdle && (
            <button
              type="button"
              onClick={() =>
                onFilterToWindow(
                  cycle.startAt,
                  cycle.endAt,
                  `${poolLabel} ${scope === '5h' ? '5h' : 'Week'} (${cycle.label})`,
                )
              }
              className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-primary)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/25 cursor-pointer"
            >
              <Filter className="h-2.5 w-2.5" />
              Filter
            </button>
          )}
        </div>

        {/* Empirical Limit Progress (if user logged past limit hits for this pool+scope) */}
        {est && est.avgCostAtLimit > 0 && (
          <div className="pt-1 space-y-1 border-t border-[var(--border-subtle)]/70">
            <div className={cn('flex justify-between text-[10px] mono-num', accentTextClass)}>
              <span>Est. limit used ({est.sampleCount} hit{est.sampleCount === 1 ? '' : 's'})</span>
              <span>
                {Math.min(999, Math.round((pm.cost.totalCost / est.avgCostAtLimit) * 100))}% of ~
                {formatUsd(est.avgCostAtLimit)}
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-[var(--bg-surface)] overflow-hidden">
              <div
                className={cn('h-full', accentBarClass)}
                style={{
                  width: `${Math.min(100, (pm.cost.totalCost / est.avgCostAtLimit) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPoolCard = (pool: QuotaPool) => {
    const timeline = pools?.[pool];
    if (!timeline) return null;
    const isGemini = pool === 'gemini';
    const hasSynced = Boolean(
      config.syncedNext5hReset[pool] || config.syncedNextWeeklyReset[pool],
    );

    return (
      <div
        className={cn(
          'surface-card rounded-xl p-4 sm:p-5 space-y-3.5 border-t-2',
          isGemini ? 'border-t-sky-400/80' : 'border-t-orange-400/80',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isGemini ? (
              <Sparkles className="h-4 w-4 text-sky-400" />
            ) : (
              <Zap className="h-4 w-4 text-orange-400" />
            )}
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {isGemini ? 'Gemini Models Pool' : 'Claude & GPT Models Pool'}
              </h2>
              <p className="text-[11px] text-[var(--text-muted)]">
                {isGemini
                  ? 'Independent 5h & weekly clocks · affected by Gemini & All-model resets'
                  : 'Independent 5h & weekly clocks · unaffected by Gemini-only resets'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setSyncPool(pool);
              setActivePanel('sync');
            }}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            {hasSynced ? 'Re-sync' : 'Sync'}
          </button>
        </div>

        <div className="space-y-3">
          {timeline.current5h &&
            renderPoolWindowBlock(
              timeline.current5h,
              pool,
              '5h',
              isGemini ? 'bg-sky-400' : 'bg-orange-400',
              isGemini ? 'text-sky-300' : 'text-orange-300',
            )}
          {timeline.currentWeekly &&
            renderPoolWindowBlock(
              timeline.currentWeekly,
              pool,
              'weekly',
              isGemini ? 'bg-indigo-400' : 'bg-amber-400',
              isGemini ? 'text-indigo-300' : 'text-amber-300',
            )}
        </div>
      </div>
    );
  };

  const autoSyncEnabled = config.autoSyncOfficialResets ?? true;
  const cycle5hCount =
    poolView === 'gemini' && pools?.gemini
      ? pools.gemini.fiveHourCycles.length
      : poolView === 'claude_gpt' && pools?.claude_gpt
        ? pools.claude_gpt.fiveHourCycles.length
        : fiveHourCycles.length;
  const cycleWeeklyCount =
    poolView === 'gemini' && pools?.gemini
      ? pools.gemini.weeklyCycles.length
      : poolView === 'claude_gpt' && pools?.claude_gpt
        ? pools.claude_gpt.weeklyCycles.length
        : weeklyCycles.length;

  return (
    <div className="space-y-5">
      {/* Action Toolbar: Sync Official Feed, Auto-Sync Toggle, Sync Timer, Log Server Reset, Mark Hit Limit */}
      <section className="surface-card rounded-xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-[var(--accent-primary)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Quota Reset Controls &amp; Server Cutlines
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Independent per-pool clocks + confirmed Google server resets from{' '}
                <a
                  href="https://geminireset.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-primary)] hover:underline"
                >
                  geminireset.com
                </a>{' '}
                /{' '}
                <a
                  href="https://antigravityreset.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-primary)] hover:underline"
                >
                  antigravityreset.com
                </a>
                {config.lastFeedSyncAt && (
                  <span className="mono-num text-[11px] text-[var(--text-muted)]">
                    {' '}
                    · Last synced {formatDateTime(config.lastFeedSyncAt)}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {notice && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-2 py-1 text-xs font-medium text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                {notice}
              </span>
            )}
            {errorMsg && (
              <span className="rounded-md bg-rose-500/12 px-2 py-1 text-xs text-rose-400">
                {errorMsg}
              </span>
            )}
            <label
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none hover:text-[var(--text-primary)]"
              title="Automatically fetch confirmed Google server resets from geminireset.com/feed.xml on server startup"
            >
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                disabled={saving}
                onChange={handleToggleAutoSync}
                className="h-3.5 w-3.5 accent-[var(--accent-primary)] cursor-pointer"
              />
              Auto-sync on startup
            </label>
            <button
              type="button"
              disabled={syncingFeed}
              onClick={() => void handleSyncOfficialFeed()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50"
              title="Fetch confirmed Google Antigravity server resets from geminireset.com/feed.xml"
            >
              {syncingFeed ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5" />
              )}
              Sync Official Resets
            </button>
            <button
              type="button"
              onClick={() => setActivePanel((p) => (p === 'sync' ? 'none' : 'sync'))}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                activePanel === 'sync'
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync Reset Timer
            </button>
            <button
              type="button"
              onClick={() => {
                setResetTimestamp(toLocalDateTimeInput(new Date()));
                setActivePanel((p) => (p === 'serverReset' ? 'none' : 'serverReset'));
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                activePanel === 'serverReset'
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              Log Server Reset
            </button>
            <button
              type="button"
              onClick={() => {
                setHitTimestamp(toLocalDateTimeInput(new Date()));
                setActivePanel((p) => (p === 'limitHit' ? 'none' : 'limitHit'));
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                activePanel === 'limitHit'
                  ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              <AlertOctagon className="h-3.5 w-3.5" />
              Mark Hit Limit
            </button>
          </div>
        </div>

        {/* Panel 1: Sync Reset Timer (Per-Pool Independent Clocks) */}
        {activePanel === 'sync' && (
          <div className="space-y-3 rounded-lg border border-sky-500/25 bg-[var(--bg-elevated)]/70 p-3.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-muted)]">Target Pool:</span>
                <div className="flex items-center rounded-lg bg-[var(--bg-surface)] p-0.5 border border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setSyncPool('gemini')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer',
                      syncPool === 'gemini'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'text-[var(--text-secondary)] border border-transparent',
                    )}
                  >
                    Gemini Pool
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncPool('claude_gpt')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer',
                      syncPool === 'claude_gpt'
                        ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                        : 'text-[var(--text-secondary)] border border-transparent',
                    )}
                  >
                    Claude &amp; GPT Pool
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleClearSyncedTimers(syncPool)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" /> Reset {syncPool === 'gemini' ? 'Gemini' : 'Claude/GPT'} to Auto
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleClearSyncedTimers()}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <div className="font-semibold text-[var(--text-primary)]">
                  Sync 5-Hour Countdown ({syncPool === 'gemini' ? 'Gemini' : 'Claude & GPT'})
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={sync5hHours}
                    onChange={(e) => setSync5hHours(e.target.value)}
                    className="mono-num w-12 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-right text-[var(--text-primary)]"
                  />
                  <span className="text-[var(--text-muted)]">h</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={sync5hMins}
                    onChange={(e) => setSync5hMins(e.target.value)}
                    className="mono-num w-12 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-right text-[var(--text-primary)]"
                  />
                  <span className="text-[var(--text-muted)]">m</span>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSync5h}
                  className="inline-flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-1 text-xs font-medium text-white hover:opacity-95 cursor-pointer disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  Apply 5h Timer
                </button>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-[var(--text-primary)]">
                  Sync Weekly Countdown ({syncPool === 'gemini' ? 'Gemini' : 'Claude & GPT'})
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={7}
                    value={syncWeekDays}
                    onChange={(e) => setSyncWeekDays(e.target.value)}
                    className="mono-num w-12 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-right text-[var(--text-primary)]"
                  />
                  <span className="text-[var(--text-muted)]">days</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={syncWeekHours}
                    onChange={(e) => setSyncWeekHours(e.target.value)}
                    className="mono-num w-12 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-right text-[var(--text-primary)]"
                  />
                  <span className="text-[var(--text-muted)]">hrs</span>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSyncWeekly}
                  className="inline-flex items-center gap-1 rounded-md bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white hover:opacity-95 cursor-pointer disabled:opacity-50"
                >
                  Apply Weekly Timer
                </button>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-[var(--text-primary)]">
                  Default Weekly Schedule (UTC)
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={weekResetDay}
                    onChange={(e) => setWeekResetDay(Number(e.target.value))}
                    className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
                  >
                    {WEEKDAYS.map((d, idx) => (
                      <option key={d} value={idx}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={weekResetHour}
                    onChange={(e) => setWeekResetHour(Number(e.target.value))}
                    className="mono-num w-14 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-right text-[var(--text-primary)]"
                  />
                  <span className="text-[var(--text-muted)]">:00 UTC</span>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveSchedule}
                  className="rounded-md bg-[var(--accent-primary)] px-2.5 py-1 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
                >
                  Save Schedule
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Panel 2: Log Ad-Hoc Server Reset Cutline */}
        {activePanel === 'serverReset' && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-amber-500/25 bg-[var(--bg-elevated)]/70 p-3.5 text-xs">
            <label className="space-y-1">
              <div className="text-[11px] text-[var(--text-muted)]">Reset Timestamp (local)</div>
              <input
                type="datetime-local"
                value={resetTimestamp}
                onChange={(e) => setResetTimestamp(e.target.value)}
                className="mono-num rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
              />
            </label>
            <label className="space-y-1">
              <div className="text-[11px] text-[var(--text-muted)]">Scope</div>
              <select
                value={resetScope}
                onChange={(e) => setResetScope(e.target.value as ResetScope)}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                <option value="both">Both (5h + Weekly)</option>
                <option value="5h">5-Hour Window Only</option>
                <option value="weekly">Weekly Cycle Only</option>
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-[11px] text-[var(--text-muted)]">Pool</div>
              <select
                value={resetPool}
                onChange={(e) => setResetPool(e.target.value as ResetEventPool)}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                <option value="all">All Pools</option>
                <option value="gemini">Gemini Models</option>
                <option value="claude_gpt">Claude &amp; GPT Models</option>
              </select>
            </label>
            <label className="flex-1 min-w-[180px] space-y-1">
              <div className="text-[11px] text-[var(--text-muted)]">Label / Reason</div>
              <input
                type="text"
                value={resetLabel}
                onChange={(e) => setResetLabel(e.target.value)}
                placeholder="e.g. Google bonus reset"
                className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={handleLogServerReset}
              className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:opacity-95 cursor-pointer disabled:opacity-50"
            >
              Add Cutline
            </button>
          </div>
        )}

        {/* Panel 3: Mark Hit Limit */}
        {activePanel === 'limitHit' && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-rose-500/25 bg-[var(--bg-elevated)]/70 p-3.5 text-xs">
            <label className="space-y-1">
              <div className="text-[11px] text-[var(--text-muted)]">When limit was hit</div>
              <input
                type="datetime-local"
                value={hitTimestamp}
                onChange={(e) => setHitTimestamp(e.target.value)}
                className="mono-num rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
              />
            </label>
            <label className="space-y-1">
              <div className="text-[11px] text-[var(--text-muted)]">Limit Type</div>
              <select
                value={hitScope}
                onChange={(e) => setHitScope(e.target.value as '5h' | 'weekly')}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                <option value="5h">5-Hour Limit</option>
                <option value="weekly">Weekly Limit</option>
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-[11px] text-[var(--text-muted)]">Quota Pool</div>
              <select
                value={hitPool}
                onChange={(e) => setHitPool(e.target.value as QuotaPool)}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                <option value="gemini">Gemini Models</option>
                <option value="claude_gpt">Claude &amp; GPT Models</option>
              </select>
            </label>
            <label className="flex-1 min-w-[160px] space-y-1">
              <div className="text-[11px] text-[var(--text-muted)]">Optional Note</div>
              <input
                type="text"
                value={hitNote}
                onChange={(e) => setHitNote(e.target.value)}
                placeholder="e.g. Hit during swarm run"
                className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={handleLogLimitHit}
              className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95 cursor-pointer disabled:opacity-50"
            >
              Record Limit Hit
            </button>
          </div>
        )}

        {/* Active Server Reset Cutlines & Limit Hit Chips */}
        {(config.customResets.length > 0 || config.limitHits.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[var(--border-subtle)]">
            {config.customResets.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300"
              >
                <span>⚡ {r.label}</span>
                <span className="mono-num text-[10px] text-amber-400/80">
                  ({r.pool === 'all' ? 'all' : r.pool} · {formatDateTime(r.timestamp)})
                </span>
                {r.sourceUrl && (
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-300/75 hover:text-amber-100"
                    title="View announcement on geminireset.com"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteServerReset(r.id)}
                  className="text-amber-300/70 hover:text-amber-200 cursor-pointer"
                  aria-label={`Remove ${r.label}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
            {config.limitHits.map((h) => (
              <span
                key={h.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-300"
              >
                <span>
                  ⛔ Hit {h.scope} ({h.pool === 'gemini' ? 'Gemini' : 'Claude/GPT'})
                </span>
                <span className="mono-num text-[10px] text-rose-400/80">
                  {formatDateTime(h.timestamp)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteLimitHit(h.id)}
                  className="text-rose-300/70 hover:text-rose-200 cursor-pointer"
                  aria-label="Remove limit hit"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Independent Per-Pool Live Cards (Gemini vs Claude & GPT) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {renderPoolCard('gemini')}
        {renderPoolCard('claude_gpt')}
      </section>

      {/* Per-Cycle ECharts History Comparison */}
      <section className="surface-card rounded-xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {cycleView === '5h' ? '5-Hour Quota Cycles' : 'Weekly Quota Cycles'} —{' '}
              {metric === 'cost' ? 'Estimated API Spend' : 'Token Volume'}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {poolView === 'all'
                ? "Combined timeline across Antigravity's two quota pools"
                : poolView === 'gemini'
                  ? 'Independent Gemini Models timeline (Gemini & All-model resets only)'
                  : 'Independent Claude & GPT timeline (unaffected by Gemini-only resets)'}{' '}
              · ⚡ server reset · rose = limit hit · click any bar to filter dashboard
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Cycle View */}
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setCycleView('5h')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer',
                  cycleView === '5h'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] border border-transparent',
                )}
              >
                5-Hour Cycles ({cycle5hCount})
              </button>
              <button
                type="button"
                onClick={() => setCycleView('weekly')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer',
                  cycleView === 'weekly'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] border border-transparent',
                )}
              >
                Weekly Cycles ({cycleWeeklyCount})
              </button>
            </div>

            {/* Pool Filter */}
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              {(
                [
                  { id: 'all', label: 'All Pools' },
                  { id: 'gemini', label: 'Gemini' },
                  { id: 'claude_gpt', label: 'Claude & GPT' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPoolView(p.id)}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium cursor-pointer',
                    poolView === p.id
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                      : 'text-[var(--text-secondary)] border border-transparent',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Metric */}
            <div className="flex items-center rounded-lg bg-[var(--bg-elevated)] p-0.5 border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setMetric('cost')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer',
                  metric === 'cost'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] border border-transparent',
                )}
              >
                Cost ($)
              </button>
              <button
                type="button"
                onClick={() => setMetric('tokens')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer',
                  metric === 'tokens'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] border border-transparent',
                )}
              >
                Tokens
              </button>
            </div>
          </div>
        </div>

        {activeCycles.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
            No reset cycles found.
          </div>
        ) : (
          <div className="h-[310px] w-full">
            <EChart
              key={`${cycleView}-${poolView}`}
              option={chartOption}
              onClick={(params) => {
                const p = params as { data?: { cycle?: ResetCycleSummary } };
                const c = p?.data?.cycle;
                if (c) {
                  onFilterToWindow(
                    c.startAt,
                    c.endAt,
                    `${c.scope === '5h' ? '5h' : 'Week'}: ${c.label}`,
                  );
                }
              }}
            />
          </div>
        )}
      </section>

      {/* Per-Cycle Breakdown Table */}
      <section className="surface-card overflow-hidden rounded-xl">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {cycleView === '5h' ? '5-Hour Reset History' : 'Weekly Reset History'} (
              {activeCycles.length})
            </h3>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            Click any cycle to filter all tabs to that window
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-[var(--bg-elevated)] text-[11px] font-medium text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="px-4 py-2.5">Reset Window</th>
                <th className="px-3 py-2.5 text-right">Combined</th>
                <th className="px-3 py-2.5 text-right">Gemini Pool</th>
                <th className="px-3 py-2.5 text-right">Claude &amp; GPT</th>
                <th className="px-3 py-2.5 text-right">Cache %</th>
                <th className="px-3 py-2.5 text-right">Turns / Chats</th>
                <th className="px-3 py-2.5">Top Model</th>
                <th className="px-3 py-2.5 text-center">Grade</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {activeCycles.map((c) => (
                <tr
                  key={c.id}
                  onClick={() =>
                    onFilterToWindow(
                      c.startAt,
                      c.endAt,
                      `${c.scope === '5h' ? '5h' : 'Week'}: ${c.label}`,
                    )
                  }
                  className={cn(
                    'transition-colors hover:bg-[var(--bg-hover)]/50 cursor-pointer',
                    c.isCurrent && 'bg-emerald-500/5',
                  )}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mono-num font-medium text-[var(--text-primary)]">
                        {c.label}
                      </span>
                      {c.isCurrent && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-400">
                          LIVE
                        </span>
                      )}
                      {c.startedByServerReset && (
                        <span
                          className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[9px] font-medium text-amber-400"
                          title={c.serverResetLabel}
                        >
                          ⚡ Post-Reset
                        </span>
                      )}
                      {c.endedEarlyByServerReset && (
                        <span className="rounded bg-amber-500/12 px-1.5 py-0.2 text-[9px] font-medium text-amber-300">
                          Closed Early
                        </span>
                      )}
                      {c.limitHits.length > 0 && (
                        <span className="rounded bg-rose-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-rose-400">
                          ⛔ Hit Limit
                        </span>
                      )}
                    </div>
                    <div className="mono-num text-[10px] text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {formatDateTime(c.startAt)} → {formatDateTime(c.endAt)}
                    </div>
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right">
                    <div className="font-semibold text-[var(--text-primary)]">
                      {formatUsd(c.combined.cost.totalCost)}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {formatTokens(c.combined.tokens.totalTokens)}
                    </div>
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right">
                    <div className="text-sky-400 font-medium">
                      {formatUsd(c.gemini.cost.totalCost)}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {formatTokens(c.gemini.tokens.totalTokens)}
                    </div>
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right">
                    <div className="text-orange-400 font-medium">
                      {formatUsd(c.claudeGpt.cost.totalCost)}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {formatTokens(c.claudeGpt.tokens.totalTokens)}
                    </div>
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-emerald-400">
                    {c.combined.tokenSteps > 0
                      ? formatPercent(c.combined.tokens.cacheHitRatio)
                      : '—'}
                  </td>
                  <td className="mono-num px-3 py-2.5 text-right text-[var(--text-secondary)]">
                    {formatNumber(c.combined.tokenSteps)} / {c.combined.conversations}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
                    {c.combined.topModel
                      ? formatModelLabel(c.combined.topModel, pricing.models)
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {c.combined.tokenSteps > 0 ? (
                      <span
                        className={cn(
                          'mono-num rounded border px-1.5 py-0.5 text-[10px] font-bold',
                          getGradeBadgeClass(c.efficiencyGrade),
                        )}
                      >
                        {c.efficiencyGrade}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1 rounded bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-medium text-[var(--accent-primary)] border border-[var(--border-subtle)]">
                      <Filter className="h-2.5 w-2.5" /> Filter
                    </span>
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
