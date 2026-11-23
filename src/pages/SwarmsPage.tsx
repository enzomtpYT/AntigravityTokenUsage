import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from '../components/EChart';
import {
  Bot,
  Clock,
  Coins,
  ExternalLink,
  GitBranch,
  Layers,
  Network,
  Users,
} from 'lucide-react';
import { EChart, useChartTheme } from '../components/EChart';
import { KpiCard } from '../components/KpiCard';
import type { DashboardPayload } from '../shared/types';
import {
  cn,
  formatDuration,
  formatModelLabel,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  formatUsd,
} from '../utils/format';
import { escapeHtml, sanitizeCssColor } from '../utils/sanitize';

export interface SwarmsPageProps {
  data: DashboardPayload;
  onSelectConversation: (conversationId: string) => void;
}

export function SwarmsPage({ data, onSelectConversation }: SwarmsPageProps) {
  const { swarmAnalytics, pricing } = data;
  const theme = useChartTheme();
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    () => swarmAnalytics.sessions[0]?.rootId ?? '',
  );

  const activeSession = useMemo(() => {
    return (
      swarmAnalytics.sessions.find((s) => s.rootId === selectedSessionId) ??
      swarmAnalytics.sessions[0] ??
      null
    );
  }, [swarmAnalytics.sessions, selectedSessionId]);

  const maxConcurrencyAcrossAll = useMemo(
    () => swarmAnalytics.sessions.reduce((m, s) => Math.max(m, s.maxConcurrency), 0),
    [swarmAnalytics.sessions],
  );

  // Build ECharts Gantt Waterfall Timeline option for activeSession
  const ganttOption = useMemo<EChartsCoreOption>(() => {
    if (!activeSession || activeSession.spans.length === 0) return {};
    const spans = activeSession.spans;
    const minStart = Math.min(...spans.map((s) => s.startMs));
    const maxEnd = Math.max(...spans.map((s) => s.endMs));
    const totalRange = Math.max(maxEnd - minStart, 1000);

    const categories = spans.map((s, i) =>
      s.isRoot ? `Coordinator` : `@${s.agentName} #${i}`,
    );

    const chartData = spans.map((s, idx) => ({
      name: s.title,
      value: [idx, s.startMs - minStart, s.endMs - minStart, s.endMs - s.startMs],
      itemStyle: { color: s.color },
      span: s,
    }));

    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.textPrimary, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as {
            data?: { span?: (typeof spans)[number] };
          };
          const s = p.data?.span;
          if (!s) return '';
          const dur = s.endMs - s.startMs;
          const offset = s.startMs - minStart;
          const roleLbl = s.isRoot ? 'Coordinator' : `@${escapeHtml(s.agentName)}`;
          const safeSecondary = sanitizeCssColor(theme.textSecondary);
          const safeMuted = sanitizeCssColor(theme.textMuted);
          return `<div style="max-width:300px;">
            <div style="font-weight:600;margin-bottom:3px;">${roleLbl} — ${escapeHtml(s.title || 'Subagent')}</div>
            <div style="font-size:11px;color:${safeSecondary};margin-bottom:6px;">Model: ${escapeHtml(formatModelLabel(s.model, pricing.models))}</div>
            <div style="font-family:monospace;font-size:11px;display:grid;gap:2px;">
              <div>Offset: +${escapeHtml(formatDuration(offset))} · Duration: <b>${escapeHtml(formatDuration(dur))}</b></div>
              <div>Spend: <b style="color:#34d399;">${escapeHtml(formatUsd(s.cost))}</b> · Tokens: ${escapeHtml(formatTokens(s.tokens))}</div>
              <div>Steps: ${escapeHtml(formatNumber(s.steps))}${s.errors > 0 ? ` · <span style="color:#f43f5e;">${escapeHtml(s.errors)} errors</span>` : ''}</div>
            </div>
            <div style="margin-top:5px;font-size:10px;color:${safeMuted};">Click bar to open Conversation Inspector</div>
          </div>`;
        },
      },
      grid: {
        top: 16,
        left: 14,
        right: 24,
        bottom: 44,
        containLabel: true,
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'weakFilter' },
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'weakFilter',
          height: 18,
          bottom: 6,
          borderColor: theme.borderSubtle,
          fillerColor: 'rgba(99, 102, 241, 0.16)',
          handleStyle: { color: '#6366f1' },
          textStyle: { color: theme.textMuted, fontSize: 10 },
        },
      ],
      xAxis: {
        type: 'value',
        min: 0,
        max: totalRange,
        splitLine: { lineStyle: { color: theme.gridLine, type: 'dashed' } },
        axisLabel: {
          color: theme.textMuted,
          fontSize: 11,
          formatter: (v: number) => `+${formatDuration(v)}`,
        },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: categories,
        axisLine: { lineStyle: { color: theme.gridLine } },
        axisTick: { show: false },
        axisLabel: { color: theme.textPrimary, fontSize: 11, fontFamily: 'monospace' },
      },
      series: [
        {
          type: 'custom',
          renderItem: (
            params: { coordSys: { x: number; y: number; width: number; height: number } },
            api: {
              value: (i: number) => number;
              coord: (val: [number, number]) => [number, number];
              size: (val: [number, number]) => [number, number];
              style: () => Record<string, unknown>;
            },
          ) => {
            const categoryIndex = api.value(0);
            const start = api.coord([api.value(1), categoryIndex]);
            const end = api.coord([api.value(2), categoryIndex]);
            const height = Math.min(22, api.size([0, 1])[1] * 0.62);
            const width = Math.max(6, end[0] - start[0]);
            const x = Math.max(params.coordSys.x, start[0]);
            const clippedWidth = Math.min(width, params.coordSys.x + params.coordSys.width - x);
            if (clippedWidth <= 0) return null;
            return {
              type: 'rect',
              shape: {
                x,
                y: start[1] - height / 2,
                width: clippedWidth,
                height,
                r: 4,
              },
              style: api.style(),
            };
          },
          encode: { x: [1, 2], y: 0 },
          data: chartData,
        },
      ],
    };
  }, [activeSession, pricing.models, theme]);

  // Agent Role Leaderboard Bar Chart
  const roleChartOption = useMemo<EChartsCoreOption>(() => {
    const roles = swarmAnalytics.roleStats.slice(0, 12).reverse();
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
          const r = roles[(arr[0] as { dataIndex: number }).dataIndex];
          if (!r) return '';
          return `<div style="font-weight:600;margin-bottom:4px;">@${escapeHtml(r.role)}</div>
            <div style="font-family:monospace;font-size:11px;">Spend: <b>${escapeHtml(formatUsd(r.cost.totalCost))}</b> · Tokens: ${escapeHtml(formatTokens(r.tokens.totalTokens))}</div>
            <div style="font-family:monospace;font-size:11px;">Runs: ${escapeHtml(r.conversationCount)} · Steps: ${escapeHtml(r.steps)} · Active: ${escapeHtml(formatDuration(r.activeDurationMs))}</div>`;
        },
      },
      grid: { top: 8, left: 12, right: 20, bottom: 8, containLabel: true },
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
        data: roles.map((r) => `@${r.role}`),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 11, fontFamily: 'monospace' },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          data: roles.map((r, i) => ({
            value: r.cost.totalCost,
            itemStyle: {
              color: ['#6366f1', '#38bdf8', '#34d399', '#a78bfa', '#fbbf24', '#fb923c'][i % 6],
              borderRadius: [0, 4, 4, 0],
            },
          })),
        },
      ],
    };
  }, [swarmAnalytics.roleStats, theme]);

  return (
    <div className="space-y-5">
      {/* Swarm KPI Strip */}
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title="Multi-Agent Sessions"
          value={formatNumber(swarmAnalytics.swarmSessionCount)}
          accentColor="#6366f1"
          icon={<Network className="h-4 w-4" />}
          subtitle={<span>Parent chats with ≥1 subagent</span>}
        />
        <KpiCard
          title="Total Subagents"
          value={formatNumber(swarmAnalytics.totalSubagents)}
          accentColor="#38bdf8"
          icon={<Bot className="h-4 w-4" />}
          subtitle={
            <span>
              <strong className="mono-num text-[var(--text-primary)]">{swarmAnalytics.roleStats.length}</strong> distinct roles
            </span>
          }
        />
        <KpiCard
          title="Avg Fan-Out Factor"
          value={`${swarmAnalytics.avgFanOut.toFixed(1)}x`}
          accentColor="#a78bfa"
          icon={<GitBranch className="h-4 w-4" />}
          subtitle={<span>Subagents spawned per swarm</span>}
        />
        <KpiCard
          title="Subagent Spend Share"
          value={formatPercent(swarmAnalytics.subagentCostShare)}
          accentColor="#f59e0b"
          icon={<Coins className="h-4 w-4" />}
          subtitle={
            <span className="mono-num">
              {formatUsd(swarmAnalytics.subagentCost)} sub · {formatUsd(swarmAnalytics.parentCost)} main
            </span>
          }
        />
        <KpiCard
          title="Peak Parallel Agents"
          value={formatNumber(maxConcurrencyAcrossAll)}
          accentColor="#34d399"
          icon={<Users className="h-4 w-4" />}
          subtitle={<span>Max overlapping workers</span>}
        />
      </section>

      {/* Interactive Swarm Gantt Waterfall */}
      <section className="surface-card rounded-xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Swarm & Subagent Execution Gantt Waterfall
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Horizontal execution timeline showing coordinator and parallel worker overlap · click any bar to inspect
            </p>
          </div>

          {swarmAnalytics.sessions.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={activeSession?.rootId ?? ''}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="max-w-[320px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] outline-none cursor-pointer"
              >
                {swarmAnalytics.sessions.map((s) => (
                  <option key={s.rootId} value={s.rootId} className="bg-[var(--bg-surface)]">
                    {s.title || 'Untitled'} ({s.subagentCount} sub · {formatUsd(s.totalCost)})
                  </option>
                ))}
              </select>
              {activeSession && (
                <button
                  type="button"
                  onClick={() => onSelectConversation(activeSession.rootId)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-primary)] hover:border-[var(--border-strong)] cursor-pointer"
                >
                  Inspect Root
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {!activeSession ? (
          <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
            No multi-agent or swarm sessions match the current filters.
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg bg-[var(--bg-elevated)]/60 px-3 py-2 text-xs border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)]">
                Workspace: <strong className="text-[var(--text-primary)]">{activeSession.projectDisplayName}</strong>
              </span>
              <span className="mono-num text-[var(--text-muted)]">
                Total Span: <strong className="text-[var(--text-primary)]">{formatDuration(activeSession.totalDurationMs)}</strong>
              </span>
              <span className="mono-num text-[var(--text-muted)]">
                Peak Concurrency: <strong className="text-emerald-400">{activeSession.maxConcurrency}x</strong>
              </span>
              <span className="mono-num text-[var(--text-muted)]">
                Parent: <strong className="text-[var(--text-primary)]">{formatUsd(activeSession.parentCost)}</strong> · Subagents:{' '}
                <strong className="text-indigo-400">{formatUsd(activeSession.childrenCost)}</strong>
              </span>
            </div>

            <div
              className="w-full"
              style={{ height: `${Math.max(240, Math.min(480, activeSession.spans.length * 36 + 90))}px` }}
            >
              <EChart
                option={ganttOption}
                onClick={(params) => {
                  const p = params as { data?: { span?: { id?: string } } };
                  if (p?.data?.span?.id) {
                    onSelectConversation(p.data.span.id);
                  }
                }}
              />
            </div>
          </>
        )}
      </section>

      {/* Agent Roles + Multi-Agent Sessions */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Agent Role Leaderboard */}
        <div className="surface-card rounded-xl p-4 sm:p-5 xl:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Spend by Agent Role
              </h3>
            </div>
            <span className="mono-num text-xs text-[var(--text-muted)]">
              {swarmAnalytics.roleStats.length} roles
            </span>
          </div>

          {swarmAnalytics.roleStats.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-xs text-[var(--text-muted)]">
              No subagent roles recorded.
            </div>
          ) : (
            <>
              <div className="h-[240px] w-full">
                <EChart option={roleChartOption} />
              </div>
              <div className="mt-3 max-h-[220px] overflow-y-auto divide-y divide-[var(--border-subtle)] text-xs">
                {swarmAnalytics.roleStats.map((r) => (
                  <div key={r.role} className="flex items-center justify-between py-2">
                    <div>
                      <span className="font-mono font-medium text-indigo-400">@{r.role}</span>
                      <span className="ml-2 text-[11px] text-[var(--text-muted)]">
                        {r.conversationCount} {r.conversationCount === 1 ? 'run' : 'runs'} · {formatNumber(r.steps)} steps
                      </span>
                    </div>
                    <div className="mono-num text-right">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {formatUsd(r.cost.totalCost)}
                      </span>
                      <span className="ml-2 text-[11px] text-[var(--text-muted)]">
                        {formatTokens(r.tokens.totalTokens)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Multi-Agent Sessions Breakdown Table */}
        <div className="surface-card overflow-hidden rounded-xl xl:col-span-7">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Parent vs. Subagent Cost Breakdown
              </h3>
            </div>
            <span className="text-xs text-[var(--text-muted)]">Click row to load Gantt</span>
          </div>

          {swarmAnalytics.sessions.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)]">
              No swarm sessions in this window.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[var(--bg-elevated)] text-[11px] font-medium text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="px-3.5 py-2.5">Session</th>
                    <th className="px-3 py-2.5 text-right">Workers</th>
                    <th className="px-3 py-2.5 text-right">Parent</th>
                    <th className="px-3 py-2.5 text-right">Subagents</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {swarmAnalytics.sessions.map((s) => {
                    const selected = activeSession?.rootId === s.rootId;
                    const subShare = s.totalCost > 0 ? (s.childrenCost / s.totalCost) * 100 : 0;
                    return (
                      <tr
                        key={s.rootId}
                        onClick={() => setSelectedSessionId(s.rootId)}
                        className={cn(
                          'transition-colors hover:bg-[var(--bg-hover)]/50 cursor-pointer',
                          selected && 'bg-[var(--accent-primary)]/10',
                        )}
                      >
                        <td className="px-3.5 py-2.5">
                          <div className="font-medium text-[var(--text-primary)] truncate max-w-[230px]">
                            {s.title || 'Untitled Session'}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                            <span className="truncate max-w-[130px]">{s.projectDisplayName}</span>
                            <span>·</span>
                            <span>{formatRelativeTime(s.lastStepAt)}</span>
                          </div>
                          {/* Parent vs Child mini ratio bar */}
                          <div className="mt-1.5 flex h-1 w-32 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                            <div
                              style={{ width: `${100 - subShare}%` }}
                              className="bg-sky-400"
                              title={`Parent: ${(100 - subShare).toFixed(0)}%`}
                            />
                            <div
                              style={{ width: `${subShare}%` }}
                              className="bg-indigo-500"
                              title={`Subagents: ${subShare.toFixed(0)}%`}
                            />
                          </div>
                        </td>
                        <td className="mono-num px-3 py-2.5 text-right">
                          <span className="rounded bg-indigo-500/12 px-1.5 py-0.5 text-[11px] font-medium text-indigo-400">
                            {s.subagentCount} ({s.maxConcurrency}x)
                          </span>
                        </td>
                        <td className="mono-num px-3 py-2.5 text-right text-[var(--text-secondary)]">
                          {formatUsd(s.parentCost)}
                        </td>
                        <td className="mono-num px-3 py-2.5 text-right text-indigo-400 font-medium">
                          {formatUsd(s.childrenCost)}
                        </td>
                        <td className="mono-num px-3 py-2.5 text-right font-semibold text-[var(--text-primary)]">
                          {formatUsd(s.totalCost)}
                        </td>
                        <td className="mono-num px-3 py-2.5 text-right text-[var(--text-muted)]">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(s.totalDurationMs)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
