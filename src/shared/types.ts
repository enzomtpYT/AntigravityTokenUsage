/**
 * Shared domain types for the Antigravity Token Usage & API Cost Dashboard.
 * Imported by both the Bun backend (`server/*`) and React frontend (`src/*`).
 */

export type ModelProvider = 'google' | 'anthropic' | 'openai' | 'deepseek' | 'other';
export type EfficiencyGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export type QuotaPool = 'gemini' | 'claude_gpt';
export type ResetScope = '5h' | 'weekly' | 'both';
export type ResetEventPool = 'all' | 'gemini' | 'claude_gpt';

/**
 * Ad-hoc server-side reset cutline (e.g. an unscheduled Google bonus reset).
 * Closes the active cycle early and starts a fresh cycle from `timestamp`.
 */
export interface CustomResetMarker {
  id: string;
  timestamp: string;
  scope: ResetScope;
  pool: ResetEventPool;
  label: string;
  /** Origin of this marker: manually logged or synced from geminireset.com */
  source?: 'manual' | 'geminireset';
  /** Safe https link to the announcement (e.g. geminireset.com/history/#...) */
  sourceUrl?: string;
}

/**
 * Optional marker logged when a user hits quota exhaustion on a pool/scope,
 * enabling empirical budget estimates (average tokens & API $ per cycle).
 */
export interface LimitHitMarker {
  id: string;
  timestamp: string;
  scope: '5h' | 'weekly';
  pool: QuotaPool;
  note?: string;
}

/**
 * User-configurable quota reset schedule, synced countdown anchors,
 * ad-hoc server reset cutlines, and limit-hit markers.
 */
export interface ResetScheduleConfig {
  /** Duration of rolling short-term window in hours (default 5) */
  fiveHourDurationHours: number;
  /** Weekly reset day of week in UTC (0 = Sun .. 6 = Sat, default 1 = Mon) */
  weeklyResetDayUtc: number;
  /** Weekly reset hour in UTC (0 .. 23, default 0) */
  weeklyResetHourUtc: number;
  /** Automatically fetch confirmed Google server resets from geminireset.com on server startup */
  autoSyncOfficialResets: boolean;
  /** ISO timestamp of the last successful official reset feed sync */
  lastFeedSyncAt?: string;
  /** Optional synced next 5h reset ISO timestamp per pool */
  syncedNext5hReset: Partial<Record<QuotaPool, string>>;
  /** Optional synced next weekly reset ISO timestamp per pool */
  syncedNextWeeklyReset: Partial<Record<QuotaPool, string>>;
  /** Ad-hoc server-side reset cutlines */
  customResets: CustomResetMarker[];
  /** Logged quota-exhaustion events */
  limitHits: LimitHitMarker[];
}

/**
 * Per-model API rate configuration in USD per 1,000,000 tokens.
 */
export interface ModelPricing {
  id: string;
  label: string;
  provider: ModelProvider;
  /** USD per 1M uncached input tokens */
  inputPer1M: number;
  /** USD per 1M cache-read input tokens */
  cacheReadPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** Hex color used across charts and badges */
  color: string;
  /** True for public API reference models used in the What-If Cost Simulator */
  isReference?: boolean;
  /** Optional description or benchmark mapping note */
  note?: string;
}

/**
 * Active pricing configuration including user overrides, fallback behavior,
 * >200k long-context tiered pricing, subscription ROI settings, and
 * per-conversation manual model tagging.
 */
export interface PricingConfig {
  models: Record<string, ModelPricing>;
  /** Model ID applied to steps whose transcript lacks a `model` field */
  fallbackModelId: string;
  /** Whether to include untagged steps (using `fallbackModelId`) in analytics */
  includeUntagged: boolean;
  /** Apply long-context multiplier when totalContext > longContextThreshold */
  longContextEnabled: boolean;
  /** Token threshold for long-context tiered pricing (default 200,000) */
  longContextThreshold: number;
  /** Multiplier applied to input & cache-read rates above threshold (default 2.0) */
  longContextInputMultiplier: number;
  /** Multiplier applied to output rate above threshold (default 1.5) */
  longContextOutputMultiplier: number;
  /** User's monthly subscription cost in USD for ROI calculation */
  monthlySubscriptionUsd: number;
  /** Manual per-conversation model overrides: conversationId -> modelId */
  conversationModelOverrides: Record<string, string>;
  /** Quota reset window schedule, synced anchors, server resets & limit hits */
  resetConfig: ResetScheduleConfig;
}

/**
 * Cost breakdown for a single step or aggregate bucket.
 * Verified token semantics:
 *   - `input_tokens` = uncached (fresh) input tokens
 *   - `cache_read_tokens` = separate cached input tokens
 *   - `totalCost = (input * inputRate + cacheRead * cacheReadRate + output * outputRate) / 1e6`
 *   - `cacheSavings = (cacheRead * (inputRate - cacheReadRate)) / 1e6`
 */
export interface StepCostBreakdown {
  inputCost: number;
  cacheReadCost: number;
  outputCost: number;
  totalCost: number;
  costWithoutCache: number;
  cacheSavings: number;
  /** True when >200k long-context multiplier was applied to this step */
  longContextApplied?: boolean;
  /** Extra USD added by long-context tiered pricing (or potential surcharge if disabled) */
  longContextSurcharge?: number;
}

/**
 * Aggregated token counts following verified Antigravity transcript semantics.
 */
export interface TokenTotals {
  uncachedInput: number;
  cacheRead: number;
  output: number;
  /** uncachedInput + cacheRead */
  totalContext: number;
  /** uncachedInput + cacheRead + output */
  totalTokens: number;
  /** cacheRead / (uncachedInput + cacheRead), or 0 if totalContext is 0 */
  cacheHitRatio: number;
}

/**
 * Aggregated USD cost totals.
 */
export interface CostTotals {
  inputCost: number;
  cacheReadCost: number;
  outputCost: number;
  totalCost: number;
  costWithoutCache: number;
  cacheSavings: number;
}

/**
 * Combined token, cost, and step counts used for `direct` vs `rolledUp` views.
 */
export interface MetricBundle {
  tokens: TokenTotals;
  cost: CostTotals;
  stepCount: number;
  tokenStepCount: number;
}

/**
 * Parsed step from `brain/<conversation_id>/.system_generated/logs/transcript.jsonl`.
 */
export interface StepRecord {
  stepIndex: number;
  createdAt: string | null;
  type: string;
  source: string;
  status: string;
  /** Raw model ID present in transcript, or null for older untagged transcripts */
  rawModel: string | null;
  /** Resolved model ID (equals override or `fallbackModelId` when `rawModel` is null) */
  model: string;
  /** True when `rawModel` was absent and the fallback model was applied (not manually overridden) */
  isFallbackModel: boolean;
  /** True when user manually tagged this conversation with a specific model */
  isOverriddenModel?: boolean;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  toolCalls: string[];
  thinkingChars: number;
  contentChars: number;
  hasMedia: boolean;
  hasError: boolean;
  errorText?: string;
  /** Derived elapsed ms from previous step within active session window (<= 10m) */
  latencyMs?: number | null;
  /** True when a cold-start or cache-eviction spike was detected on this turn */
  isCacheMissSpike?: boolean;
  /** Extra USD spent on uncached input during a detected cache miss spike */
  cacheMissWastedCost?: number;
  /** True when totalContext exceeds pricing.longContextThreshold */
  isLongContext?: boolean;
}

/**
 * Summary of a single conversation (main chat, subagent, or swarm worker).
 * Carries both `direct` (this conversation alone) and `rolledUp` (including
 * all descendant subagents) metric bundles so the UI can toggle instantaneously.
 */
export interface ConversationSummary {
  id: string;
  title: string;
  status: string;
  source: string;
  workspacePath: string | null;
  projectDisplayName: string;
  projectId: string;
  parentConversationId: string | null;
  nestingDepth: number;
  agentName: string | null;
  groupId: string | null;
  children: string[];
  subagentCount: number;
  hasTranscript: boolean;
  direct: MetricBundle;
  rolledUp: MetricBundle;
  modelsUsed: string[];
  hasFallbackSteps: boolean;
  manualModelOverride: string | null;
  toolCallCounts: Record<string, number>;
  userPrompts: number;
  errorCount: number;
  errorCost: number;
  cacheMissSpikes: number;
  cacheMissWastedCost: number;
  longContextSteps: number;
  activeDurationMs: number;
  medianLatencyMs: number | null;
  efficiencyScore: number;
  efficiencyGrade: EfficiencyGrade;
  thinkingChars: number;
  contentChars: number;
  mediaSteps: number;
  firstStepAt: string | null;
  lastStepAt: string | null;
  lastModifiedTime: string | null;
}

/**
 * Ancestor breadcrumb item for nested subagent inspection.
 */
export interface ConversationAncestor {
  id: string;
  title: string;
  agentName: string | null;
}

/**
 * Full response for `GET /api/conversations/:id` powering the Deep Conversation Inspector.
 */
export interface ConversationDetailResponse {
  conversation: ConversationSummary;
  steps: (StepRecord & { cost: StepCostBreakdown })[];
  subagents: ConversationSummary[];
  ancestors: ConversationAncestor[];
}

/**
 * Tool invocation summary across a project or the entire workspace.
 */
export interface ToolStat {
  name: string;
  calls: number;
  errorCount: number;
  conversationCount: number;
}

/**
 * Aggregated metrics for a normalized workspace/project.
 */
export interface ProjectSummary {
  id: string;
  workspacePath: string | null;
  displayName: string;
  projectIds: string[];
  conversationCount: number;
  subagentCount: number;
  direct: MetricBundle;
  rolledUp: MetricBundle;
  modelsUsed: string[];
  primaryModel: string | null;
  topTools: ToolStat[];
  activeDurationMs: number;
  cacheMissSpikes: number;
  cacheMissWastedCost: number;
  errorCount: number;
  errorCost: number;
  longContextSteps: number;
  efficiencyScore: number;
  efficiencyGrade: EfficiencyGrade;
  firstActiveAt: string | null;
  lastActiveAt: string | null;
}

/**
 * Single daily or hourly bucket for time-series usage & spend charts.
 */
export interface TimeSeriesPoint {
  /** YYYY-MM-DD for daily series, or YYYY-MM-DDTHH:00:00Z for hourly series */
  bucket: string;
  label: string;
  uncachedInput: number;
  cacheRead: number;
  output: number;
  totalTokens: number;
  totalCost: number;
  cumulativeCost: number;
  cacheSavings: number;
  steps: number;
  byModelCost: Record<string, number>;
  byModelTokens: Record<string, number>;
  byProjectCost: Record<string, number>;
}

/**
 * Daily cell for the GitHub-style activity calendar heatmap.
 */
export interface CalendarDay {
  date: string;
  totalTokens: number;
  totalCost: number;
  cacheSavings: number;
  steps: number;
  conversations: number;
}

/**
 * Day-of-week x Hour-of-day cell for the activity matrix heatmap.
 */
export interface HourDayCell {
  /** 0 = Sunday .. 6 = Saturday */
  dayOfWeek: number;
  /** 0 .. 23 */
  hour: number;
  steps: number;
  totalTokens: number;
  totalCost: number;
}

/**
 * Per-model usage and spend breakdown.
 */
export interface ModelStat {
  modelId: string;
  label: string;
  provider: ModelProvider;
  color: string;
  isFallback: boolean;
  steps: number;
  conversations: number;
  tokens: TokenTotals;
  cost: CostTotals;
  avgOutputPerStep: number;
  avgContextPerStep: number;
  costShare: number;
  tokenShare: number;
  medianLatencyMs: number | null;
  cacheMissSpikes: number;
  errorCount: number;
  errorCost: number;
  longContextSteps: number;
}

/**
 * Projected cost if all filtered token usage had run on a reference public API model.
 */
export interface WhatIfComparison {
  modelId: string;
  label: string;
  provider: ModelProvider;
  color: string;
  projectedCost: number;
  projectedCostWithoutCache: number;
  projectedCacheSavings: number;
  /** projectedCost - baselineCost (negative means cheaper than baseline) */
  deltaCost: number;
  /** (projectedCost - baselineCost) / baselineCost (0 if baselineCost === 0) */
  deltaPercent: number;
}

/**
 * High-cost individual step / outlier turn for the Efficiency Lab.
 */
export interface ExpensiveTurn {
  conversationId: string;
  conversationTitle: string;
  projectDisplayName: string;
  stepIndex: number;
  createdAt: string | null;
  model: string;
  isFallbackModel: boolean;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalContext: number;
  cost: number;
  toolCalls: string[];
  hasError: boolean;
  isCacheMissSpike?: boolean;
  isLongContext?: boolean;
  latencyMs?: number | null;
}

/**
 * Cost flow Sankey graph: Projects -> Models -> Cost Component.
 */
export interface SankeyNode {
  name: string;
  label: string;
  category: 'project' | 'model' | 'component';
  color?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

/**
 * Sampled / top billable turn point for Context Size vs Cost / Output scatter plot.
 */
export interface ScatterTurnPoint {
  conversationId: string;
  conversationTitle: string;
  projectDisplayName: string;
  stepIndex: number;
  model: string;
  totalContext: number;
  uncachedInput: number;
  cacheRead: number;
  outputTokens: number;
  cost: number;
  cacheHitRatio: number;
  isCacheMissSpike: boolean;
  hasError: boolean;
  isLongContext: boolean;
  latencyMs: number | null;
}

/**
 * Aggregated metrics for a subagent/swarm worker role (`research`, `browser`, `verifier`, etc.).
 */
export interface AgentRoleStat {
  role: string;
  conversationCount: number;
  steps: number;
  tokens: TokenTotals;
  cost: CostTotals;
  activeDurationMs: number;
  errorCount: number;
}

/**
 * Horizontal execution span for the Swarm & Subagent Gantt Waterfall timeline.
 */
export interface SwarmSpan {
  id: string;
  title: string;
  agentName: string;
  isRoot: boolean;
  model: string;
  startMs: number;
  endMs: number;
  cost: number;
  tokens: number;
  steps: number;
  errors: number;
  color: string;
}

/**
 * Single multi-agent / swarm session with its root and child spans.
 */
export interface SwarmSessionSummary {
  rootId: string;
  title: string;
  projectDisplayName: string;
  firstStepAt: string | null;
  lastStepAt: string | null;
  totalDurationMs: number;
  parentCost: number;
  childrenCost: number;
  totalCost: number;
  parentTokens: number;
  childrenTokens: number;
  subagentCount: number;
  maxConcurrency: number;
  spans: SwarmSpan[];
}

/**
 * Full Swarm & Multi-Agent analytics bundle.
 */
export interface SwarmAnalytics {
  swarmSessionCount: number;
  totalSubagents: number;
  avgFanOut: number;
  subagentCostShare: number;
  subagentCost: number;
  parentCost: number;
  roleStats: AgentRoleStat[];
  sessions: SwarmSessionSummary[];
}

/**
 * Subscription ROI comparison vs estimated API spend.
 */
export interface SubscriptionRoi {
  monthlyPriceUsd: number;
  monthlyProjectedApiUsd: number;
  totalApiUsd: number;
  roiMultiplier: number;
  monthlyNetSavingsUsd: number;
  breakEvenDay: number | null;
}

/**
 * Error & retry cost breakdown per project.
 */
export interface ProjectErrorCost {
  projectId: string;
  displayName: string;
  errors: number;
  errorCost: number;
  errorTokens: number;
}

/**
 * Consecutive tool-call bigram pipeline (e.g. `read_file -> edit_file`).
 */
export interface ToolChainStat {
  from: string;
  to: string;
  count: number;
}

/**
 * Real-world scale comparisons, peak records, and coding persona.
 */
export interface FunInsights {
  /** Total context tokens translated to ~100k-token books */
  booksRead: number;
  /** Output tokens translated to ~100k-token novels */
  novelsWritten: number;
  /** Rough estimate of code lines authored (~65% code output, ~10 tok/line) */
  estimatedLinesOfCode: number;
  codingPersona: {
    title: string;
    description: string;
    peakHourUtc: number;
    peakPeriodShare: number;
  };
  peakDay: {
    date: string;
    label: string;
    cost: number;
    tokens: number;
    steps: number;
  } | null;
  peakHour: {
    bucket: string;
    label: string;
    cost: number;
    tokens: number;
    steps: number;
  } | null;
}

/**
 * Week-over-week (latest 7 calendar days vs preceding 7 calendar days) deltas.
 */
export interface PeriodDeltas {
  hasPriorData: boolean;
  current7dCost: number;
  previous7dCost: number;
  spendDeltaPct: number | null;
  current7dTokens: number;
  previous7dTokens: number;
  tokensDeltaPct: number | null;
  current7dCacheHit: number;
  previous7dCacheHit: number;
  /** Percentage-point change (e.g. +0.025 = +2.5 pp) */
  cacheHitDeltaPp: number | null;
  current7dSteps: number;
  previous7dSteps: number;
  stepsDeltaPct: number | null;
}

/**
 * Aggregated metrics for a single quota pool (or combined) inside a reset cycle.
 */
export interface PoolMetrics {
  tokens: TokenTotals;
  cost: CostTotals;
  steps: number;
  tokenSteps: number;
  conversations: number;
  topModel: string | null;
  topProject: string | null;
}

/**
 * Aggregated usage & API cost for a single 5-hour or weekly quota reset window.
 */
export interface ResetCycleSummary {
  id: string;
  scope: '5h' | 'weekly';
  startAt: string;
  endAt: string;
  label: string;
  isCurrent: boolean;
  /** True when a 5h pool window currently has no active turns and no synced countdown (100% ready) */
  isIdle?: boolean;
  /** True when anchored by a user-synced countdown timer from Antigravity View Usage */
  isSynced?: boolean;
  /** True when the cycle ended early because of a logged server-side reset */
  endedEarlyByServerReset: boolean;
  /** True when the cycle began at a logged server-side reset cutline */
  startedByServerReset: boolean;
  serverResetLabel?: string;
  limitHits: LimitHitMarker[];
  combined: PoolMetrics;
  gemini: PoolMetrics;
  claudeGpt: PoolMetrics;
  byModelCost: Record<string, number>;
  byModelTokens: Record<string, number>;
  efficiencyScore: number;
  efficiencyGrade: EfficiencyGrade;
}

/**
 * Independent reset timeline for a single Antigravity quota pool (Gemini vs Claude & GPT).
 */
export interface PoolResetTimeline {
  pool: QuotaPool;
  current5h: ResetCycleSummary;
  currentWeekly: ResetCycleSummary;
  fiveHourCycles: ResetCycleSummary[];
  weeklyCycles: ResetCycleSummary[];
}

/**
 * Empirical observed quota budget derived from logged limit-hit cycles.
 */
export interface PoolLimitEstimate {
  pool: QuotaPool;
  scope: '5h' | 'weekly';
  sampleCount: number;
  avgTokensAtLimit: number;
  avgCostAtLimit: number;
  avgTurnsAtLimit: number;
}

/**
 * Full per-reset-window analytics payload for the Quota & Resets tab.
 */
export interface ResetAnalytics {
  config: ResetScheduleConfig;
  /** Combined current 5h cycle (all pools) */
  current5h: ResetCycleSummary;
  /** Combined current weekly cycle (all pools) */
  currentWeekly: ResetCycleSummary;
  fiveHourCycles: ResetCycleSummary[];
  weeklyCycles: ResetCycleSummary[];
  /** Independent per-pool reset clocks & histories (Gemini vs Claude & GPT) */
  pools: Record<QuotaPool, PoolResetTimeline>;
  limitEstimates: PoolLimitEstimate[];
}

/**
 * Active query filters applied to `/api/dashboard`.
 */
export interface DashboardFilters {
  startDate?: string;
  endDate?: string;
  projectId?: string;
  model?: string;
  includeSubagents: boolean;
}

/**
 * Efficiency, pacing, cache-miss, and error-cost metrics for the Efficiency Lab.
 */
export interface EfficiencyMetrics {
  totalToolCalls: number;
  toolCallsPerConversation: number;
  toolCallsPerTurn: number;
  errorRate: number;
  totalErrors: number;
  totalThinkingChars: number;
  totalContentChars: number;
  thinkingToOutputRatio: number;
  promptToOutputLeverage: number;
  mediaSteps: number;
  // V2 deep analytics
  totalActiveMs: number;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgOutputTokensPerSec: number;
  costPerActiveHour: number;
  cacheMissSpikes: number;
  cacheMissWastedCost: number;
  longContextSteps: number;
  longContextSurcharge: number;
  errorCost: number;
  errorTokens: number;
  errorCostByProject: ProjectErrorCost[];
  // V3 efficiency score & actionable tips
  efficiencyScore: number;
  efficiencyGrade: EfficiencyGrade;
  optimizationTips: string[];
}

/**
 * Hero KPI metrics displayed on the Overview page.
 */
export interface DashboardKpis {
  tokens: TokenTotals;
  cost: CostTotals;
  /** cacheSavings / costWithoutCache (0 when costWithoutCache === 0) */
  cacheSavingsPercent: number;
  conversationCount: number;
  mainConversationCount: number;
  subagentCount: number;
  transcriptCount: number;
  totalSteps: number;
  tokenBearingSteps: number;
  userPrompts: number;
  avgCostPerConversation: number;
  avgCostPerPrompt: number;
  avgTokensPerTurn: number;
  dailyBurnRate: number;
  projectedMonthlyCost: number;
  activeDays: number;
  currentStreakDays: number;
  longestStreakDays: number;
}

/**
 * Full payload returned by `GET /api/dashboard`.
 */
export interface DashboardPayload {
  generatedAt: string;
  dataDir: string;
  watchedFiles: number;
  appliedFilters: DashboardFilters;
  pricing: PricingConfig;
  kpis: DashboardKpis;
  efficiency: EfficiencyMetrics;
  subscriptionRoi: SubscriptionRoi;
  funInsights: FunInsights;
  periodDeltas: PeriodDeltas;
  toolChains: ToolChainStat[];
  resetAnalytics: ResetAnalytics;
  sankey: SankeyData;
  scatterTurns: ScatterTurnPoint[];
  swarmAnalytics: SwarmAnalytics;
  dailySeries: TimeSeriesPoint[];
  hourlySeries: TimeSeriesPoint[];
  calendarHeatmap: CalendarDay[];
  hourDayHeatmap: HourDayCell[];
  projects: ProjectSummary[];
  conversations: ConversationSummary[];
  models: ModelStat[];
  tools: ToolStat[];
  whatIf: WhatIfComparison[];
  expensiveTurns: ExpensiveTurn[];
  availableProjects: { id: string; displayName: string }[];
  availableModels: { id: string; label: string; isFallback?: boolean }[];
}
