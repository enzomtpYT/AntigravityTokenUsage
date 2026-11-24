import type {
  CostTotals,
  CustomResetMarker,
  LimitHitMarker,
  ModelPricing,
  ModelProvider,
  PricingConfig,
  QuotaPool,
  ResetScheduleConfig,
  StepCostBreakdown,
  SubscriptionRoi,
  TokenTotals,
  WhatIfComparison,
} from './types';

export const DEFAULT_FALLBACK_MODEL_ID = 'gemini-3.8-flash';
export const DEFAULT_LONG_CONTEXT_THRESHOLD = 200_000;
export const DEFAULT_LONG_CONTEXT_INPUT_MULTIPLIER = 2.0;
export const DEFAULT_LONG_CONTEXT_OUTPUT_MULTIPLIER = 1.5;
export const DEFAULT_MONTHLY_SUBSCRIPTION_USD = 20;

/**
 * Official public API pricing table (USD per 1,000,000 tokens, Standard Paid Tier).
 *
 * Sources:
 *   - Google Gemini Developer API: https://aistudio.google.com/docs/pricing.md (via llms.txt)
 *   - Antigravity supported models: https://antigravity.google/docs/models/
 *   - Anthropic Claude API: https://platform.claude.com/docs/en/about-claude/pricing
 *
 * Verified token semantics from `~/.gemini/antigravity` transcripts:
 *   - `input_tokens` is UNCACHED (fresh) input tokens
 *   - `cache_read_tokens` is SEPARATE cached input tokens
 *   - `totalContext = input_tokens + cache_read_tokens`
 *   - `apiCost = (input * inputPer1M + cacheRead * cacheReadPer1M + output * outputPer1M) / 1e6`
 *   - `cacheSavings = (cacheRead * (inputPer1M - cacheReadPer1M)) / 1e6`
 */
export const DEFAULT_MODELS: Record<string, ModelPricing> = {
  // --- Antigravity Google Gemini 4 & 3.x Models (Official Google AI Studio Rates) ---
  'gemini-4-neon-xhigh': {
    id: 'gemini-4-neon-xhigh',
    label: 'Gemini 4 Neon (Extra)',
    provider: 'google',
    inputPer1M: 3.0,
    cacheReadPer1M: 0.15,
    outputPer1M: 15.0,
    color: '#6366f1',
    note: 'Official Gemini 4 Neon Standard API ($3 / $0.15 cache / $15)',
  },
  'gemini-4-neon-high': {
    id: 'gemini-4-neon-high',
    label: 'Gemini 4 Neon (High)',
    provider: 'google',
    inputPer1M: 3.0,
    cacheReadPer1M: 0.15,
    outputPer1M: 15.0,
    color: '#60a5fa',
    note: 'Official Gemini 4 Neon Standard API ($3 / $0.15 cache / $15)',
  },
  'gemini-4-neon-medium': {
    id: 'gemini-4-neon-medium',
    label: 'Gemini 4 Neon (Medium)',
    provider: 'google',
    inputPer1M: 3.0,
    cacheReadPer1M: 0.15,
    outputPer1M: 15.0,
    color: '#38bdf8',
    note: 'Official Gemini 4 Neon Standard API ($3 / $0.15 cache / $15)',
  },
  'gemini-4-neon-low': {
    id: 'gemini-4-neon-low',
    label: 'Gemini 4 Neon (Low)',
    provider: 'google',
    inputPer1M: 3.0,
    cacheReadPer1M: 0.15,
    outputPer1M: 15.0,
    color: '#22d3ee',
    note: 'Official Gemini 4 Neon Standard API ($3 / $0.15 cache / $15)',
  },
  'gemini-pro-orchestrator-neon': {
    id: 'gemini-pro-orchestrator-neon',
    label: 'Gemini Pro Orchestrator (Neon)',
    provider: 'google',
    inputPer1M: 3.0,
    cacheReadPer1M: 0.15,
    outputPer1M: 15.0,
    color: '#818cf8',
    note: 'Orchestrator Neon planner ($3 / $0.15 cache / $15)',
  },
  'gemini-4-carbon': {
    id: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon',
    provider: 'google',
    inputPer1M: 2.0,
    cacheReadPer1M: 0.1,
    outputPer1M: 10.0,
    color: '#a855f7',
    note: 'Official Gemini 4 Carbon intro rate thru Nov 30, 2026 ($4 / $0.20 / $20 Dec 1)',
  },
  'gemini-4-argon': {
    id: 'gemini-4-argon',
    label: 'Gemini 4 Argon',
    provider: 'google',
    inputPer1M: 2.0,
    cacheReadPer1M: 0.1,
    outputPer1M: 10.0,
    color: '#8b5cf6',
    note: 'Official Gemini 4 Argon intro rate thru Nov 30, 2026 ($4 / $0.20 / $20 Dec 1)',
  },
  'gemini-4-hydrogen-tiered-high': {
    id: 'gemini-4-hydrogen-tiered-high',
    label: 'Gemini 4 Hydrogen (High)',
    provider: 'google',
    inputPer1M: 1.5,
    cacheReadPer1M: 0.075,
    outputPer1M: 7.5,
    color: '#f472b6',
    note: 'Official Gemini 4 Hydrogen Standard API ($1.50 / $0.075 cache / $7.50)',
  },
  'gemini-4-hydrogen': {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    provider: 'google',
    inputPer1M: 1.5,
    cacheReadPer1M: 0.075,
    outputPer1M: 7.5,
    color: '#ec4899',
    note: 'Official Gemini 4 Hydrogen Standard API ($1.50 / $0.075 cache / $7.50)',
  },
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    provider: 'google',
    inputPer1M: 0.75,
    cacheReadPer1M: 0.075,
    outputPer1M: 3.75,
    color: '#14b8a6',
    note: 'Default untagged fallback · Official thru Dec 31, 2026 ($1.50 / $0.15 / $7.50 Jan 1)',
  },
  'gemini-3.7-flash': {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    provider: 'google',
    inputPer1M: 0.75,
    cacheReadPer1M: 0.075,
    outputPer1M: 3.75,
    color: '#2dd4bf',
    note: 'Antigravity Flash tier ($0.75 / $0.075 cache / $3.75)',
  },
  'gemini-3.6-flash': {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    provider: 'google',
    inputPer1M: 0.75,
    cacheReadPer1M: 0.075,
    outputPer1M: 3.75,
    color: '#0d9488',
    note: 'Official Gemini 3.6 Flash thru Dec 31, 2026 ($1.50 / $0.15 / $7.50 Jan 1)',
  },
  'gemini-flash-worker-agy': {
    id: 'gemini-flash-worker-agy',
    label: 'Gemini Flash Worker',
    provider: 'google',
    inputPer1M: 0.75,
    cacheReadPer1M: 0.075,
    outputPer1M: 3.75,
    color: '#34d399',
    note: 'Antigravity Flash worker (Gemini 3.8 Flash Standard rate)',
  },
  'gemini-3.1-pro': {
    id: 'gemini-3.1-pro',
    label: 'Gemini 3.1 Pro',
    provider: 'google',
    inputPer1M: 2.0,
    cacheReadPer1M: 0.2,
    outputPer1M: 12.0,
    color: '#2563eb',
    note: 'Official Gemini 3.1 Pro <=200k ($4 / $0.40 / $18 >200k)',
  },

  // --- Antigravity Anthropic Claude & Partner Models (Official Claude API Rates) ---
  'claude-opus-5-5-low': {
    id: 'claude-opus-5-5-low',
    label: 'Claude Opus 5.5 (Low)',
    provider: 'anthropic',
    inputPer1M: 4.0,
    cacheReadPer1M: 0.2,
    outputPer1M: 20.0,
    color: '#fb923c',
    note: 'Official Claude Opus 5.5 API ($4 / $0.20 cache / $20)',
  },
  'claude-opus-5-5': {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    provider: 'anthropic',
    inputPer1M: 4.0,
    cacheReadPer1M: 0.2,
    outputPer1M: 20.0,
    color: '#f97316',
    isReference: true,
    note: 'Official Claude Opus 5.5 API ($4 / $0.20 cache / $20)',
  },
  'claude-sonnet-5-5': {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    provider: 'anthropic',
    inputPer1M: 2.0,
    cacheReadPer1M: 0.1,
    outputPer1M: 10.0,
    color: '#fbbf24',
    isReference: true,
    note: 'Official Claude Sonnet 5.5 API ($2 / $0.10 cache / $10)',
  },
  'claude-opus-4-6': {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    provider: 'anthropic',
    inputPer1M: 5.0,
    cacheReadPer1M: 0.5,
    outputPer1M: 25.0,
    color: '#ea580c',
    note: 'Official Claude Opus 4.6 API ($5 / $0.50 cache / $25)',
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    inputPer1M: 3.0,
    cacheReadPer1M: 0.3,
    outputPer1M: 15.0,
    color: '#f59e0b',
    note: 'Official Claude Sonnet 4.6 API ($3 / $0.30 cache / $15)',
  },
  'gpt-oss-120b-medium': {
    id: 'gpt-oss-120b-medium',
    label: 'GPT-OSS 120B (Medium)',
    provider: 'openai',
    inputPer1M: 0.15,
    cacheReadPer1M: 0.04,
    outputPer1M: 0.6,
    color: '#94a3b8',
    note: 'Antigravity open-weight partner model benchmark',
  },

  // --- Reference Public API Models (What-If Simulator) ---
  'gemini-4-neon': {
    id: 'gemini-4-neon',
    label: 'Gemini 4 Neon',
    provider: 'google',
    inputPer1M: 3.0,
    cacheReadPer1M: 0.15,
    outputPer1M: 15.0,
    color: '#6366f1',
    isReference: true,
    note: 'Official Google AI Studio Standard Paid Tier',
  },
  'gemini-4-hydrogen-ref': {
    id: 'gemini-4-hydrogen-ref',
    label: 'Gemini 4 Hydrogen',
    provider: 'google',
    inputPer1M: 1.5,
    cacheReadPer1M: 0.075,
    outputPer1M: 7.5,
    color: '#ec4899',
    isReference: true,
    note: 'Official Google AI Studio Standard Paid Tier',
  },
  'gemini-3.8-flash-ref': {
    id: 'gemini-3.8-flash-ref',
    label: 'Gemini 3.8 Flash',
    provider: 'google',
    inputPer1M: 0.75,
    cacheReadPer1M: 0.075,
    outputPer1M: 3.75,
    color: '#14b8a6',
    isReference: true,
    note: 'Official Google AI Studio Standard Paid Tier (thru Dec 31, 2026)',
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'google',
    inputPer1M: 1.25,
    cacheReadPer1M: 0.125,
    outputPer1M: 10.0,
    color: '#3b82f6',
    isReference: true,
    note: 'Official Google AI Studio (<=200k context tier)',
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'google',
    inputPer1M: 0.3,
    cacheReadPer1M: 0.03,
    outputPer1M: 2.5,
    color: '#10b981',
    isReference: true,
    note: 'Official Google AI Studio Flash tier',
  },
  'claude-fable-5-2': {
    id: 'claude-fable-5-2',
    label: 'Claude Fable 5.2',
    provider: 'anthropic',
    inputPer1M: 8.0,
    cacheReadPer1M: 0.2,
    outputPer1M: 40.0,
    color: '#e11d48',
    isReference: true,
    note: 'Official Claude Fable 5.2 API ($8 / $0.20 cache / $40)',
  },
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    provider: 'anthropic',
    inputPer1M: 0.1,
    cacheReadPer1M: 0.01,
    outputPer1M: 0.5,
    color: '#fb7185',
    isReference: true,
    note: 'Official Claude Haiku 5.5 API (<=100k prompts)',
  },
  'claude-opus-4-5': {
    id: 'claude-opus-4-5',
    label: 'Claude Opus 4.5',
    provider: 'anthropic',
    inputPer1M: 5.0,
    cacheReadPer1M: 0.5,
    outputPer1M: 25.0,
    color: '#f97316',
    note: 'Official Claude Opus 4.5 API ($5 / $0.50 cache / $25)',
  },
  'claude-sonnet-4-5': {
    id: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    inputPer1M: 3.0,
    cacheReadPer1M: 0.3,
    outputPer1M: 15.0,
    color: '#fbbf24',
    note: 'Official Claude Sonnet 4.5 API ($3 / $0.30 cache / $15)',
  },
  'gpt-5': {
    id: 'gpt-5',
    label: 'GPT-5',
    provider: 'openai',
    inputPer1M: 1.25,
    cacheReadPer1M: 0.125,
    outputPer1M: 10.0,
    color: '#a78bfa',
    isReference: true,
    note: 'OpenAI public API with cached input discount (90%)',
  },
};

export function createDefaultResetConfig(): ResetScheduleConfig {
  return {
    fiveHourDurationHours: 5,
    weeklyResetDayUtc: 1, // Monday 00:00 UTC
    weeklyResetHourUtc: 0,
    autoSyncOfficialResets: true,
    syncedNext5hReset: {},
    syncedNextWeeklyReset: {},
    customResets: [],
    limitHits: [],
  };
}

/**
 * Maps a model to Antigravity's two official quota pools:
 *   - `'gemini'`     -> Gemini Models pool
 *   - `'claude_gpt'` -> Claude & GPT Models pool
 */
export function getQuotaPoolForModel(
  modelId: string | null | undefined,
  provider?: ModelProvider,
): QuotaPool {
  if (provider === 'google') return 'gemini';
  if (provider === 'anthropic' || provider === 'openai' || provider === 'deepseek') {
    return 'claude_gpt';
  }
  const lower = (modelId ?? '').toLowerCase();
  if (lower.includes('gemini')) return 'gemini';
  return 'claude_gpt';
}

/**
 * Creates a fresh deep copy of the default PricingConfig.
 */
export function createDefaultPricingConfig(): PricingConfig {
  const models: Record<string, ModelPricing> = {};
  for (const [id, pricing] of Object.entries(DEFAULT_MODELS)) {
    models[id] = { ...pricing };
  }
  return {
    models,
    fallbackModelId: DEFAULT_FALLBACK_MODEL_ID,
    includeUntagged: true,
    longContextEnabled: false,
    longContextThreshold: DEFAULT_LONG_CONTEXT_THRESHOLD,
    longContextInputMultiplier: DEFAULT_LONG_CONTEXT_INPUT_MULTIPLIER,
    longContextOutputMultiplier: DEFAULT_LONG_CONTEXT_OUTPUT_MULTIPLIER,
    monthlySubscriptionUsd: DEFAULT_MONTHLY_SUBSCRIPTION_USD,
    conversationModelOverrides: {},
    resetConfig: createDefaultResetConfig(),
  };
}

/**
 * Safely merges persisted user overrides onto the default PricingConfig.
 */
export function mergePricingConfig(overrides?: Partial<PricingConfig> | null): PricingConfig {
  const base = createDefaultPricingConfig();
  if (!overrides) return base;

  if (overrides.models) {
    for (const [id, override] of Object.entries(overrides.models)) {
      if (!override || typeof override !== 'object') continue;
      const existing = base.models[id];
      base.models[id] = existing
        ? {
            ...existing,
            ...override,
            id,
          }
        : {
            id,
            label: override.label || id,
            provider: override.provider || 'other',
            inputPer1M: Number(override.inputPer1M) || 0,
            cacheReadPer1M: Number(override.cacheReadPer1M) || 0,
            outputPer1M: Number(override.outputPer1M) || 0,
            color: override.color || '#94a3b8',
            isReference: override.isReference,
            note: override.note,
          };
    }
  }

  if (typeof overrides.fallbackModelId === 'string' && overrides.fallbackModelId.trim()) {
    base.fallbackModelId = overrides.fallbackModelId.trim();
  }

  if (typeof overrides.includeUntagged === 'boolean') {
    base.includeUntagged = overrides.includeUntagged;
  }

  if (typeof overrides.longContextEnabled === 'boolean') {
    base.longContextEnabled = overrides.longContextEnabled;
  }

  if (
    typeof overrides.longContextThreshold === 'number' &&
    Number.isFinite(overrides.longContextThreshold) &&
    overrides.longContextThreshold > 0
  ) {
    base.longContextThreshold = overrides.longContextThreshold;
  }

  if (
    typeof overrides.longContextInputMultiplier === 'number' &&
    Number.isFinite(overrides.longContextInputMultiplier) &&
    overrides.longContextInputMultiplier >= 1
  ) {
    base.longContextInputMultiplier = overrides.longContextInputMultiplier;
  }

  if (
    typeof overrides.longContextOutputMultiplier === 'number' &&
    Number.isFinite(overrides.longContextOutputMultiplier) &&
    overrides.longContextOutputMultiplier >= 1
  ) {
    base.longContextOutputMultiplier = overrides.longContextOutputMultiplier;
  }

  if (
    typeof overrides.monthlySubscriptionUsd === 'number' &&
    Number.isFinite(overrides.monthlySubscriptionUsd) &&
    overrides.monthlySubscriptionUsd >= 0
  ) {
    base.monthlySubscriptionUsd = overrides.monthlySubscriptionUsd;
  }

  if (
    overrides.conversationModelOverrides &&
    typeof overrides.conversationModelOverrides === 'object' &&
    !Array.isArray(overrides.conversationModelOverrides)
  ) {
    const clean: Record<string, string> = {};
    for (const [convId, modelId] of Object.entries(overrides.conversationModelOverrides)) {
      if (typeof convId === 'string' && typeof modelId === 'string' && modelId.trim()) {
        clean[convId] = modelId.trim();
      }
    }
    base.conversationModelOverrides = clean;
  }

  if (overrides.resetConfig && typeof overrides.resetConfig === 'object') {
    const rc = overrides.resetConfig;
    const mergedRc = createDefaultResetConfig();
    if (
      typeof rc.fiveHourDurationHours === 'number' &&
      Number.isFinite(rc.fiveHourDurationHours) &&
      rc.fiveHourDurationHours >= 1 &&
      rc.fiveHourDurationHours <= 24
    ) {
      mergedRc.fiveHourDurationHours = rc.fiveHourDurationHours;
    }
    if (
      typeof rc.weeklyResetDayUtc === 'number' &&
      Number.isInteger(rc.weeklyResetDayUtc) &&
      rc.weeklyResetDayUtc >= 0 &&
      rc.weeklyResetDayUtc <= 6
    ) {
      mergedRc.weeklyResetDayUtc = rc.weeklyResetDayUtc;
    }
    if (
      typeof rc.weeklyResetHourUtc === 'number' &&
      Number.isInteger(rc.weeklyResetHourUtc) &&
      rc.weeklyResetHourUtc >= 0 &&
      rc.weeklyResetHourUtc <= 23
    ) {
      mergedRc.weeklyResetHourUtc = rc.weeklyResetHourUtc;
    }
    if (typeof rc.autoSyncOfficialResets === 'boolean') {
      mergedRc.autoSyncOfficialResets = rc.autoSyncOfficialResets;
    }
    if (typeof rc.lastFeedSyncAt === 'string' && !Number.isNaN(Date.parse(rc.lastFeedSyncAt))) {
      mergedRc.lastFeedSyncAt = new Date(rc.lastFeedSyncAt).toISOString();
    }
    if (rc.syncedNext5hReset && typeof rc.syncedNext5hReset === 'object') {
      const next5: Partial<Record<QuotaPool, string>> = {};
      for (const pool of ['gemini', 'claude_gpt'] as const) {
        const val = rc.syncedNext5hReset[pool];
        if (typeof val === 'string' && !Number.isNaN(Date.parse(val))) {
          next5[pool] = new Date(val).toISOString();
        }
      }
      mergedRc.syncedNext5hReset = next5;
    }
    if (rc.syncedNextWeeklyReset && typeof rc.syncedNextWeeklyReset === 'object') {
      const nextW: Partial<Record<QuotaPool, string>> = {};
      for (const pool of ['gemini', 'claude_gpt'] as const) {
        const val = rc.syncedNextWeeklyReset[pool];
        if (typeof val === 'string' && !Number.isNaN(Date.parse(val))) {
          nextW[pool] = new Date(val).toISOString();
        }
      }
      mergedRc.syncedNextWeeklyReset = nextW;
    }
    if (Array.isArray(rc.customResets)) {
      const cleanResets: CustomResetMarker[] = [];
      for (const item of rc.customResets.slice(0, 200)) {
        if (!item || typeof item !== 'object') continue;
        if (typeof item.timestamp !== 'string' || Number.isNaN(Date.parse(item.timestamp))) continue;
        const scope =
          item.scope === '5h' || item.scope === 'weekly' || item.scope === 'both'
            ? item.scope
            : 'both';
        const pool =
          item.pool === 'all' || item.pool === 'gemini' || item.pool === 'claude_gpt'
            ? item.pool
            : 'all';
        const safeUrl =
          typeof item.sourceUrl === 'string' &&
          /^https:\/\/(geminireset\.com|antigravityreset\.com)\//.test(item.sourceUrl.trim())
            ? item.sourceUrl.trim().slice(0, 240)
            : undefined;
        cleanResets.push({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 64) : `rst-${cleanResets.length + 1}`,
          timestamp: new Date(item.timestamp).toISOString(),
          scope,
          pool,
          label:
            typeof item.label === 'string' && item.label.trim()
              ? item.label.trim().slice(0, 120)
              : 'Server reset',
          ...(item.source === 'geminireset' || item.source === 'manual'
            ? { source: item.source }
            : {}),
          ...(safeUrl ? { sourceUrl: safeUrl } : {}),
        });
      }
      mergedRc.customResets = cleanResets;
    }
    if (Array.isArray(rc.limitHits)) {
      const cleanHits: LimitHitMarker[] = [];
      for (const item of rc.limitHits.slice(0, 200)) {
        if (!item || typeof item !== 'object') continue;
        if (typeof item.timestamp !== 'string' || Number.isNaN(Date.parse(item.timestamp))) continue;
        const scope = item.scope === '5h' || item.scope === 'weekly' ? item.scope : '5h';
        const pool: QuotaPool = item.pool === 'claude_gpt' ? 'claude_gpt' : 'gemini';
        cleanHits.push({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 64) : `hit-${cleanHits.length + 1}`,
          timestamp: new Date(item.timestamp).toISOString(),
          scope,
          pool,
          ...(typeof item.note === 'string' && item.note.trim()
            ? { note: item.note.trim().slice(0, 160) }
            : {}),
        });
      }
      mergedRc.limitHits = cleanHits;
    }
    base.resetConfig = mergedRc;
  }

  return base;
}

export interface ResolvedModelPricing {
  pricing: ModelPricing;
  resolvedModelId: string;
  /** True when the step had no `model` tag and the fallback model was applied */
  isFallback: boolean;
  /** True when a manual per-conversation model override was applied */
  isOverridden: boolean;
}

/**
 * Resolves a raw transcript `model` string to its effective `ModelPricing`.
 *
 * Resolution order:
 * 1. Explicit per-conversation override (`overrideModelId`) when `modelId` is missing
 * 2. Missing/empty `modelId` -> `config.fallbackModelId` (`isFallback: true`)
 * 3. Exact match in `config.models`
 * 4. Official family pattern match (`gemini-4-neon*`, `gemini-4-carbon*`, `gemini-4-argon*`,
 *    `gemini-4-hydrogen*`, `gemini-3.8/3.7/3.6-flash*`, `gemini-3.1-pro*`, `claude-opus-5-5*`,
 *    `claude-sonnet-5-5*`, `claude-fable*`, `claude-haiku*`, `claude-opus-4-6*`, etc.)
 * 5. Fallback pricing from `config.fallbackModelId` while preserving the raw `modelId`
 */
export function resolveModelPricing(
  modelId: string | null | undefined,
  config: PricingConfig,
  overrideModelId?: string | null,
): ResolvedModelPricing {
  const fallbackPricing =
    config.models[config.fallbackModelId] ??
    config.models[DEFAULT_FALLBACK_MODEL_ID] ??
    DEFAULT_MODELS[DEFAULT_FALLBACK_MODEL_ID];

  const trimmedRaw = modelId?.trim();
  const trimmedOverride = overrideModelId?.trim();

  const effectiveId = trimmedRaw || trimmedOverride;
  const isOverridden = !trimmedRaw && Boolean(trimmedOverride);

  if (!effectiveId) {
    return {
      pricing: fallbackPricing,
      resolvedModelId: fallbackPricing.id,
      isFallback: true,
      isOverridden: false,
    };
  }

  const exact = config.models[effectiveId];
  if (exact) {
    return {
      pricing: exact,
      resolvedModelId: effectiveId,
      isFallback: false,
      isOverridden,
    };
  }

  const lower = effectiveId.toLowerCase();
  let template: ModelPricing | undefined;

  if (lower.includes('claude')) {
    if (lower.includes('fable') || lower.includes('mythos')) {
      template = config.models['claude-fable-5-2'];
    } else if (lower.includes('haiku')) {
      template = config.models['claude-haiku-5-5'];
    } else if (lower.includes('opus')) {
      template =
        lower.includes('5-5') || lower.includes('5.5')
          ? config.models['claude-opus-5-5']
          : config.models['claude-opus-4-6'] ?? config.models['claude-opus-4-5'];
    } else if (lower.includes('sonnet')) {
      template =
        lower.includes('5-5') || lower.includes('5.5') || lower.includes('sonnet-5')
          ? config.models['claude-sonnet-5-5']
          : config.models['claude-sonnet-4-6'] ?? config.models['claude-sonnet-4-5'];
    } else {
      template = config.models['claude-sonnet-5-5'];
    }
  } else if (lower.includes('gemini')) {
    if (lower.includes('neon')) {
      template = config.models['gemini-4-neon'];
    } else if (lower.includes('carbon')) {
      template = config.models['gemini-4-carbon'];
    } else if (lower.includes('argon')) {
      template = config.models['gemini-4-argon'];
    } else if (lower.includes('hydrogen')) {
      template = config.models['gemini-4-hydrogen'];
    } else if (lower.includes('3.8') || lower.includes('3.7') || lower.includes('3.6')) {
      template = config.models['gemini-3.8-flash'];
    } else if (lower.includes('3.1-pro')) {
      template = config.models['gemini-3.1-pro'];
    } else if (lower.includes('flash-lite') || lower.includes('2.5-flash') || lower.includes('flash')) {
      template = config.models['gemini-2.5-flash'];
    } else {
      template = config.models['gemini-2.5-pro'];
    }
  } else if (lower.includes('gpt-oss')) {
    template = config.models['gpt-oss-120b-medium'];
  } else if (lower.includes('gpt')) {
    template = config.models['gpt-5'];
  }

  const base = template ?? fallbackPricing;
  return {
    pricing: {
      ...base,
      id: effectiveId,
      label: effectiveId,
      isReference: false,
    },
    resolvedModelId: effectiveId,
    isFallback: false,
    isOverridden,
  };
}

export interface LongContextOptions {
  enabled: boolean;
  threshold: number;
  inputMultiplier: number;
  outputMultiplier: number;
}

/**
 * Calculates exact USD cost breakdown for a single step (or aggregate token counts),
 * with optional >200k long-context tiered pricing multiplier.
 */
export function calculateStepCost(
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  longContext?: LongContextOptions,
): StepCostBreakdown {
  const safeInput = Math.max(0, inputTokens || 0);
  const safeCache = Math.max(0, cacheReadTokens || 0);
  const safeOutput = Math.max(0, outputTokens || 0);
  const totalContext = safeInput + safeCache;

  const baseInputCost = (safeInput * pricing.inputPer1M) / 1_000_000;
  const baseCacheReadCost = (safeCache * pricing.cacheReadPer1M) / 1_000_000;
  const baseOutputCost = (safeOutput * pricing.outputPer1M) / 1_000_000;
  const baseTotal = baseInputCost + baseCacheReadCost + baseOutputCost;

  const isAboveThreshold = Boolean(
    longContext && longContext.threshold > 0 && totalContext > longContext.threshold,
  );
  const longContextApplied = Boolean(longContext?.enabled && isAboveThreshold);

  const inMult = longContextApplied ? longContext!.inputMultiplier : 1;
  const outMult = longContextApplied ? longContext!.outputMultiplier : 1;

  const inputCost = baseInputCost * inMult;
  const cacheReadCost = baseCacheReadCost * inMult;
  const outputCost = baseOutputCost * outMult;
  const totalCost = inputCost + cacheReadCost + outputCost;

  const potentialLongTotal = isAboveThreshold
    ? baseInputCost * longContext!.inputMultiplier +
      baseCacheReadCost * longContext!.inputMultiplier +
      baseOutputCost * longContext!.outputMultiplier
    : baseTotal;
  const longContextSurcharge = Math.max(0, potentialLongTotal - baseTotal);

  const effectiveInputRate = pricing.inputPer1M * inMult;
  const effectiveCacheRate = pricing.cacheReadPer1M * inMult;
  const effectiveOutputRate = pricing.outputPer1M * outMult;

  const costWithoutCache =
    ((safeInput + safeCache) * effectiveInputRate + safeOutput * effectiveOutputRate) / 1_000_000;
  const cacheSavings = Math.max(
    0,
    (safeCache * (effectiveInputRate - effectiveCacheRate)) / 1_000_000,
  );

  return {
    inputCost,
    cacheReadCost,
    outputCost,
    totalCost,
    costWithoutCache,
    cacheSavings,
    longContextApplied,
    longContextSurcharge,
  };
}

/**
 * Projects total cost for a single reference model against a baseline spend.
 */
export function calculateWhatIfCost(
  totals: Pick<TokenTotals, 'uncachedInput' | 'cacheRead' | 'output'>,
  referencePricing: ModelPricing,
  baselineCost: number,
): WhatIfComparison {
  const projected = calculateStepCost(
    totals.uncachedInput,
    totals.cacheRead,
    totals.output,
    referencePricing,
  );
  const deltaCost = projected.totalCost - baselineCost;
  const deltaPercent = baselineCost > 0 ? deltaCost / baselineCost : 0;

  return {
    modelId: referencePricing.id,
    label: referencePricing.label,
    provider: referencePricing.provider,
    color: referencePricing.color,
    projectedCost: projected.totalCost,
    projectedCostWithoutCache: projected.costWithoutCache,
    projectedCacheSavings: projected.cacheSavings,
    deltaCost,
    deltaPercent,
  };
}

/**
 * Computes What-If API cost comparisons across all public reference models
 * in `config`, sorted from lowest projected cost to highest.
 */
export function calculateWhatIfComparisons(
  totals: Pick<TokenTotals, 'uncachedInput' | 'cacheRead' | 'output'>,
  baselineCost: number,
  config: PricingConfig,
): WhatIfComparison[] {
  const referenceModels = Object.values(config.models).filter((m) => m.isReference);
  return referenceModels
    .map((model) => calculateWhatIfCost(totals, model, baselineCost))
    .sort((a, b) => a.projectedCost - b.projectedCost);
}

/**
 * Computes Subscription ROI metrics comparing estimated API spend to a monthly plan.
 */
export function calculateSubscriptionRoi(
  monthlyPriceUsd: number,
  monthlyProjectedApiUsd: number,
  totalApiUsd: number,
  dailyBurnRate: number,
): SubscriptionRoi {
  const price = Math.max(0, monthlyPriceUsd || 0);
  const roiMultiplier = price > 0 ? monthlyProjectedApiUsd / price : 0;
  const monthlyNetSavingsUsd = monthlyProjectedApiUsd - price;
  const breakEvenDay =
    price > 0 && dailyBurnRate > 0 ? Math.min(30, Math.ceil(price / dailyBurnRate)) : null;

  return {
    monthlyPriceUsd: price,
    monthlyProjectedApiUsd,
    totalApiUsd,
    roiMultiplier,
    monthlyNetSavingsUsd,
    breakEvenDay,
  };
}

/**
 * Returns a zeroed TokenTotals object.
 */
export function createEmptyTokenTotals(): TokenTotals {
  return {
    uncachedInput: 0,
    cacheRead: 0,
    output: 0,
    totalContext: 0,
    totalTokens: 0,
    cacheHitRatio: 0,
  };
}

/**
 * Computes derived fields (`totalContext`, `totalTokens`, `cacheHitRatio`)
 * from raw uncachedInput, cacheRead, and output counts.
 */
export function computeTokenTotals(
  uncachedInput: number,
  cacheRead: number,
  output: number,
): TokenTotals {
  const totalContext = uncachedInput + cacheRead;
  const totalTokens = totalContext + output;
  const cacheHitRatio = totalContext > 0 ? cacheRead / totalContext : 0;
  return {
    uncachedInput,
    cacheRead,
    output,
    totalContext,
    totalTokens,
    cacheHitRatio,
  };
}

/**
 * Returns a zeroed CostTotals object.
 */
export function createEmptyCostTotals(): CostTotals {
  return {
    inputCost: 0,
    cacheReadCost: 0,
    outputCost: 0,
    totalCost: 0,
    costWithoutCache: 0,
    cacheSavings: 0,
  };
}
