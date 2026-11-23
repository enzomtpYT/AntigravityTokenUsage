import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ModelPricing } from '../shared/types';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatUsd(
  value: number,
  options?: { compact?: boolean; decimals?: number },
): string {
  const safe = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? '-' : '';

  if (abs === 0) return '$0.00';

  if (options?.compact) {
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}k`;
  }

  if (options?.decimals !== undefined) {
    return `${sign}$${abs.toLocaleString('en-US', {
      minimumFractionDigits: options.decimals,
      maximumFractionDigits: options.decimals,
    })}`;
  }

  if (abs < 0.01) {
    return `${sign}$${abs.toFixed(4)}`;
  }

  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatTokens(
  value: number,
  options?: { compact?: boolean },
): string {
  const safe = Number.isFinite(value) ? value : 0;
  const compact = options?.compact ?? true;
  if (!compact) {
    return Math.round(safe).toLocaleString('en-US');
  }

  const abs = Math.abs(safe);
  const sign = safe < 0 ? '-' : '';

  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 100_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return Math.round(safe).toLocaleString('en-US');
}

export function formatPercent(ratio: number, decimals = 1): string {
  const safe = Number.isFinite(ratio) ? ratio : 0;
  return `${(safe * 100).toFixed(decimals)}%`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';

  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'Just now';

  const sec = Math.floor(diffMs / 1000);
  if (sec < 10) return 'Just now';
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  const totalSec = ms / 1000;
  if (totalSec < 1) return `${Math.round(ms)}ms`;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = Math.round(totalSec % 60);
  if (totalMin < 60) return remSec > 0 ? `${totalMin}m ${remSec}s` : `${totalMin}m`;
  const hrs = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return remMin > 0 ? `${hrs}h ${remMin}m` : `${hrs}h`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatMultiplier(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '0.0x';
  return `${value.toFixed(1)}x`;
}

export function getGradeBadgeClass(grade: string): string {
  switch (grade) {
    case 'S':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'A':
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    case 'B':
      return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
    case 'C':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    default:
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  }
}

const FALLBACK_MODEL_COLORS = [
  '#60a5fa',
  '#34d399',
  '#fb923c',
  '#a78bfa',
  '#38bdf8',
  '#f472b6',
  '#fbbf24',
  '#22d3ee',
];

export function formatModelLabel(
  modelId: string | null | undefined,
  models?: Record<string, ModelPricing>,
): string {
  if (!modelId) return 'Unknown';
  const found = models?.[modelId];
  if (found?.label) return found.label;
  return modelId;
}

export function getModelColor(
  modelId: string,
  models?: Record<string, ModelPricing>,
): string {
  const found = models?.[modelId];
  if (found?.color) return found.color;
  let hash = 0;
  for (let i = 0; i < modelId.length; i++) {
    hash = (hash * 31 + modelId.charCodeAt(i)) | 0;
  }
  return FALLBACK_MODEL_COLORS[Math.abs(hash) % FALLBACK_MODEL_COLORS.length];
}
