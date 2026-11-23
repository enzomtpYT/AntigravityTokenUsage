import type { DashboardPayload } from '../shared/types';

const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Neutralize spreadsheet formula injection (DDE/CSV injection)
  if (FORMULA_TRIGGER_RE.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function exportProjectsCsv(data: DashboardPayload): void {
  const headers = [
    'Project',
    'Workspace Path',
    'Main Conversations',
    'Subagents',
    'Rolled-Up Total Tokens',
    'Uncached Input',
    'Cache Read',
    'Output',
    'Cache Hit Ratio',
    'Rolled-Up Cost (USD)',
    'Cache Savings (USD)',
    'Active Duration (ms)',
    'Cache Miss Spikes',
    'Cache Miss Waste (USD)',
    'Errors',
    'Error Cost (USD)',
    'Primary Model',
    'Last Active',
  ];
  const rows = data.projects.map((p) => [
    p.displayName,
    p.workspacePath ?? '',
    p.conversationCount,
    p.subagentCount,
    p.rolledUp.tokens.totalTokens,
    p.rolledUp.tokens.uncachedInput,
    p.rolledUp.tokens.cacheRead,
    p.rolledUp.tokens.output,
    p.rolledUp.tokens.cacheHitRatio.toFixed(4),
    p.rolledUp.cost.totalCost.toFixed(6),
    p.rolledUp.cost.cacheSavings.toFixed(6),
    p.activeDurationMs,
    p.cacheMissSpikes,
    p.cacheMissWastedCost.toFixed(6),
    p.errorCount,
    p.errorCost.toFixed(6),
    p.primaryModel ?? '',
    p.lastActiveAt ?? '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escapeCsvCell).join(',')).join('\n');
  downloadFile(`antigravity-projects-${timestampSlug()}.csv`, csv, 'text/csv;charset=utf-8;');
}

export function exportConversationsCsv(data: DashboardPayload): void {
  const headers = [
    'ID',
    'Title',
    'Project',
    'Agent Name',
    'Parent ID',
    'Subagents',
    'Steps',
    'Direct Tokens',
    'Rolled-Up Tokens',
    'Cache Hit Ratio',
    'Direct Cost (USD)',
    'Rolled-Up Cost (USD)',
    'Cache Savings (USD)',
    'Models',
    'Has Fallback Steps',
    'Manual Model Override',
    'Errors',
    'Error Cost (USD)',
    'Cache Miss Spikes',
    'Active Duration (ms)',
    'Last Activity',
  ];
  const rows = data.conversations.map((c) => [
    c.id,
    c.title,
    c.projectDisplayName,
    c.agentName ?? '',
    c.parentConversationId ?? '',
    c.subagentCount,
    c.direct.stepCount,
    c.direct.tokens.totalTokens,
    c.rolledUp.tokens.totalTokens,
    c.rolledUp.tokens.cacheHitRatio.toFixed(4),
    c.direct.cost.totalCost.toFixed(6),
    c.rolledUp.cost.totalCost.toFixed(6),
    c.rolledUp.cost.cacheSavings.toFixed(6),
    c.modelsUsed.join(';'),
    c.hasFallbackSteps,
    c.manualModelOverride ?? '',
    c.errorCount,
    c.errorCost.toFixed(6),
    c.cacheMissSpikes,
    c.activeDurationMs,
    c.lastStepAt ?? c.lastModifiedTime ?? '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escapeCsvCell).join(',')).join('\n');
  downloadFile(`antigravity-conversations-${timestampSlug()}.csv`, csv, 'text/csv;charset=utf-8;');
}

export function exportModelsCsv(data: DashboardPayload): void {
  const headers = [
    'Model ID',
    'Label',
    'Provider',
    'Is Fallback',
    'Steps',
    'Conversations',
    'Uncached Input',
    'Cache Read',
    'Output',
    'Total Tokens',
    'Cache Hit Ratio',
    'Total Cost (USD)',
    'Cache Savings (USD)',
    'Median Latency (ms)',
    'Cache Miss Spikes',
    'Long Context Steps',
    'Errors',
    'Error Cost (USD)',
  ];
  const rows = data.models.map((m) => [
    m.modelId,
    m.label,
    m.provider,
    m.isFallback,
    m.steps,
    m.conversations,
    m.tokens.uncachedInput,
    m.tokens.cacheRead,
    m.tokens.output,
    m.tokens.totalTokens,
    m.tokens.cacheHitRatio.toFixed(4),
    m.cost.totalCost.toFixed(6),
    m.cost.cacheSavings.toFixed(6),
    m.medianLatencyMs ?? '',
    m.cacheMissSpikes,
    m.longContextSteps,
    m.errorCount,
    m.errorCost.toFixed(6),
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escapeCsvCell).join(',')).join('\n');
  downloadFile(`antigravity-models-${timestampSlug()}.csv`, csv, 'text/csv;charset=utf-8;');
}

export function exportDashboardJson(data: DashboardPayload): void {
  downloadFile(
    `antigravity-usage-snapshot-${timestampSlug()}.json`,
    JSON.stringify(data, null, 2),
    'application/json;charset=utf-8;',
  );
}
