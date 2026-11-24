import {
  calculateStepCost,
  calculateSubscriptionRoi,
  calculateWhatIfComparisons,
  computeTokenTotals,
  createDefaultResetConfig,
  createEmptyCostTotals,
  createEmptyTokenTotals,
  getQuotaPoolForModel,
  resolveModelPricing,
  type LongContextOptions,
} from '../src/shared/pricing.ts';
import type {
  AgentRoleStat,
  CalendarDay,
  ConversationAncestor,
  ConversationDetailResponse,
  ConversationSummary,
  CostTotals,
  CustomResetMarker,
  DashboardFilters,
  DashboardKpis,
  DashboardPayload,
  EfficiencyGrade,
  EfficiencyMetrics,
  ExpensiveTurn,
  FunInsights,
  HourDayCell,
  LimitHitMarker,
  MetricBundle,
  ModelProvider,
  ModelStat,
  PeriodDeltas,
  PoolLimitEstimate,
  PoolMetrics,
  PoolResetTimeline,
  PricingConfig,
  ProjectErrorCost,
  ProjectSummary,
  QuotaPool,
  ResetAnalytics,
  ResetCycleSummary,
  ResetEventPool,
  ResetScheduleConfig,
  SankeyData,
  SankeyLink,
  SankeyNode,
  ScatterTurnPoint,
  StepCostBreakdown,
  StepRecord,
  SwarmAnalytics,
  SwarmSessionSummary,
  SwarmSpan,
  TimeSeriesPoint,
  ToolChainStat,
  ToolStat,
} from '../src/shared/types.ts';
import type { LoadedConversation, LoadedDataset, RawStepRecord } from './data-loader.ts';

export interface AnalyticsFilters extends DashboardFilters {
  search?: string;
}

interface ResolvedStepWithCost {
  step: StepRecord;
  cost: StepCostBreakdown;
  label: string;
  provider: ModelProvider;
  color: string;
  isTokenBearing: boolean;
  effectiveInputRate: number;
  effectiveCacheRate: number;
}

interface DirectConvComputation {
  conv: LoadedConversation;
  filteredSteps: ResolvedStepWithCost[];
  direct: MetricBundle;
  modelsUsed: string[];
  hasFallbackSteps: boolean;
  manualModelOverride: string | null;
  toolCallCounts: Record<string, number>;
  toolErrorCounts: Record<string, number>;
  userPrompts: number;
  errorCount: number;
  errorCost: number;
  errorTokens: number;
  cacheMissSpikes: number;
  cacheMissWastedCost: number;
  longContextSteps: number;
  longContextSurcharge: number;
  activeDurationMs: number;
  latenciesMs: number[];
  medianLatencyMs: number | null;
  latencyOutputTokens: number;
  latencyTotalMs: number;
  thinkingChars: number;
  contentChars: number;
  mediaSteps: number;
  firstStepAt: string | null;
  lastStepAt: string | null;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MAX_ACTIVE_GAP_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TURN_LATENCY_MS = 5 * 60 * 1000; // 5 minutes

function createEmptyMetricBundle(): MetricBundle {
  return {
    tokens: createEmptyTokenTotals(),
    cost: createEmptyCostTotals(),
    stepCount: 0,
    tokenStepCount: 0,
  };
}

function addCostTotals(target: CostTotals, add: StepCostBreakdown | CostTotals): void {
  target.inputCost += add.inputCost;
  target.cacheReadCost += add.cacheReadCost;
  target.outputCost += add.outputCost;
  target.totalCost += add.totalCost;
  target.costWithoutCache += add.costWithoutCache;
  target.cacheSavings += add.cacheSavings;
}

function parseDateBoundary(value: string | undefined, endOfDay: boolean): number | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const iso = endOfDay ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

function formatDayLabel(dateKey: string): string {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  const monthIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const month = MONTH_NAMES[monthIdx] ?? parts[1];
  return `${month} ${day}`;
}

function formatHourLabel(hourBucket: string): string {
  const datePart = hourBucket.slice(0, 10);
  const hourPart = hourBucket.slice(11, 16);
  return `${formatDayLabel(datePart)} ${hourPart}`;
}

function computePercentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * p)),
  );
  return sortedValues[idx];
}

/**
 * Computes a composite 0–100 Efficiency Score & Grade (S/A/B/C/D):
 * - Cache hit ratio: 45 pts
 * - Low cache-miss spike rate: 20 pts
 * - Low step error rate: 20 pts
 * - Output-to-uncached-input leverage: 15 pts
 */
export function computeEfficiencyScore(params: {
  cacheHitRatio: number;
  tokenStepCount: number;
  stepCount: number;
  cacheMissSpikes: number;
  errorCount: number;
  outputTokens: number;
  uncachedInputTokens: number;
}): { score: number; grade: EfficiencyGrade } {
  const {
    cacheHitRatio,
    tokenStepCount,
    stepCount,
    cacheMissSpikes,
    errorCount,
    outputTokens,
    uncachedInputTokens,
  } = params;

  if (tokenStepCount === 0) {
    return { score: 0, grade: 'C' };
  }

  const cachePts = Math.min(45, Math.max(0, cacheHitRatio) * 45);
  const spikeRate = cacheMissSpikes / Math.max(tokenStepCount, 1);
  const spikePts = Math.max(0, 20 * (1 - Math.min(1, spikeRate * 8)));
  const errRate = errorCount / Math.max(stepCount, 1);
  const errPts = Math.max(0, 20 * (1 - Math.min(1, errRate * 10)));
  const leverage = uncachedInputTokens > 0 ? outputTokens / uncachedInputTokens : 0;
  // 0.15 output-to-uncached ratio (~15%) earns full 15 pts
  const leveragePts = Math.min(15, (leverage / 0.15) * 15);

  const score = Math.round(Math.min(100, Math.max(0, cachePts + spikePts + errPts + leveragePts)));
  let grade: EfficiencyGrade = 'D';
  if (score >= 90) grade = 'S';
  else if (score >= 80) grade = 'A';
  else if (score >= 68) grade = 'B';
  else if (score >= 52) grade = 'C';

  return { score, grade };
}

function buildFunInsights(
  tokens: { totalContext: number; output: number },
  dailySeries: TimeSeriesPoint[],
  hourlySeries: TimeSeriesPoint[],
  hourDayMatrix: HourDayCell[],
): FunInsights {
  const booksRead = tokens.totalContext / 100_000;
  const novelsWritten = tokens.output / 100_000;
  const estimatedLinesOfCode = Math.round((tokens.output * 0.65) / 10);

  // Aggregate steps across 24 hours (UTC)
  const hourSteps = new Array<number>(24).fill(0);
  let totalSteps = 0;
  for (const cell of hourDayMatrix) {
    hourSteps[cell.hour] += cell.steps;
    totalSteps += cell.steps;
  }

  let peakHourUtc = 0;
  for (let h = 1; h < 24; h++) {
    if (hourSteps[h] > hourSteps[peakHourUtc]) peakHourUtc = h;
  }

  const buckets = [
    {
      name: 'Night Owl',
      desc: 'Peak agent activity hits late at night (22:00–04:59 UTC)',
      hours: [22, 23, 0, 1, 2, 3, 4],
    },
    {
      name: 'Early Bird',
      desc: 'Most sessions kick off early in the morning (05:00–11:59 UTC)',
      hours: [5, 6, 7, 8, 9, 10, 11],
    },
    {
      name: 'Afternoon Builder',
      desc: 'Deep focus peaks through midday & afternoon (12:00–17:59 UTC)',
      hours: [12, 13, 14, 15, 16, 17],
    },
    {
      name: 'Evening Sprinter',
      desc: 'Highest velocity happens in the evening (18:00–21:59 UTC)',
      hours: [18, 19, 20, 21],
    },
  ];

  let bestBucket = buckets[0];
  let bestCount = -1;
  for (const b of buckets) {
    const c = b.hours.reduce((s, h) => s + hourSteps[h], 0);
    if (c > bestCount) {
      bestCount = c;
      bestBucket = b;
    }
  }
  const peakPeriodShare = totalSteps > 0 ? bestCount / totalSteps : 0;
  const codingPersona =
    totalSteps > 0 && peakPeriodShare < 0.34
      ? {
          title: 'Always-On Architect',
          description: 'Steady coding velocity spread evenly across the clock',
          peakHourUtc,
          peakPeriodShare,
        }
      : {
          title: bestBucket.name,
          description: bestBucket.desc,
          peakHourUtc,
          peakPeriodShare,
        };

  let peakDay: FunInsights['peakDay'] = null;
  for (const d of dailySeries) {
    if (!peakDay || d.totalCost > peakDay.cost) {
      peakDay = {
        date: d.bucket,
        label: d.label,
        cost: d.totalCost,
        tokens: d.totalTokens,
        steps: d.steps,
      };
    }
  }

  let peakHour: FunInsights['peakHour'] = null;
  for (const h of hourlySeries) {
    if (!peakHour || h.totalCost > peakHour.cost) {
      peakHour = {
        bucket: h.bucket,
        label: h.label,
        cost: h.totalCost,
        tokens: h.totalTokens,
        steps: h.steps,
      };
    }
  }

  return {
    booksRead,
    novelsWritten,
    estimatedLinesOfCode,
    codingPersona,
    peakDay,
    peakHour,
  };
}

function buildPeriodDeltas(dailySeries: TimeSeriesPoint[]): PeriodDeltas {
  if (dailySeries.length === 0) {
    return {
      hasPriorData: false,
      current7dCost: 0,
      previous7dCost: 0,
      spendDeltaPct: null,
      current7dTokens: 0,
      previous7dTokens: 0,
      tokensDeltaPct: null,
      current7dCacheHit: 0,
      previous7dCacheHit: 0,
      cacheHitDeltaPp: null,
      current7dSteps: 0,
      previous7dSteps: 0,
      stepsDeltaPct: null,
    };
  }

  const DAY_MS = 86_400_000;
  const lastDayMs = Date.parse(`${dailySeries[dailySeries.length - 1].bucket}T00:00:00.000Z`);
  const curStartMs = lastDayMs - 6 * DAY_MS;
  const prevStartMs = lastDayMs - 13 * DAY_MS;

  let curCost = 0;
  let prevCost = 0;
  let curTokens = 0;
  let prevTokens = 0;
  let curCache = 0;
  let curCtx = 0;
  let prevCache = 0;
  let prevCtx = 0;
  let curSteps = 0;
  let prevSteps = 0;

  for (const d of dailySeries) {
    const ms = Date.parse(`${d.bucket}T00:00:00.000Z`);
    if (ms >= curStartMs && ms <= lastDayMs) {
      curCost += d.totalCost;
      curTokens += d.totalTokens;
      curCache += d.cacheRead;
      curCtx += d.uncachedInput + d.cacheRead;
      curSteps += d.steps;
    } else if (ms >= prevStartMs && ms < curStartMs) {
      prevCost += d.totalCost;
      prevTokens += d.totalTokens;
      prevCache += d.cacheRead;
      prevCtx += d.uncachedInput + d.cacheRead;
      prevSteps += d.steps;
    }
  }

  const curCacheHit = curCtx > 0 ? curCache / curCtx : 0;
  const prevCacheHit = prevCtx > 0 ? prevCache / prevCtx : 0;
  const hasPriorData = prevTokens > 0 || prevCost > 0 || prevSteps > 0;

  return {
    hasPriorData,
    current7dCost: curCost,
    previous7dCost: prevCost,
    spendDeltaPct: prevCost > 0 ? (curCost - prevCost) / prevCost : null,
    current7dTokens: curTokens,
    previous7dTokens: prevTokens,
    tokensDeltaPct: prevTokens > 0 ? (curTokens - prevTokens) / prevTokens : null,
    current7dCacheHit: curCacheHit,
    previous7dCacheHit: prevCacheHit,
    cacheHitDeltaPp: prevCtx > 0 ? curCacheHit - prevCacheHit : null,
    current7dSteps: curSteps,
    previous7dSteps: prevSteps,
    stepsDeltaPct: prevSteps > 0 ? (curSteps - prevSteps) / prevSteps : null,
  };
}

function getLongContextOptions(pricing: PricingConfig): LongContextOptions {
  return {
    enabled: Boolean(pricing.longContextEnabled),
    threshold: pricing.longContextThreshold || 200_000,
    inputMultiplier: pricing.longContextInputMultiplier || 2.0,
    outputMultiplier: pricing.longContextOutputMultiplier || 1.5,
  };
}

function resolveRawStep(
  raw: RawStepRecord,
  pricing: PricingConfig,
  overrideModelId: string | null,
  longContextOpts: LongContextOptions,
): ResolvedStepWithCost {
  const resolved = resolveModelPricing(raw.rawModel, pricing, overrideModelId);
  const isTokenBearing =
    raw.inputTokens > 0 || raw.cacheReadTokens > 0 || raw.outputTokens > 0;
  const cost = calculateStepCost(
    raw.inputTokens,
    raw.cacheReadTokens,
    raw.outputTokens,
    resolved.pricing,
    longContextOpts,
  );

  const totalContext = raw.inputTokens + raw.cacheReadTokens;
  const isLongContext =
    isTokenBearing && longContextOpts.threshold > 0 && totalContext > longContextOpts.threshold;
  const inMult = cost.longContextApplied ? longContextOpts.inputMultiplier : 1;

  const step: StepRecord = {
    stepIndex: raw.stepIndex,
    createdAt: raw.createdAt,
    type: raw.type,
    source: raw.source,
    status: raw.status,
    rawModel: raw.rawModel,
    model: resolved.resolvedModelId,
    isFallbackModel: resolved.isFallback,
    isOverriddenModel: resolved.isOverridden,
    inputTokens: raw.inputTokens,
    cacheReadTokens: raw.cacheReadTokens,
    outputTokens: raw.outputTokens,
    toolCalls: raw.toolCalls,
    thinkingChars: raw.thinkingChars,
    contentChars: raw.contentChars,
    hasMedia: raw.hasMedia,
    hasError: raw.hasError,
    isLongContext,
    latencyMs: null,
    isCacheMissSpike: false,
    cacheMissWastedCost: 0,
    ...(raw.errorText ? { errorText: raw.errorText } : {}),
  };

  return {
    step,
    cost,
    label: resolved.pricing.label,
    provider: resolved.pricing.provider,
    color: resolved.pricing.color,
    isTokenBearing,
    effectiveInputRate: resolved.pricing.inputPer1M * inMult,
    effectiveCacheRate: resolved.pricing.cacheReadPer1M * inMult,
  };
}

function computeDirectConversation(
  conv: LoadedConversation,
  pricing: PricingConfig,
  startMs: number | null,
  endMs: number | null,
  modelFilter: string | null,
): DirectConvComputation {
  const filteredSteps: ResolvedStepWithCost[] = [];
  const manualModelOverride = pricing.conversationModelOverrides?.[conv.meta.id] ?? null;
  const longContextOpts = getLongContextOptions(pricing);

  let uncachedInput = 0;
  let cacheRead = 0;
  let output = 0;
  const cost = createEmptyCostTotals();
  let tokenStepCount = 0;

  const modelsSet = new Set<string>();
  let hasFallbackSteps = false;
  const toolCallCounts: Record<string, number> = {};
  const toolErrorCounts: Record<string, number> = {};
  let userPrompts = 0;
  let errorCount = 0;
  let errorCost = 0;
  let errorTokens = 0;
  let cacheMissSpikes = 0;
  let cacheMissWastedCost = 0;
  let longContextSteps = 0;
  let longContextSurcharge = 0;
  let activeDurationMs = 0;
  const latenciesMs: number[] = [];
  let latencyOutputTokens = 0;
  let latencyTotalMs = 0;
  let thinkingChars = 0;
  let contentChars = 0;
  let mediaSteps = 0;
  let firstStepAt: string | null = null;
  let lastStepAt: string | null = null;

  let prevTsMs: number | null = null;
  let seenWarmCache = false;
  let prevCacheRead = 0;
  let lastTokenStep: ResolvedStepWithCost | null = null;
  const attributedErrorStepIndices = new Set<number>();

  for (const raw of conv.steps) {
    // Exclude untagged steps when pricing.includeUntagged is false AND no manual override exists
    if (raw.rawModel === null && !manualModelOverride && !pricing.includeUntagged) {
      continue;
    }

    // Apply date range filter
    const tsStr = raw.createdAt ?? conv.meta.lastModifiedTime;
    const tsMs = tsStr ? Date.parse(tsStr) : Number.NaN;
    if (startMs !== null || endMs !== null) {
      if (!tsStr || Number.isNaN(tsMs)) continue;
      if (startMs !== null && tsMs < startMs) continue;
      if (endMs !== null && tsMs > endMs) continue;
    }

    const resolved = resolveRawStep(raw, pricing, manualModelOverride, longContextOpts);

    // Apply model filter (only keep steps matching modelFilter)
    if (modelFilter && resolved.step.model !== modelFilter) {
      if (!Number.isNaN(tsMs)) prevTsMs = tsMs;
      continue;
    }

    // Compute latency & active session time
    if (!Number.isNaN(tsMs)) {
      if (prevTsMs !== null) {
        const delta = tsMs - prevTsMs;
        if (delta > 0 && delta <= MAX_ACTIVE_GAP_MS) {
          activeDurationMs += delta;
        }
        if (resolved.isTokenBearing && delta > 0 && delta <= MAX_TURN_LATENCY_MS) {
          resolved.step.latencyMs = delta;
          latenciesMs.push(delta);
          if (resolved.step.outputTokens > 0) {
            latencyOutputTokens += resolved.step.outputTokens;
            latencyTotalMs += delta;
          }
        }
      }
      prevTsMs = tsMs;
    }

    // Cache-miss / cold-start spike detection
    if (resolved.isTokenBearing) {
      const inp = resolved.step.inputTokens;
      const cache = resolved.step.cacheReadTokens;
      const isSpike =
        (seenWarmCache && inp >= 15_000 && cache === 0) ||
        (seenWarmCache && inp >= 25_000 && inp > cache * 2 && prevCacheRead >= 15_000) ||
        (!seenWarmCache && inp >= 50_000 && cache === 0);

      if (isSpike) {
        const rateDiff = Math.max(0, resolved.effectiveInputRate - resolved.effectiveCacheRate);
        const wasted = (inp * rateDiff) / 1_000_000;
        resolved.step.isCacheMissSpike = true;
        resolved.step.cacheMissWastedCost = wasted;
        cacheMissSpikes += 1;
        cacheMissWastedCost += wasted;
      }

      if (cache >= 5_000) {
        seenWarmCache = true;
      }
      prevCacheRead = cache;
    }

    filteredSteps.push(resolved);

    if (resolved.isTokenBearing) {
      tokenStepCount += 1;
      uncachedInput += resolved.step.inputTokens;
      cacheRead += resolved.step.cacheReadTokens;
      output += resolved.step.outputTokens;
      addCostTotals(cost, resolved.cost);
      modelsSet.add(resolved.step.model);
      if (resolved.step.isFallbackModel) {
        hasFallbackSteps = true;
      }
      if (resolved.step.isLongContext) {
        longContextSteps += 1;
        longContextSurcharge += resolved.cost.longContextSurcharge ?? 0;
      }
      lastTokenStep = resolved;
    }

    if (resolved.step.type === 'USER_INPUT' || resolved.step.source === 'USER_EXPLICIT') {
      userPrompts += 1;
    }
    if (resolved.step.hasError) {
      errorCount += 1;
      if (resolved.isTokenBearing) {
        if (!attributedErrorStepIndices.has(resolved.step.stepIndex)) {
          attributedErrorStepIndices.add(resolved.step.stepIndex);
          errorCost += resolved.cost.totalCost;
          errorTokens +=
            resolved.step.inputTokens + resolved.step.cacheReadTokens + resolved.step.outputTokens;
        }
      } else if (
        lastTokenStep &&
        resolved.step.stepIndex - lastTokenStep.step.stepIndex <= 2 &&
        !attributedErrorStepIndices.has(lastTokenStep.step.stepIndex)
      ) {
        // Attribute cost of immediately preceding LLM turn whose tool call / step errored
        attributedErrorStepIndices.add(lastTokenStep.step.stepIndex);
        errorCost += lastTokenStep.cost.totalCost;
        errorTokens +=
          lastTokenStep.step.inputTokens +
          lastTokenStep.step.cacheReadTokens +
          lastTokenStep.step.outputTokens;
      }
    }
    if (resolved.step.hasMedia) {
      mediaSteps += 1;
    }

    thinkingChars += resolved.step.thinkingChars;
    contentChars += resolved.step.contentChars;

    for (const toolName of resolved.step.toolCalls) {
      toolCallCounts[toolName] = (toolCallCounts[toolName] ?? 0) + 1;
      if (resolved.step.hasError) {
        toolErrorCounts[toolName] = (toolErrorCounts[toolName] ?? 0) + 1;
      }
    }

    if (resolved.step.createdAt) {
      if (!firstStepAt || resolved.step.createdAt < firstStepAt) {
        firstStepAt = resolved.step.createdAt;
      }
      if (!lastStepAt || resolved.step.createdAt > lastStepAt) {
        lastStepAt = resolved.step.createdAt;
      }
    }
  }

  const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);

  return {
    conv,
    filteredSteps,
    direct: {
      tokens: computeTokenTotals(uncachedInput, cacheRead, output),
      cost,
      stepCount: filteredSteps.length,
      tokenStepCount,
    },
    modelsUsed: Array.from(modelsSet),
    hasFallbackSteps,
    manualModelOverride,
    toolCallCounts,
    toolErrorCounts,
    userPrompts,
    errorCount,
    errorCost,
    errorTokens,
    cacheMissSpikes,
    cacheMissWastedCost,
    longContextSteps,
    longContextSurcharge,
    activeDurationMs,
    latenciesMs,
    medianLatencyMs: computePercentile(sortedLatencies, 0.5),
    latencyOutputTokens,
    latencyTotalMs,
    thinkingChars,
    contentChars,
    mediaSteps,
    firstStepAt,
    lastStepAt,
  };
}

function collectDescendants(
  rootId: string,
  conversations: Map<string, LoadedConversation>,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>([rootId]);
  const queue = [...(conversations.get(rootId)?.children ?? [])];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    const child = conversations.get(id);
    if (child) {
      for (const grandChild of child.children) {
        if (!visited.has(grandChild)) {
          queue.push(grandChild);
        }
      }
    }
  }

  return result;
}

function buildConversationSummary(
  id: string,
  directMap: Map<string, DirectConvComputation>,
  conversations: Map<string, LoadedConversation>,
): ConversationSummary {
  const entry = directMap.get(id)!;
  const descendants = collectDescendants(id, conversations);

  let rolledUncached = entry.direct.tokens.uncachedInput;
  let rolledCache = entry.direct.tokens.cacheRead;
  let rolledOutput = entry.direct.tokens.output;
  const rolledCost = createEmptyCostTotals();
  addCostTotals(rolledCost, entry.direct.cost);
  let rolledStepCount = entry.direct.stepCount;
  let rolledTokenStepCount = entry.direct.tokenStepCount;

  // Sum each unique descendant's direct metrics exactly once (no double counting)
  for (const descId of descendants) {
    const descEntry = directMap.get(descId);
    if (!descEntry) continue;
    rolledUncached += descEntry.direct.tokens.uncachedInput;
    rolledCache += descEntry.direct.tokens.cacheRead;
    rolledOutput += descEntry.direct.tokens.output;
    addCostTotals(rolledCost, descEntry.direct.cost);
    rolledStepCount += descEntry.direct.stepCount;
    rolledTokenStepCount += descEntry.direct.tokenStepCount;
  }

  const rolledUp: MetricBundle = {
    tokens: computeTokenTotals(rolledUncached, rolledCache, rolledOutput),
    cost: rolledCost,
    stepCount: rolledStepCount,
    tokenStepCount: rolledTokenStepCount,
  };

  const eff = computeEfficiencyScore({
    cacheHitRatio: entry.direct.tokens.cacheHitRatio,
    tokenStepCount: entry.direct.tokenStepCount,
    stepCount: entry.direct.stepCount,
    cacheMissSpikes: entry.cacheMissSpikes,
    errorCount: entry.errorCount,
    outputTokens: entry.direct.tokens.output,
    uncachedInputTokens: entry.direct.tokens.uncachedInput,
  });

  return {
    id: entry.conv.meta.id,
    title: entry.conv.meta.title,
    status: entry.conv.meta.status,
    source: entry.conv.meta.source,
    workspacePath: entry.conv.meta.workspacePath,
    projectDisplayName: entry.conv.meta.projectDisplayName,
    projectId: entry.conv.meta.projectId,
    parentConversationId: entry.conv.meta.parentConversationId,
    nestingDepth: entry.conv.meta.nestingDepth,
    agentName: entry.conv.meta.agentName,
    groupId: entry.conv.meta.groupId,
    children: [...entry.conv.children],
    subagentCount: descendants.length,
    hasTranscript: entry.conv.hasTranscript,
    direct: entry.direct,
    rolledUp,
    modelsUsed: entry.modelsUsed,
    hasFallbackSteps: entry.hasFallbackSteps,
    manualModelOverride: entry.manualModelOverride,
    toolCallCounts: entry.toolCallCounts,
    userPrompts: entry.userPrompts,
    errorCount: entry.errorCount,
    errorCost: entry.errorCost,
    cacheMissSpikes: entry.cacheMissSpikes,
    cacheMissWastedCost: entry.cacheMissWastedCost,
    longContextSteps: entry.longContextSteps,
    activeDurationMs: entry.activeDurationMs,
    medianLatencyMs: entry.medianLatencyMs,
    efficiencyScore: eff.score,
    efficiencyGrade: eff.grade,
    thinkingChars: entry.thinkingChars,
    contentChars: entry.contentChars,
    mediaSteps: entry.mediaSteps,
    firstStepAt: entry.firstStepAt,
    lastStepAt: entry.lastStepAt,
    lastModifiedTime: entry.conv.meta.lastModifiedTime,
  };
}

function computeStreaks(
  sortedDates: string[],
  now: Date,
): { currentStreakDays: number; longestStreakDays: number } {
  if (sortedDates.length === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0 };
  }

  const DAY_MS = 86_400_000;
  const dayNums = sortedDates.map((d) => Math.floor(Date.parse(`${d}T00:00:00.000Z`) / DAY_MS));

  let longest = 1;
  let run = 1;
  for (let i = 1; i < dayNums.length; i++) {
    if (dayNums[i] === dayNums[i - 1] + 1) {
      run += 1;
      if (run > longest) longest = run;
    } else if (dayNums[i] > dayNums[i - 1] + 1) {
      run = 1;
    }
  }

  const todayNum = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / DAY_MS,
  );
  const latestDayNum = dayNums[dayNums.length - 1];
  let current = 0;
  if (latestDayNum >= todayNum - 1) {
    current = 1;
    for (let i = dayNums.length - 2; i >= 0; i--) {
      if (dayNums[i] === dayNums[i + 1] - 1) {
        current += 1;
      } else {
        break;
      }
    }
  }

  return { currentStreakDays: current, longestStreakDays: longest };
}

function computeMaxConcurrency(spans: SwarmSpan[]): number {
  if (spans.length === 0) return 0;
  const events: { t: number; delta: number }[] = [];
  for (const s of spans) {
    events.push({ t: s.startMs, delta: 1 });
    events.push({ t: s.endMs, delta: -1 });
  }
  events.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.delta - b.delta));
  let cur = 0;
  let max = 0;
  for (const e of events) {
    cur += e.delta;
    if (cur > max) max = cur;
  }
  return max;
}

const ROLE_COLORS = [
  '#6366f1',
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#fb923c',
  '#a78bfa',
  '#f472b6',
  '#22d3ee',
  '#10b981',
];

function getRoleColor(role: string, isRoot: boolean): string {
  if (isRoot) return '#6366f1';
  let hash = 0;
  for (let i = 0; i < role.length; i++) {
    hash = (hash * 31 + role.charCodeAt(i)) | 0;
  }
  return ROLE_COLORS[Math.abs(hash) % ROLE_COLORS.length];
}

/**
 * Pure aggregation engine computing the full `DashboardPayload` from a loaded dataset,
 * active `PricingConfig`, and query filters.
 */
export function buildDashboardPayload(
  dataset: LoadedDataset,
  pricing: PricingConfig,
  filters: AnalyticsFilters,
  now: Date = new Date(),
): DashboardPayload {
  const startMs = parseDateBoundary(filters.startDate, false);
  const endMs = parseDateBoundary(filters.endDate, true);
  const projectFilter = filters.projectId?.trim() || null;
  const modelFilter = filters.model?.trim() || null;
  const searchQuery = filters.search?.trim().toLowerCase() || null;

  // 1. Collect all available projects and models from the full dataset (for filter dropdowns)
  const availableProjectMap = new Map<string, string>();
  const availableModelMap = new Map<string, { id: string; label: string; isFallback?: boolean }>();

  for (const conv of dataset.conversations.values()) {
    availableProjectMap.set(conv.meta.projectId, conv.meta.projectDisplayName);
    const override = pricing.conversationModelOverrides?.[conv.meta.id] ?? null;
    for (const raw of conv.steps) {
      if (raw.inputTokens === 0 && raw.cacheReadTokens === 0 && raw.outputTokens === 0) continue;
      if (raw.rawModel === null && !override && !pricing.includeUntagged) continue;
      const resolved = resolveModelPricing(raw.rawModel, pricing, override);
      const existing = availableModelMap.get(resolved.resolvedModelId);
      if (!existing) {
        availableModelMap.set(resolved.resolvedModelId, {
          id: resolved.resolvedModelId,
          label: resolved.pricing.label,
          ...(resolved.isFallback ? { isFallback: true } : {}),
        });
      } else if (!resolved.isFallback && existing.isFallback) {
        existing.isFallback = false;
      }
    }
  }

  const availableProjects = Array.from(availableProjectMap.entries())
    .map(([id, displayName]) => ({ id, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const availableModels = Array.from(availableModelMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  // 2. Compute direct metrics per conversation (applying date + model filters to steps)
  const directMap = new Map<string, DirectConvComputation>();
  for (const [id, conv] of dataset.conversations.entries()) {
    directMap.set(id, computeDirectConversation(conv, pricing, startMs, endMs, modelFilter));
  }

  // 3. Determine which conversations pass conversation-level filters
  const hasDateFilter = startMs !== null || endMs !== null;
  const includedConvIds: string[] = [];
  const includedSet = new Set<string>();

  for (const [id, entry] of directMap.entries()) {
    const meta = entry.conv.meta;

    if (!filters.includeSubagents && meta.parentConversationId !== null) {
      continue;
    }

    if (projectFilter && meta.projectId !== projectFilter) {
      continue;
    }

    if (searchQuery) {
      const haystack = [
        meta.title,
        meta.projectDisplayName,
        meta.workspacePath ?? '',
        meta.agentName ?? '',
        meta.id,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(searchQuery)) {
        continue;
      }
    }

    if (modelFilter && entry.direct.tokenStepCount === 0) {
      continue;
    }

    if (hasDateFilter) {
      if (entry.conv.hasTranscript) {
        if (entry.filteredSteps.length === 0) continue;
      } else {
        const modMs = meta.lastModifiedTime ? Date.parse(meta.lastModifiedTime) : Number.NaN;
        if (Number.isNaN(modMs)) continue;
        if (startMs !== null && modMs < startMs) continue;
        if (endMs !== null && modMs > endMs) continue;
      }
    }

    includedConvIds.push(id);
    includedSet.add(id);
  }

  // 4. Build ConversationSummary list (sorted by last activity desc)
  const conversations: ConversationSummary[] = includedConvIds
    .map((id) => buildConversationSummary(id, directMap, dataset.conversations))
    .sort((a, b) => {
      const aTime = a.lastStepAt ?? a.lastModifiedTime ?? '';
      const bTime = b.lastStepAt ?? b.lastModifiedTime ?? '';
      if (aTime !== bTime) return bTime.localeCompare(aTime);
      return b.rolledUp.cost.totalCost - a.rolledUp.cost.totalCost;
    });

  // 5. Aggregate global KPIs, time-series, heatmaps, models, tools, efficiency, scatter, Sankey, and expensive turns
  let totalUncached = 0;
  let totalCacheRead = 0;
  let totalOutput = 0;
  const totalCost = createEmptyCostTotals();
  let mainConversationCount = 0;
  let subagentCount = 0;
  let transcriptCount = 0;
  let totalSteps = 0;
  let tokenBearingSteps = 0;
  let totalUserPrompts = 0;
  let totalErrors = 0;
  let totalErrorCost = 0;
  let totalErrorTokens = 0;
  let totalCacheMissSpikes = 0;
  let totalCacheMissWastedCost = 0;
  let totalLongContextSteps = 0;
  let totalLongContextSurcharge = 0;
  let totalActiveMs = 0;
  const allLatenciesMs: number[] = [];
  let totalLatencyOutputTokens = 0;
  let totalLatencyMs = 0;
  let totalThinkingChars = 0;
  let totalContentChars = 0;
  let totalMediaSteps = 0;
  let totalToolCalls = 0;

  interface BucketAcc {
    bucket: string;
    label: string;
    uncachedInput: number;
    cacheRead: number;
    output: number;
    totalTokens: number;
    totalCost: number;
    cacheSavings: number;
    steps: number;
    byModelCost: Record<string, number>;
    byModelTokens: Record<string, number>;
    byProjectCost: Record<string, number>;
    conversations: Set<string>;
  }

  const dailyBuckets = new Map<string, BucketAcc>();
  const hourlyBuckets = new Map<string, BucketAcc>();

  const hourDayMatrix: HourDayCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      hourDayMatrix.push({
        dayOfWeek: d,
        hour: h,
        steps: 0,
        totalTokens: 0,
        totalCost: 0,
      });
    }
  }

  interface ModelAcc {
    modelId: string;
    label: string;
    provider: ModelProvider;
    color: string;
    isFallback: boolean;
    steps: number;
    conversations: Set<string>;
    uncachedInput: number;
    cacheRead: number;
    output: number;
    cost: CostTotals;
    latenciesMs: number[];
    cacheMissSpikes: number;
    errorCount: number;
    errorCost: number;
    longContextSteps: number;
  }

  const modelAccMap = new Map<string, ModelAcc>();

  interface ToolAcc {
    name: string;
    calls: number;
    errorCount: number;
    conversations: Set<string>;
  }

  const toolAccMap = new Map<string, ToolAcc>();
  const toolChainMap = new Map<string, number>();
  const expensiveTurnsCandidates: ExpensiveTurn[] = [];
  const allScatterCandidates: ScatterTurnPoint[] = [];

  // Sankey accumulators: project -> model -> component
  const projToModelCost = new Map<string, Map<string, number>>();
  const modelToCompCost = new Map<string, { input: number; cache: number; output: number }>();
  const projectDisplayNames = new Map<string, string>();
  const modelMetaForSankey = new Map<string, { label: string; color: string }>();

  // Error cost by project
  const projectErrorMap = new Map<string, ProjectErrorCost>();

  for (const id of includedConvIds) {
    const entry = directMap.get(id)!;
    const meta = entry.conv.meta;
    projectDisplayNames.set(meta.projectId, meta.projectDisplayName);

    if (meta.parentConversationId === null) {
      mainConversationCount += 1;
    } else {
      subagentCount += 1;
    }
    if (entry.conv.hasTranscript) {
      transcriptCount += 1;
    }

    totalUncached += entry.direct.tokens.uncachedInput;
    totalCacheRead += entry.direct.tokens.cacheRead;
    totalOutput += entry.direct.tokens.output;
    addCostTotals(totalCost, entry.direct.cost);
    totalSteps += entry.direct.stepCount;
    tokenBearingSteps += entry.direct.tokenStepCount;
    totalUserPrompts += entry.userPrompts;
    totalErrors += entry.errorCount;
    totalErrorCost += entry.errorCost;
    totalErrorTokens += entry.errorTokens;
    totalCacheMissSpikes += entry.cacheMissSpikes;
    totalCacheMissWastedCost += entry.cacheMissWastedCost;
    totalLongContextSteps += entry.longContextSteps;
    totalLongContextSurcharge += entry.longContextSurcharge;
    totalActiveMs += entry.activeDurationMs;
    for (const l of entry.latenciesMs) allLatenciesMs.push(l);
    totalLatencyOutputTokens += entry.latencyOutputTokens;
    totalLatencyMs += entry.latencyTotalMs;
    totalThinkingChars += entry.thinkingChars;
    totalContentChars += entry.contentChars;
    totalMediaSteps += entry.mediaSteps;

    if (entry.errorCount > 0) {
      let pe = projectErrorMap.get(meta.projectId);
      if (!pe) {
        pe = {
          projectId: meta.projectId,
          displayName: meta.projectDisplayName,
          errors: 0,
          errorCost: 0,
          errorTokens: 0,
        };
        projectErrorMap.set(meta.projectId, pe);
      }
      pe.errors += entry.errorCount;
      pe.errorCost += entry.errorCost;
      pe.errorTokens += entry.errorTokens;
    }

    for (const [toolName, count] of Object.entries(entry.toolCallCounts)) {
      totalToolCalls += count;
      let tAcc = toolAccMap.get(toolName);
      if (!tAcc) {
        tAcc = { name: toolName, calls: 0, errorCount: 0, conversations: new Set() };
        toolAccMap.set(toolName, tAcc);
      }
      tAcc.calls += count;
      tAcc.errorCount += entry.toolErrorCounts[toolName] ?? 0;
      tAcc.conversations.add(id);
    }

    let prevToolName: string | null = null;
    for (const item of entry.filteredSteps) {
      const { step, cost, isTokenBearing } = item;
      const stepTotalTokens = step.inputTokens + step.cacheReadTokens + step.outputTokens;
      const stepContext = step.inputTokens + step.cacheReadTokens;

      // Track consecutive tool-call bigrams (workflows)
      for (const tc of step.toolCalls) {
        if (prevToolName) {
          const key = `${prevToolName}\0${tc}`;
          toolChainMap.set(key, (toolChainMap.get(key) ?? 0) + 1);
        }
        prevToolName = tc;
      }

      // Time-series & heatmaps
      const tsStr = step.createdAt ?? meta.lastModifiedTime;
      if (tsStr) {
        const dt = new Date(tsStr);
        if (!Number.isNaN(dt.getTime())) {
          const dayKey = tsStr.slice(0, 10);
          const hourKey = `${tsStr.slice(0, 13)}:00:00Z`;

          let dBucket = dailyBuckets.get(dayKey);
          if (!dBucket) {
            dBucket = {
              bucket: dayKey,
              label: formatDayLabel(dayKey),
              uncachedInput: 0,
              cacheRead: 0,
              output: 0,
              totalTokens: 0,
              totalCost: 0,
              cacheSavings: 0,
              steps: 0,
              byModelCost: {},
              byModelTokens: {},
              byProjectCost: {},
              conversations: new Set(),
            };
            dailyBuckets.set(dayKey, dBucket);
          }
          dBucket.uncachedInput += step.inputTokens;
          dBucket.cacheRead += step.cacheReadTokens;
          dBucket.output += step.outputTokens;
          dBucket.totalTokens += stepTotalTokens;
          dBucket.totalCost += cost.totalCost;
          dBucket.cacheSavings += cost.cacheSavings;
          dBucket.steps += 1;
          dBucket.conversations.add(id);
          if (isTokenBearing) {
            dBucket.byModelCost[step.model] =
              (dBucket.byModelCost[step.model] ?? 0) + cost.totalCost;
            dBucket.byModelTokens[step.model] =
              (dBucket.byModelTokens[step.model] ?? 0) + stepTotalTokens;
            dBucket.byProjectCost[meta.projectId] =
              (dBucket.byProjectCost[meta.projectId] ?? 0) + cost.totalCost;
          }

          let hBucket = hourlyBuckets.get(hourKey);
          if (!hBucket) {
            hBucket = {
              bucket: hourKey,
              label: formatHourLabel(hourKey),
              uncachedInput: 0,
              cacheRead: 0,
              output: 0,
              totalTokens: 0,
              totalCost: 0,
              cacheSavings: 0,
              steps: 0,
              byModelCost: {},
              byModelTokens: {},
              byProjectCost: {},
              conversations: new Set(),
            };
            hourlyBuckets.set(hourKey, hBucket);
          }
          hBucket.uncachedInput += step.inputTokens;
          hBucket.cacheRead += step.cacheReadTokens;
          hBucket.output += step.outputTokens;
          hBucket.totalTokens += stepTotalTokens;
          hBucket.totalCost += cost.totalCost;
          hBucket.cacheSavings += cost.cacheSavings;
          hBucket.steps += 1;
          hBucket.conversations.add(id);
          if (isTokenBearing) {
            hBucket.byModelCost[step.model] =
              (hBucket.byModelCost[step.model] ?? 0) + cost.totalCost;
            hBucket.byModelTokens[step.model] =
              (hBucket.byModelTokens[step.model] ?? 0) + stepTotalTokens;
            hBucket.byProjectCost[meta.projectId] =
              (hBucket.byProjectCost[meta.projectId] ?? 0) + cost.totalCost;
          }

          const cellIdx = dt.getUTCDay() * 24 + dt.getUTCHours();
          const cell = hourDayMatrix[cellIdx];
          if (cell) {
            cell.steps += 1;
            cell.totalTokens += stepTotalTokens;
            cell.totalCost += cost.totalCost;
          }
        }
      }

      // Per-model stats, Sankey, scatter & expensive turns
      if (isTokenBearing) {
        const modelKey = `${step.model}|${step.isFallbackModel ? '1' : '0'}`;
        const modelLabel = step.isFallbackModel ? `Untagged (est. ${item.label})` : item.label;
        let mAcc = modelAccMap.get(modelKey);
        if (!mAcc) {
          mAcc = {
            modelId: step.model,
            label: modelLabel,
            provider: item.provider,
            color: item.color,
            isFallback: step.isFallbackModel,
            steps: 0,
            conversations: new Set(),
            uncachedInput: 0,
            cacheRead: 0,
            output: 0,
            cost: createEmptyCostTotals(),
            latenciesMs: [],
            cacheMissSpikes: 0,
            errorCount: 0,
            errorCost: 0,
            longContextSteps: 0,
          };
          modelAccMap.set(modelKey, mAcc);
        }
        mAcc.steps += 1;
        mAcc.conversations.add(id);
        mAcc.uncachedInput += step.inputTokens;
        mAcc.cacheRead += step.cacheReadTokens;
        mAcc.output += step.outputTokens;
        addCostTotals(mAcc.cost, cost);
        if (step.latencyMs != null) mAcc.latenciesMs.push(step.latencyMs);
        if (step.isCacheMissSpike) mAcc.cacheMissSpikes += 1;
        if (step.hasError) {
          mAcc.errorCount += 1;
          mAcc.errorCost += cost.totalCost;
        }
        if (step.isLongContext) mAcc.longContextSteps += 1;

        // Sankey links
        modelMetaForSankey.set(modelKey, { label: modelLabel, color: item.color });
        let pMap = projToModelCost.get(meta.projectId);
        if (!pMap) {
          pMap = new Map();
          projToModelCost.set(meta.projectId, pMap);
        }
        pMap.set(modelKey, (pMap.get(modelKey) ?? 0) + cost.totalCost);

        let cAcc = modelToCompCost.get(modelKey);
        if (!cAcc) {
          cAcc = { input: 0, cache: 0, output: 0 };
          modelToCompCost.set(modelKey, cAcc);
        }
        cAcc.input += cost.inputCost;
        cAcc.cache += cost.cacheReadCost;
        cAcc.output += cost.outputCost;

        expensiveTurnsCandidates.push({
          conversationId: id,
          conversationTitle: meta.title,
          projectDisplayName: meta.projectDisplayName,
          stepIndex: step.stepIndex,
          createdAt: step.createdAt,
          model: step.model,
          isFallbackModel: step.isFallbackModel,
          inputTokens: step.inputTokens,
          cacheReadTokens: step.cacheReadTokens,
          outputTokens: step.outputTokens,
          totalContext: stepContext,
          cost: cost.totalCost,
          toolCalls: step.toolCalls,
          hasError: step.hasError,
          isCacheMissSpike: step.isCacheMissSpike,
          isLongContext: step.isLongContext,
          latencyMs: step.latencyMs ?? null,
        });

        allScatterCandidates.push({
          conversationId: id,
          conversationTitle: meta.title,
          projectDisplayName: meta.projectDisplayName,
          stepIndex: step.stepIndex,
          model: step.model,
          totalContext: stepContext,
          uncachedInput: step.inputTokens,
          cacheRead: step.cacheReadTokens,
          outputTokens: step.outputTokens,
          cost: cost.totalCost,
          cacheHitRatio: stepContext > 0 ? step.cacheReadTokens / stepContext : 0,
          isCacheMissSpike: Boolean(step.isCacheMissSpike),
          hasError: step.hasError,
          isLongContext: Boolean(step.isLongContext),
          latencyMs: step.latencyMs ?? null,
        });
      }
    }
  }

  // 6. Finalize time-series & calendar heatmap
  const sortedDayKeys = Array.from(dailyBuckets.keys()).sort();
  let dailyCumulative = 0;
  const dailySeries: TimeSeriesPoint[] = [];
  const calendarHeatmap: CalendarDay[] = [];

  for (const key of sortedDayKeys) {
    const b = dailyBuckets.get(key)!;
    dailyCumulative += b.totalCost;
    dailySeries.push({
      bucket: b.bucket,
      label: b.label,
      uncachedInput: b.uncachedInput,
      cacheRead: b.cacheRead,
      output: b.output,
      totalTokens: b.totalTokens,
      totalCost: b.totalCost,
      cumulativeCost: dailyCumulative,
      cacheSavings: b.cacheSavings,
      steps: b.steps,
      byModelCost: b.byModelCost,
      byModelTokens: b.byModelTokens,
      byProjectCost: b.byProjectCost,
    });
    calendarHeatmap.push({
      date: b.bucket,
      totalTokens: b.totalTokens,
      totalCost: b.totalCost,
      cacheSavings: b.cacheSavings,
      steps: b.steps,
      conversations: b.conversations.size,
    });
  }

  const sortedHourKeys = Array.from(hourlyBuckets.keys()).sort();
  let hourlyCumulative = 0;
  const hourlySeries: TimeSeriesPoint[] = sortedHourKeys.map((key) => {
    const b = hourlyBuckets.get(key)!;
    hourlyCumulative += b.totalCost;
    return {
      bucket: b.bucket,
      label: b.label,
      uncachedInput: b.uncachedInput,
      cacheRead: b.cacheRead,
      output: b.output,
      totalTokens: b.totalTokens,
      totalCost: b.totalCost,
      cumulativeCost: hourlyCumulative,
      cacheSavings: b.cacheSavings,
      steps: b.steps,
      byModelCost: b.byModelCost,
      byModelTokens: b.byModelTokens,
      byProjectCost: b.byProjectCost,
    };
  });

  // 7. Finalize Projects aggregation
  interface ProjectAcc {
    id: string;
    workspacePath: string | null;
    displayName: string;
    projectIds: Set<string>;
    conversationCount: number;
    subagentCount: number;
    directUncached: number;
    directCache: number;
    directOutput: number;
    directCost: CostTotals;
    directSteps: number;
    directTokenSteps: number;
    rolledUncached: number;
    rolledCache: number;
    rolledOutput: number;
    rolledCost: CostTotals;
    rolledSteps: number;
    rolledTokenSteps: number;
    modelCost: Map<string, number>;
    tools: Map<string, ToolAcc>;
    activeDurationMs: number;
    cacheMissSpikes: number;
    cacheMissWastedCost: number;
    errorCount: number;
    errorCost: number;
    longContextSteps: number;
    firstActiveAt: string | null;
    lastActiveAt: string | null;
  }

  const projectAccMap = new Map<string, ProjectAcc>();

  for (const [id, entry] of directMap.entries()) {
    const meta = entry.conv.meta;

    if (projectFilter && meta.projectId !== projectFilter) continue;
    if (searchQuery) {
      const haystack = [
        meta.title,
        meta.projectDisplayName,
        meta.workspacePath ?? '',
        meta.agentName ?? '',
        meta.id,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(searchQuery)) continue;
    }
    if (modelFilter && entry.direct.tokenStepCount === 0) continue;
    if (hasDateFilter) {
      if (entry.conv.hasTranscript) {
        if (entry.filteredSteps.length === 0) continue;
      } else {
        const modMs = meta.lastModifiedTime ? Date.parse(meta.lastModifiedTime) : Number.NaN;
        if (Number.isNaN(modMs)) continue;
        if (startMs !== null && modMs < startMs) continue;
        if (endMs !== null && modMs > endMs) continue;
      }
    }

    const isSubagent = meta.parentConversationId !== null;

    let pAcc = projectAccMap.get(meta.projectId);
    if (!pAcc) {
      pAcc = {
        id: meta.projectId,
        workspacePath: meta.workspacePath,
        displayName: meta.projectDisplayName,
        projectIds: new Set(),
        conversationCount: 0,
        subagentCount: 0,
        directUncached: 0,
        directCache: 0,
        directOutput: 0,
        directCost: createEmptyCostTotals(),
        directSteps: 0,
        directTokenSteps: 0,
        rolledUncached: 0,
        rolledCache: 0,
        rolledOutput: 0,
        rolledCost: createEmptyCostTotals(),
        rolledSteps: 0,
        rolledTokenSteps: 0,
        modelCost: new Map(),
        tools: new Map(),
        activeDurationMs: 0,
        cacheMissSpikes: 0,
        cacheMissWastedCost: 0,
        errorCount: 0,
        errorCost: 0,
        longContextSteps: 0,
        firstActiveAt: null,
        lastActiveAt: null,
      };
      projectAccMap.set(meta.projectId, pAcc);
    }

    if (meta.rawProjectId) {
      pAcc.projectIds.add(meta.rawProjectId);
    }

    if (isSubagent) {
      pAcc.subagentCount += 1;
    } else {
      pAcc.conversationCount += 1;
      pAcc.directUncached += entry.direct.tokens.uncachedInput;
      pAcc.directCache += entry.direct.tokens.cacheRead;
      pAcc.directOutput += entry.direct.tokens.output;
      addCostTotals(pAcc.directCost, entry.direct.cost);
      pAcc.directSteps += entry.direct.stepCount;
      pAcc.directTokenSteps += entry.direct.tokenStepCount;
    }

    pAcc.rolledUncached += entry.direct.tokens.uncachedInput;
    pAcc.rolledCache += entry.direct.tokens.cacheRead;
    pAcc.rolledOutput += entry.direct.tokens.output;
    addCostTotals(pAcc.rolledCost, entry.direct.cost);
    pAcc.rolledSteps += entry.direct.stepCount;
    pAcc.rolledTokenSteps += entry.direct.tokenStepCount;

    if (filters.includeSubagents || !isSubagent) {
      pAcc.activeDurationMs += entry.activeDurationMs;
      pAcc.cacheMissSpikes += entry.cacheMissSpikes;
      pAcc.cacheMissWastedCost += entry.cacheMissWastedCost;
      pAcc.errorCount += entry.errorCount;
      pAcc.errorCost += entry.errorCost;
      pAcc.longContextSteps += entry.longContextSteps;

      for (const item of entry.filteredSteps) {
        if (!item.isTokenBearing) continue;
        pAcc.modelCost.set(
          item.step.model,
          (pAcc.modelCost.get(item.step.model) ?? 0) + item.cost.totalCost,
        );
      }

      for (const [toolName, count] of Object.entries(entry.toolCallCounts)) {
        let tAcc = pAcc.tools.get(toolName);
        if (!tAcc) {
          tAcc = { name: toolName, calls: 0, errorCount: 0, conversations: new Set() };
          pAcc.tools.set(toolName, tAcc);
        }
        tAcc.calls += count;
        tAcc.errorCount += entry.toolErrorCounts[toolName] ?? 0;
        tAcc.conversations.add(id);
      }
    }

    const first = entry.firstStepAt ?? meta.lastModifiedTime;
    const last = entry.lastStepAt ?? meta.lastModifiedTime;
    if (first && (!pAcc.firstActiveAt || first < pAcc.firstActiveAt)) {
      pAcc.firstActiveAt = first;
    }
    if (last && (!pAcc.lastActiveAt || last > pAcc.lastActiveAt)) {
      pAcc.lastActiveAt = last;
    }
  }

  const projects: ProjectSummary[] = Array.from(projectAccMap.values())
    .map((p) => {
      const sortedModels = Array.from(p.modelCost.entries()).sort((a, b) => b[1] - a[1]);
      const topTools: ToolStat[] = Array.from(p.tools.values())
        .map((t) => ({
          name: t.name,
          calls: t.calls,
          errorCount: t.errorCount,
          conversationCount: t.conversations.size,
        }))
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 10);

      const rolledTokens = computeTokenTotals(p.rolledUncached, p.rolledCache, p.rolledOutput);
      const projEff = computeEfficiencyScore({
        cacheHitRatio: rolledTokens.cacheHitRatio,
        tokenStepCount: p.rolledTokenSteps,
        stepCount: p.rolledSteps,
        cacheMissSpikes: p.cacheMissSpikes,
        errorCount: p.errorCount,
        outputTokens: rolledTokens.output,
        uncachedInputTokens: rolledTokens.uncachedInput,
      });

      return {
        id: p.id,
        workspacePath: p.workspacePath,
        displayName: p.displayName,
        projectIds: Array.from(p.projectIds),
        conversationCount: p.conversationCount,
        subagentCount: p.subagentCount,
        direct: {
          tokens: computeTokenTotals(p.directUncached, p.directCache, p.directOutput),
          cost: p.directCost,
          stepCount: p.directSteps,
          tokenStepCount: p.directTokenSteps,
        },
        rolledUp: {
          tokens: rolledTokens,
          cost: p.rolledCost,
          stepCount: p.rolledSteps,
          tokenStepCount: p.rolledTokenSteps,
        },
        modelsUsed: sortedModels.map(([m]) => m),
        primaryModel: sortedModels[0]?.[0] ?? null,
        topTools,
        activeDurationMs: p.activeDurationMs,
        cacheMissSpikes: p.cacheMissSpikes,
        cacheMissWastedCost: p.cacheMissWastedCost,
        errorCount: p.errorCount,
        errorCost: p.errorCost,
        longContextSteps: p.longContextSteps,
        efficiencyScore: projEff.score,
        efficiencyGrade: projEff.grade,
        firstActiveAt: p.firstActiveAt,
        lastActiveAt: p.lastActiveAt,
      };
    })
    .sort((a, b) => b.rolledUp.cost.totalCost - a.rolledUp.cost.totalCost);

  // 8. Build Sankey Data (Top 8 projects + Other -> Models -> Cost Components)
  const sankey = buildSankeyData(
    projToModelCost,
    modelToCompCost,
    projectDisplayNames,
    modelMetaForSankey,
  );

  // 9. Build Scatter Turns (all spikes + errors + long-context + top 80 cost + uniform sample up to 650)
  const scatterTurns = buildScatterSample(allScatterCandidates, 650);

  // 10. Build Swarm & Multi-Agent Analytics
  const swarmAnalytics = buildSwarmAnalytics(includedSet, directMap, dataset.conversations);

  // 11. Finalize KPIs, models, tools, efficiency, What-If, Subscription ROI, and top 25 expensive turns
  const globalTokens = computeTokenTotals(totalUncached, totalCacheRead, totalOutput);
  const activeDays = sortedDayKeys.length;
  const dailyBurnRate = activeDays > 0 ? totalCost.totalCost / activeDays : 0;
  const projectedMonthlyCost = dailyBurnRate * 30;
  const { currentStreakDays, longestStreakDays } = computeStreaks(sortedDayKeys, now);
  const conversationCount = includedConvIds.length;

  const kpis: DashboardKpis = {
    tokens: globalTokens,
    cost: totalCost,
    cacheSavingsPercent:
      totalCost.costWithoutCache > 0 ? totalCost.cacheSavings / totalCost.costWithoutCache : 0,
    conversationCount,
    mainConversationCount,
    subagentCount,
    transcriptCount,
    totalSteps,
    tokenBearingSteps,
    userPrompts: totalUserPrompts,
    avgCostPerConversation: conversationCount > 0 ? totalCost.totalCost / conversationCount : 0,
    avgCostPerPrompt: totalUserPrompts > 0 ? totalCost.totalCost / totalUserPrompts : 0,
    avgTokensPerTurn: tokenBearingSteps > 0 ? globalTokens.totalTokens / tokenBearingSteps : 0,
    dailyBurnRate,
    projectedMonthlyCost,
    activeDays,
    currentStreakDays,
    longestStreakDays,
  };

  allLatenciesMs.sort((a, b) => a - b);
  const errorCostByProject = Array.from(projectErrorMap.values())
    .sort((a, b) => b.errorCost - a.errorCost)
    .slice(0, 12);

  const globalEff = computeEfficiencyScore({
    cacheHitRatio: globalTokens.cacheHitRatio,
    tokenStepCount: tokenBearingSteps,
    stepCount: totalSteps,
    cacheMissSpikes: totalCacheMissSpikes,
    errorCount: totalErrors,
    outputTokens: globalTokens.output,
    uncachedInputTokens: globalTokens.uncachedInput,
  });

  const optimizationTips: string[] = [];
  if (totalCacheMissSpikes > 0 && totalCacheMissWastedCost >= 1) {
    optimizationTips.push(
      `${totalCacheMissSpikes} cache-miss spikes cost $${totalCacheMissWastedCost.toFixed(2)} extra — starting fresh chats for unrelated tasks prevents mid-session cache evictions.`,
    );
  }
  if (totalLongContextSteps > 20) {
    optimizationTips.push(
      `${totalLongContextSteps.toLocaleString()} turns exceeded ${(pricing.longContextThreshold / 1000).toFixed(0)}K context — compacting long threads keeps API long-context multipliers low.`,
    );
  }
  if (globalTokens.cacheHitRatio >= 0.9) {
    optimizationTips.push(
      `Strong ${(globalTokens.cacheHitRatio * 100).toFixed(1)}% cache hit ratio saved $${totalCost.cacheSavings.toFixed(2)} (${(kpis.cacheSavingsPercent * 100).toFixed(0)}% bill reduction).`,
    );
  } else if (tokenBearingSteps > 0) {
    optimizationTips.push(
      `Cache hit ratio is ${(globalTokens.cacheHitRatio * 100).toFixed(1)}% — batching related edits within the same chat window improves prompt cache reuse.`,
    );
  }
  if (totalErrorCost >= 0.5) {
    optimizationTips.push(
      `Error steps and retries burned $${totalErrorCost.toFixed(2)} across ${totalErrors} steps — check Error Burn by Project to spot flaky commands or tools.`,
    );
  }

  const efficiency: EfficiencyMetrics = {
    totalToolCalls,
    toolCallsPerConversation: conversationCount > 0 ? totalToolCalls / conversationCount : 0,
    toolCallsPerTurn: tokenBearingSteps > 0 ? totalToolCalls / tokenBearingSteps : 0,
    errorRate: totalSteps > 0 ? totalErrors / totalSteps : 0,
    totalErrors,
    totalThinkingChars,
    totalContentChars,
    thinkingToOutputRatio: totalContentChars > 0 ? totalThinkingChars / totalContentChars : 0,
    promptToOutputLeverage: totalUserPrompts > 0 ? globalTokens.output / totalUserPrompts : 0,
    mediaSteps: totalMediaSteps,
    totalActiveMs,
    medianLatencyMs: computePercentile(allLatenciesMs, 0.5),
    p95LatencyMs: computePercentile(allLatenciesMs, 0.95),
    avgOutputTokensPerSec:
      totalLatencyMs > 0 ? totalLatencyOutputTokens / (totalLatencyMs / 1000) : 0,
    costPerActiveHour:
      totalActiveMs > 0 ? totalCost.totalCost / (totalActiveMs / 3_600_000) : 0,
    cacheMissSpikes: totalCacheMissSpikes,
    cacheMissWastedCost: totalCacheMissWastedCost,
    longContextSteps: totalLongContextSteps,
    longContextSurcharge: totalLongContextSurcharge,
    errorCost: totalErrorCost,
    errorTokens: totalErrorTokens,
    errorCostByProject,
    efficiencyScore: globalEff.score,
    efficiencyGrade: globalEff.grade,
    optimizationTips,
  };

  const funInsights = buildFunInsights(globalTokens, dailySeries, hourlySeries, hourDayMatrix);
  const periodDeltas = buildPeriodDeltas(dailySeries);
  const toolChains: ToolChainStat[] = Array.from(toolChainMap.entries())
    .map(([k, count]) => {
      const [from, to] = k.split('\0');
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const subscriptionRoi = calculateSubscriptionRoi(
    pricing.monthlySubscriptionUsd,
    projectedMonthlyCost,
    totalCost.totalCost,
    dailyBurnRate,
  );

  const models: ModelStat[] = Array.from(modelAccMap.values())
    .map((m) => {
      const tokens = computeTokenTotals(m.uncachedInput, m.cacheRead, m.output);
      const sortedLat = [...m.latenciesMs].sort((a, b) => a - b);
      return {
        modelId: m.modelId,
        label: m.label,
        provider: m.provider,
        color: m.color,
        isFallback: m.isFallback,
        steps: m.steps,
        conversations: m.conversations.size,
        tokens,
        cost: m.cost,
        avgOutputPerStep: m.steps > 0 ? tokens.output / m.steps : 0,
        avgContextPerStep: m.steps > 0 ? tokens.totalContext / m.steps : 0,
        costShare: totalCost.totalCost > 0 ? m.cost.totalCost / totalCost.totalCost : 0,
        tokenShare: globalTokens.totalTokens > 0 ? tokens.totalTokens / globalTokens.totalTokens : 0,
        medianLatencyMs: computePercentile(sortedLat, 0.5),
        cacheMissSpikes: m.cacheMissSpikes,
        errorCount: m.errorCount,
        errorCost: m.errorCost,
        longContextSteps: m.longContextSteps,
      };
    })
    .sort((a, b) => b.cost.totalCost - a.cost.totalCost);

  const tools: ToolStat[] = Array.from(toolAccMap.values())
    .map((t) => ({
      name: t.name,
      calls: t.calls,
      errorCount: t.errorCount,
      conversationCount: t.conversations.size,
    }))
    .sort((a, b) => b.calls - a.calls);

  const whatIf = calculateWhatIfComparisons(globalTokens, totalCost.totalCost, pricing);

  const expensiveTurns = expensiveTurnsCandidates
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 25);

  // 10b. Build Quota & Reset Window Analytics (ignoring startDate/endDate filter so all cycles remain selectable)
  const resetAnalytics = buildResetAnalytics(
    dataset,
    pricing,
    {
      includeSubagents: filters.includeSubagents,
      projectId: projectFilter,
      model: modelFilter,
      search: searchQuery,
    },
    now,
  );

  const appliedFilters: DashboardFilters = {
    ...(filters.startDate ? { startDate: filters.startDate } : {}),
    ...(filters.endDate ? { endDate: filters.endDate } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    includeSubagents: filters.includeSubagents,
  };

  return {
    generatedAt: now.toISOString(),
    dataDir: dataset.dataDir,
    watchedFiles: dataset.watchedFiles,
    appliedFilters,
    pricing,
    kpis,
    efficiency,
    subscriptionRoi,
    funInsights,
    periodDeltas,
    toolChains,
    resetAnalytics,
    sankey,
    scatterTurns,
    swarmAnalytics,
    dailySeries,
    hourlySeries,
    calendarHeatmap,
    hourDayHeatmap: hourDayMatrix,
    projects,
    conversations,
    models,
    tools,
    whatIf,
    expensiveTurns,
    availableProjects,
    availableModels,
  };
}

function buildSankeyData(
  projToModelCost: Map<string, Map<string, number>>,
  modelToCompCost: Map<string, { input: number; cache: number; output: number }>,
  projectDisplayNames: Map<string, string>,
  modelMeta: Map<string, { label: string; color: string }>,
): SankeyData {
  // Rank projects by total spend
  const projectTotals: { projectId: string; total: number }[] = [];
  for (const [pId, mMap] of projToModelCost.entries()) {
    let sum = 0;
    for (const v of mMap.values()) sum += v;
    if (sum > 0.0001) projectTotals.push({ projectId: pId, total: sum });
  }
  projectTotals.sort((a, b) => b.total - a.total);

  const topProjectIds = new Set(projectTotals.slice(0, 7).map((p) => p.projectId));
  const nodesMap = new Map<string, SankeyNode>();
  const linkAcc = new Map<string, number>();

  const projectPalette = [
    '#6366f1',
    '#38bdf8',
    '#10b981',
    '#f59e0b',
    '#ec4899',
    '#a78bfa',
    '#22d3ee',
    '#64748b',
  ];

  let pIdx = 0;
  for (const { projectId } of projectTotals) {
    const isTop = topProjectIds.has(projectId);
    const pNodeKey = isTop ? `p:${projectId}` : 'p:__other__';
    if (!nodesMap.has(pNodeKey)) {
      nodesMap.set(pNodeKey, {
        name: pNodeKey,
        label: isTop ? (projectDisplayNames.get(projectId) ?? projectId) : 'Other Projects',
        category: 'project',
        color: isTop ? projectPalette[pIdx++ % 7] : '#64748b',
      });
    }

    const mMap = projToModelCost.get(projectId)!;
    for (const [modelKey, val] of mMap.entries()) {
      if (val <= 0.0001) continue;
      const mNodeKey = `m:${modelKey}`;
      if (!nodesMap.has(mNodeKey)) {
        const meta = modelMeta.get(modelKey);
        nodesMap.set(mNodeKey, {
          name: mNodeKey,
          label: meta?.label ?? modelKey,
          category: 'model',
          color: meta?.color ?? '#94a3b8',
        });
      }
      const lKey = `${pNodeKey}\0${mNodeKey}`;
      linkAcc.set(lKey, (linkAcc.get(lKey) ?? 0) + val);
    }
  }

  const compDefs: { key: string; label: string; field: 'input' | 'cache' | 'output'; color: string }[] = [
    { key: 'c:input', label: 'Uncached Input', field: 'input', color: '#38bdf8' },
    { key: 'c:cache', label: 'Cache Read', field: 'cache', color: '#34d399' },
    { key: 'c:output', label: 'Output Tokens', field: 'output', color: '#a78bfa' },
  ];

  for (const [modelKey, comp] of modelToCompCost.entries()) {
    const mNodeKey = `m:${modelKey}`;
    if (!nodesMap.has(mNodeKey)) continue;
    for (const def of compDefs) {
      const val = comp[def.field];
      if (val <= 0.0001) continue;
      if (!nodesMap.has(def.key)) {
        nodesMap.set(def.key, {
          name: def.key,
          label: def.label,
          category: 'component',
          color: def.color,
        });
      }
      const lKey = `${mNodeKey}\0${def.key}`;
      linkAcc.set(lKey, (linkAcc.get(lKey) ?? 0) + val);
    }
  }

  const links: SankeyLink[] = Array.from(linkAcc.entries())
    .map(([k, value]) => {
      const [source, target] = k.split('\0');
      return { source, target, value: Number(value.toFixed(6)) };
    })
    .filter((l) => l.value > 0);

  return {
    nodes: Array.from(nodesMap.values()),
    links,
  };
}

function buildScatterSample(all: ScatterTurnPoint[], maxPoints: number): ScatterTurnPoint[] {
  if (all.length <= maxPoints) return all;

  const picked = new Set<number>();
  // Always keep cache-miss spikes, errors, and long-context turns (up to 350)
  for (let i = 0; i < all.length && picked.size < 350; i++) {
    const pt = all[i];
    if (pt.isCacheMissSpike || pt.hasError || pt.isLongContext) {
      picked.add(i);
    }
  }

  // Always keep top 80 most expensive turns
  const byCost = all
    .map((pt, idx) => ({ idx, cost: pt.cost }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 80);
  for (const item of byCost) picked.add(item.idx);

  // Fill remaining slots via uniform stride across the rest
  const remainingSlots = Math.max(0, maxPoints - picked.size);
  const remainingIndices: number[] = [];
  for (let i = 0; i < all.length; i++) {
    if (!picked.has(i)) remainingIndices.push(i);
  }
  if (remainingSlots > 0 && remainingIndices.length > 0) {
    const step = Math.max(1, remainingIndices.length / remainingSlots);
    for (let j = 0; j < remainingIndices.length && picked.size < maxPoints; j += step) {
      picked.add(remainingIndices[Math.floor(j)]);
    }
  }

  return Array.from(picked).map((idx) => all[idx]);
}

function buildSwarmAnalytics(
  includedSet: Set<string>,
  directMap: Map<string, DirectConvComputation>,
  conversations: Map<string, LoadedConversation>,
): SwarmAnalytics {
  interface RoleAcc {
    role: string;
    conversationCount: number;
    steps: number;
    uncachedInput: number;
    cacheRead: number;
    output: number;
    cost: CostTotals;
    activeDurationMs: number;
    errorCount: number;
  }

  const roleAccMap = new Map<string, RoleAcc>();
  let totalSubagents = 0;
  let totalSubagentCost = 0;
  let totalParentCost = 0;
  const sessions: SwarmSessionSummary[] = [];

  for (const id of includedSet) {
    const entry = directMap.get(id);
    if (!entry) continue;
    const meta = entry.conv.meta;

    if (meta.parentConversationId !== null) {
      totalSubagents += 1;
      totalSubagentCost += entry.direct.cost.totalCost;
      const role = meta.agentName?.trim() || 'subagent';
      let rAcc = roleAccMap.get(role);
      if (!rAcc) {
        rAcc = {
          role,
          conversationCount: 0,
          steps: 0,
          uncachedInput: 0,
          cacheRead: 0,
          output: 0,
          cost: createEmptyCostTotals(),
          activeDurationMs: 0,
          errorCount: 0,
        };
        roleAccMap.set(role, rAcc);
      }
      rAcc.conversationCount += 1;
      rAcc.steps += entry.direct.stepCount;
      rAcc.uncachedInput += entry.direct.tokens.uncachedInput;
      rAcc.cacheRead += entry.direct.tokens.cacheRead;
      rAcc.output += entry.direct.tokens.output;
      addCostTotals(rAcc.cost, entry.direct.cost);
      rAcc.activeDurationMs += entry.activeDurationMs;
      rAcc.errorCount += entry.errorCount;
      continue;
    }

    totalParentCost += entry.direct.cost.totalCost;

    // Check if this root conversation spawned subagents
    const descIds = collectDescendants(id, conversations).filter((d) => directMap.has(d));
    if (descIds.length === 0) continue;

    const spans: SwarmSpan[] = [];
    const memberIds = [id, ...descIds];
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = 0;
    let childrenCost = 0;
    let childrenTokens = 0;

    for (const mId of memberIds) {
      const mEntry = directMap.get(mId);
      if (!mEntry) continue;
      const isRoot = mId === id;
      if (!isRoot) {
        childrenCost += mEntry.direct.cost.totalCost;
        childrenTokens += mEntry.direct.tokens.totalTokens;
      }

      const startStr = mEntry.firstStepAt ?? mEntry.conv.meta.lastModifiedTime;
      const endStr = mEntry.lastStepAt ?? mEntry.conv.meta.lastModifiedTime;
      const startMs = startStr ? Date.parse(startStr) : Number.NaN;
      let endMs = endStr ? Date.parse(endStr) : Number.NaN;
      if (Number.isNaN(startMs)) continue;
      if (Number.isNaN(endMs) || endMs <= startMs) {
        endMs = startMs + 5_000; // minimum 5s visual bar
      }
      if (startMs < minStart) minStart = startMs;
      if (endMs > maxEnd) maxEnd = endMs;

      const role = isRoot ? 'coordinator' : mEntry.conv.meta.agentName?.trim() || 'subagent';
      spans.push({
        id: mId,
        title: mEntry.conv.meta.title,
        agentName: role,
        isRoot,
        model: mEntry.modelsUsed[0] ?? 'unknown',
        startMs,
        endMs,
        cost: mEntry.direct.cost.totalCost,
        tokens: mEntry.direct.tokens.totalTokens,
        steps: mEntry.direct.stepCount,
        errors: mEntry.errorCount,
        color: getRoleColor(role, isRoot),
      });
    }

    spans.sort((a, b) => {
      if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
      return a.startMs - b.startMs;
    });

    const parentCost = entry.direct.cost.totalCost;
    const parentTokens = entry.direct.tokens.totalTokens;

    sessions.push({
      rootId: id,
      title: meta.title,
      projectDisplayName: meta.projectDisplayName,
      firstStepAt: Number.isFinite(minStart) ? new Date(minStart).toISOString() : entry.firstStepAt,
      lastStepAt: maxEnd > 0 ? new Date(maxEnd).toISOString() : entry.lastStepAt,
      totalDurationMs: Number.isFinite(minStart) && maxEnd > minStart ? maxEnd - minStart : 0,
      parentCost,
      childrenCost,
      totalCost: parentCost + childrenCost,
      parentTokens,
      childrenTokens,
      subagentCount: descIds.length,
      maxConcurrency: computeMaxConcurrency(spans),
      spans,
    });
  }

  sessions.sort((a, b) => b.totalCost - a.totalCost);

  const roleStats: AgentRoleStat[] = Array.from(roleAccMap.values())
    .map((r) => ({
      role: r.role,
      conversationCount: r.conversationCount,
      steps: r.steps,
      tokens: computeTokenTotals(r.uncachedInput, r.cacheRead, r.output),
      cost: r.cost,
      activeDurationMs: r.activeDurationMs,
      errorCount: r.errorCount,
    }))
    .sort((a, b) => b.cost.totalCost - a.cost.totalCost);

  const totalCombined = totalParentCost + totalSubagentCost;

  return {
    swarmSessionCount: sessions.length,
    totalSubagents,
    avgFanOut: sessions.length > 0 ? totalSubagents / sessions.length : 0,
    subagentCostShare: totalCombined > 0 ? totalSubagentCost / totalCombined : 0,
    subagentCost: totalSubagentCost,
    parentCost: totalParentCost,
    roleStats,
    sessions: sessions.slice(0, 30),
  };
}

/**
 * Builds the full step-by-step detail response for `GET /api/conversations/:id`.
 * Returns `null` if the conversation does not exist in `dataset`.
 */
export function buildConversationDetail(
  id: string,
  dataset: LoadedDataset,
  pricing: PricingConfig,
): ConversationDetailResponse | null {
  const target = dataset.conversations.get(id);
  if (!target) return null;

  const descendantIds = collectDescendants(id, dataset.conversations);
  const relevantIds = [id, ...descendantIds];
  const directMap = new Map<string, DirectConvComputation>();

  for (const relId of relevantIds) {
    const conv = dataset.conversations.get(relId);
    if (!conv) continue;
    directMap.set(relId, computeDirectConversation(conv, pricing, null, null, null));
  }

  const conversation = buildConversationSummary(id, directMap, dataset.conversations);
  const targetDirect = directMap.get(id)!;

  const steps: (StepRecord & { cost: StepCostBreakdown })[] = targetDirect.filteredSteps.map(
    (item) => ({
      ...item.step,
      cost: item.cost,
    }),
  );

  const subagents: ConversationSummary[] = descendantIds
    .filter((descId) => directMap.has(descId))
    .map((descId) => buildConversationSummary(descId, directMap, dataset.conversations));

  const ancestors: ConversationAncestor[] = [];
  const visited = new Set<string>([id]);
  let cursor = target.meta.parentConversationId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const parent = dataset.conversations.get(cursor);
    if (!parent) break;
    ancestors.unshift({
      id: parent.meta.id,
      title: parent.meta.title,
      agentName: parent.meta.agentName,
    });
    cursor = parent.meta.parentConversationId;
  }

  return {
    conversation,
    steps,
    subagents,
    ancestors,
  };
}

export { createEmptyMetricBundle };

// ============================================================================
// Quota & Reset Window Reconstruction Engine (5h Rolling + Weekly + Cutlines)
// ============================================================================

interface ResetStepEvent {
  tsMs: number;
  conversationId: string;
  projectDisplayName: string;
  model: string;
  pool: QuotaPool;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  cost: StepCostBreakdown;
  isTokenBearing: boolean;
  hasError: boolean;
  isCacheMissSpike: boolean;
}

interface RawWindowDef {
  startMs: number;
  endMs: number;
  isCurrent: boolean;
  isIdle?: boolean;
  isSynced?: boolean;
  endedEarlyByServerReset: boolean;
  startedByServerReset: boolean;
  serverResetLabel?: string;
}

function doesResetApplyToPool(markerPool: ResetEventPool, targetPool: ResetEventPool): boolean {
  if (targetPool === 'all') return true;
  return markerPool === 'all' || markerPool === targetPool;
}

function filterEventsForPool(
  events: ResetStepEvent[],
  targetPool: ResetEventPool,
): ResetStepEvent[] {
  if (targetPool === 'all') return events;
  return events.filter((e) => e.pool === targetPool);
}

function createEmptyPoolAcc() {
  return {
    uncachedInput: 0,
    cacheRead: 0,
    output: 0,
    cost: createEmptyCostTotals(),
    steps: 0,
    tokenSteps: 0,
    conversations: new Set<string>(),
    modelCost: new Map<string, number>(),
    projectCost: new Map<string, number>(),
  };
}

function finalizePoolAcc(acc: ReturnType<typeof createEmptyPoolAcc>): PoolMetrics {
  let topModel: string | null = null;
  let topModelCost = -1;
  for (const [m, c] of acc.modelCost.entries()) {
    if (c > topModelCost) {
      topModelCost = c;
      topModel = m;
    }
  }
  let topProject: string | null = null;
  let topProjCost = -1;
  for (const [p, c] of acc.projectCost.entries()) {
    if (c > topProjCost) {
      topProjCost = c;
      topProject = p;
    }
  }
  return {
    tokens: computeTokenTotals(acc.uncachedInput, acc.cacheRead, acc.output),
    cost: acc.cost,
    steps: acc.steps,
    tokenSteps: acc.tokenSteps,
    conversations: acc.conversations.size,
    topModel,
    topProject,
  };
}

function formatWindowLabel(startMs: number, endMs: number, scope: '5h' | 'weekly'): string {
  const s = new Date(startMs);
  const e = new Date(endMs);
  const sm = MONTH_NAMES[s.getUTCMonth()];
  const sd = s.getUTCDate();
  const em = MONTH_NAMES[e.getUTCMonth()];
  const ed = e.getUTCDate();

  if (scope === 'weekly') {
    return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
  }
  const sh = String(s.getUTCHours()).padStart(2, '0');
  const smin = String(s.getUTCMinutes()).padStart(2, '0');
  const eh = String(e.getUTCHours()).padStart(2, '0');
  const emin = String(e.getUTCMinutes()).padStart(2, '0');
  return `${sm} ${sd} ${sh}:${smin}–${eh}:${emin}Z`;
}

function aggregateCycle(
  def: RawWindowDef,
  scope: '5h' | 'weekly',
  events: ResetStepEvent[],
  limitHits: LimitHitMarker[],
  index: number,
  targetPool: ResetEventPool,
): ResetCycleSummary {
  const combinedAcc = createEmptyPoolAcc();
  const geminiAcc = createEmptyPoolAcc();
  const claudeAcc = createEmptyPoolAcc();
  const byModelCost: Record<string, number> = {};
  const byModelTokens: Record<string, number> = {};
  const byProjectCost: Record<string, number> = {};
  const byProjectTokens: Record<string, number> = {};
  let errorCount = 0;
  let cacheMissSpikes = 0;

  for (const ev of events) {
    if (ev.tsMs < def.startMs || ev.tsMs >= def.endMs) continue;
    if (targetPool !== 'all' && ev.pool !== targetPool) continue;
    const targetAcc = ev.pool === 'gemini' ? geminiAcc : claudeAcc;
    for (const acc of [combinedAcc, targetAcc]) {
      acc.steps += 1;
      acc.conversations.add(ev.conversationId);
      if (ev.isTokenBearing) {
        acc.tokenSteps += 1;
        acc.uncachedInput += ev.inputTokens;
        acc.cacheRead += ev.cacheReadTokens;
        acc.output += ev.outputTokens;
        addCostTotals(acc.cost, ev.cost);
        acc.modelCost.set(ev.model, (acc.modelCost.get(ev.model) ?? 0) + ev.cost.totalCost);
        acc.projectCost.set(
          ev.projectDisplayName,
          (acc.projectCost.get(ev.projectDisplayName) ?? 0) + ev.cost.totalCost,
        );
      }
    }
    if (ev.isTokenBearing) {
      const stepTokens = ev.inputTokens + ev.cacheReadTokens + ev.outputTokens;
      byModelCost[ev.model] = (byModelCost[ev.model] ?? 0) + ev.cost.totalCost;
      byModelTokens[ev.model] = (byModelTokens[ev.model] ?? 0) + stepTokens;
      byProjectCost[ev.projectDisplayName] =
        (byProjectCost[ev.projectDisplayName] ?? 0) + ev.cost.totalCost;
      byProjectTokens[ev.projectDisplayName] =
        (byProjectTokens[ev.projectDisplayName] ?? 0) + stepTokens;
    }
    if (ev.hasError) errorCount += 1;
    if (ev.isCacheMissSpike) cacheMissSpikes += 1;
  }

  const combined = finalizePoolAcc(combinedAcc);
  const gemini = finalizePoolAcc(geminiAcc);
  const claudeGpt = finalizePoolAcc(claudeAcc);

  const cycleHits = limitHits.filter((h) => {
    if (h.scope !== scope) return false;
    if (targetPool !== 'all' && h.pool !== targetPool) return false;
    const t = Date.parse(h.timestamp);
    return !Number.isNaN(t) && t >= def.startMs && t < def.endMs;
  });

  const eff = computeEfficiencyScore({
    cacheHitRatio: combined.tokens.cacheHitRatio,
    tokenStepCount: combined.tokenSteps,
    stepCount: combined.steps,
    cacheMissSpikes,
    errorCount,
    outputTokens: combined.tokens.output,
    uncachedInputTokens: combined.tokens.uncachedInput,
  });

  const isIdle =
    scope === '5h' &&
    def.isCurrent &&
    !def.isSynced &&
    (def.isIdle || combined.tokenSteps === 0);

  return {
    id: `${targetPool}-${scope}-${def.startMs}-${index}`,
    scope,
    startAt: new Date(def.startMs).toISOString(),
    endAt: new Date(def.endMs).toISOString(),
    label: formatWindowLabel(def.startMs, def.endMs, scope),
    isCurrent: def.isCurrent,
    ...(isIdle ? { isIdle: true } : {}),
    ...(def.isSynced ? { isSynced: true } : {}),
    endedEarlyByServerReset: def.endedEarlyByServerReset,
    startedByServerReset: def.startedByServerReset,
    ...(def.serverResetLabel ? { serverResetLabel: def.serverResetLabel } : {}),
    limitHits: cycleHits,
    combined,
    gemini,
    claudeGpt,
    byModelCost,
    byModelTokens,
    byProjectCost,
    byProjectTokens,
    efficiencyScore: eff.score,
    efficiencyGrade: eff.grade,
  };
}

function buildRollingWindows(
  events: ResetStepEvent[],
  config: ResetScheduleConfig,
  nowMs: number,
  targetPool: ResetEventPool,
  scope: '5h' | 'weekly',
  durationMs: number,
): RawWindowDef[] {
  const poolEvents = filterEventsForPool(events, targetPool);
  const cutlines: { tsMs: number; label: string }[] = config.customResets
    .filter(
      (r) =>
        (r.scope === scope || r.scope === 'both') &&
        doesResetApplyToPool(r.pool, targetPool),
    )
    .map((r) => ({ tsMs: Date.parse(r.timestamp), label: r.label }))
    .filter((r) => !Number.isNaN(r.tsMs))
    .sort((a, b) => a.tsMs - b.tsMs);

  // Check if user synced an active future reset anchor for this pool (or any pool in 'all' view)
  const syncedMap = scope === '5h' ? config.syncedNext5hReset : config.syncedNextWeeklyReset;
  const rawSyncedList =
    targetPool === 'all'
      ? [syncedMap.gemini, syncedMap.claude_gpt]
      : [syncedMap[targetPool]];
  const syncedCandidates = rawSyncedList
    .filter((s): s is string => typeof s === 'string')
    .map((s) => Date.parse(s))
    .filter((ms) => !Number.isNaN(ms) && ms > nowMs && ms - durationMs <= nowMs);
  const syncedEndMs = syncedCandidates.length > 0 ? Math.min(...syncedCandidates) : null;
  const syncedStartMs = syncedEndMs !== null ? syncedEndMs - durationMs : null;

  // Walk chronologically through token-bearing events to build rolling windows
  const tokenEvents = poolEvents.filter((e) => e.isTokenBearing);
  const earliestEventMs = tokenEvents.length > 0 ? tokenEvents[0].tsMs : nowMs;
  const rawWindows: RawWindowDef[] = [];

  let activeStart: number | null = null;
  let activeEnd: number | null = null;
  let activeIsSynced = false;
  let activeStartedByReset = false;
  let activeResetLabel: string | undefined;

  let cutIdx = 0;

  const advanceCutlinesUpTo = (limitMs: number) => {
    while (cutIdx < cutlines.length && cutlines[cutIdx].tsMs <= limitMs) {
      const cut = cutlines[cutIdx++];
      // Skip ancient pre-history server resets that expired before any local activity existed
      if (activeStart === null && cut.tsMs + durationMs < earliestEventMs && cut.tsMs + durationMs <= nowMs) {
        continue;
      }
      if (activeStart !== null && activeEnd !== null) {
        if (cut.tsMs > activeStart && cut.tsMs < activeEnd) {
          // Close active window early at server reset cutline
          rawWindows.push({
            startMs: activeStart,
            endMs: cut.tsMs,
            isCurrent: false,
            isSynced: activeIsSynced,
            endedEarlyByServerReset: true,
            startedByServerReset: activeStartedByReset,
            serverResetLabel: activeResetLabel,
          });
          // Immediately open a fresh rolling post-reset window starting at cutline
          activeStart = cut.tsMs;
          activeEnd = cut.tsMs + durationMs;
          activeIsSynced = false;
          activeStartedByReset = true;
          activeResetLabel = cut.label;
          continue;
        }
        if (cut.tsMs >= activeEnd) {
          rawWindows.push({
            startMs: activeStart,
            endMs: activeEnd,
            isCurrent: false,
            isSynced: activeIsSynced,
            endedEarlyByServerReset: false,
            startedByServerReset: activeStartedByReset,
            serverResetLabel: activeResetLabel,
          });
          activeStart = cut.tsMs;
          activeEnd = cut.tsMs + durationMs;
          activeIsSynced = false;
          activeStartedByReset = true;
          activeResetLabel = cut.label;
          continue;
        }
      } else {
        // No active window yet — open one anchored at the server reset cutline
        activeStart = cut.tsMs;
        activeEnd = cut.tsMs + durationMs;
        activeIsSynced = false;
        activeStartedByReset = true;
        activeResetLabel = cut.label;
      }
    }
  };

  for (const ev of tokenEvents) {
    // If synced active window starts before this event, flush prior window cleanly at syncedStartMs
    if (
      syncedStartMs !== null &&
      syncedEndMs !== null &&
      ev.tsMs >= syncedStartMs &&
      (activeStart === null || activeStart < syncedStartMs)
    ) {
      advanceCutlinesUpTo(syncedStartMs);
      if (activeStart !== null && activeEnd !== null) {
        rawWindows.push({
          startMs: activeStart,
          endMs: Math.min(activeEnd, syncedStartMs),
          isCurrent: false,
          isSynced: activeIsSynced,
          endedEarlyByServerReset: false,
          startedByServerReset: activeStartedByReset,
          serverResetLabel: activeResetLabel,
        });
      }
      activeStart = syncedStartMs;
      activeEnd = syncedEndMs;
      activeIsSynced = true;
      activeStartedByReset = false;
      activeResetLabel = undefined;
    }

    advanceCutlinesUpTo(ev.tsMs);

    if (activeStart === null || activeEnd === null) {
      activeStart = ev.tsMs;
      activeEnd = ev.tsMs + durationMs;
      activeIsSynced = false;
      activeStartedByReset = false;
      activeResetLabel = undefined;
    } else if (ev.tsMs >= activeEnd) {
      rawWindows.push({
        startMs: activeStart,
        endMs: activeEnd,
        isCurrent: false,
        isSynced: activeIsSynced,
        endedEarlyByServerReset: false,
        startedByServerReset: activeStartedByReset,
        serverResetLabel: activeResetLabel,
      });
      activeStart = ev.tsMs;
      activeEnd = ev.tsMs + durationMs;
      activeIsSynced = false;
      activeStartedByReset = false;
      activeResetLabel = undefined;
    }
  }

  // Process any remaining cutlines up to nowMs (unless a synced active window supersedes them)
  if (syncedStartMs !== null && syncedEndMs !== null) {
    if (activeStart === null || activeStart < syncedStartMs) {
      advanceCutlinesUpTo(syncedStartMs);
      if (activeStart !== null && activeEnd !== null) {
        rawWindows.push({
          startMs: activeStart,
          endMs: Math.min(activeEnd, syncedStartMs),
          isCurrent: false,
          isSynced: activeIsSynced,
          endedEarlyByServerReset: false,
          startedByServerReset: activeStartedByReset,
          serverResetLabel: activeResetLabel,
        });
      }
      activeStart = syncedStartMs;
      activeEnd = syncedEndMs;
      activeIsSynced = true;
      activeStartedByReset = false;
      activeResetLabel = undefined;
    }
  } else {
    advanceCutlinesUpTo(nowMs);
  }

  if (activeStart !== null && activeEnd !== null) {
    const isActiveNow = nowMs >= activeStart && nowMs < activeEnd;
    rawWindows.push({
      startMs: activeStart,
      endMs: activeEnd,
      isCurrent: isActiveNow,
      isSynced: activeIsSynced,
      endedEarlyByServerReset: false,
      startedByServerReset: activeStartedByReset,
      serverResetLabel: activeResetLabel,
    });
  }

  // Ensure there is always a current window covering `nowMs`
  if (!rawWindows.some((w) => w.isCurrent)) {
    const hasSync = syncedStartMs !== null && syncedEndMs !== null;
    rawWindows.push({
      startMs: hasSync ? syncedStartMs! : nowMs,
      endMs: hasSync ? syncedEndMs! : nowMs + durationMs,
      isCurrent: true,
      isIdle: !hasSync,
      isSynced: hasSync,
      endedEarlyByServerReset: false,
      startedByServerReset: false,
    });
  }

  return rawWindows;
}

function buildFiveHourWindows(
  events: ResetStepEvent[],
  config: ResetScheduleConfig,
  nowMs: number,
  targetPool: ResetEventPool,
): RawWindowDef[] {
  const durationMs = Math.max(1, config.fiveHourDurationHours || 5) * 3_600_000;
  return buildRollingWindows(events, config, nowMs, targetPool, '5h', durationMs);
}

function buildWeeklyWindows(
  events: ResetStepEvent[],
  config: ResetScheduleConfig,
  nowMs: number,
  targetPool: ResetEventPool,
): RawWindowDef[] {
  const WEEK_MS = 7 * 86_400_000;
  return buildRollingWindows(events, config, nowMs, targetPool, 'weekly', WEEK_MS);
}

function buildLimitEstimates(
  pools: Record<QuotaPool, PoolResetTimeline>,
): PoolLimitEstimate[] {
  const estimates: PoolLimitEstimate[] = [];
  for (const pool of ['gemini', 'claude_gpt'] as const) {
    const timeline = pools[pool];
    for (const [scope, list] of [
      ['5h', timeline.fiveHourCycles],
      ['weekly', timeline.weeklyCycles],
    ] as const) {
      const matching = list.filter((c) =>
        c.limitHits.some((h) => h.scope === scope && h.pool === pool),
      );
      if (matching.length === 0) continue;
      let tokSum = 0;
      let costSum = 0;
      let turnSum = 0;
      for (const c of matching) {
        const pm = pool === 'gemini' ? c.gemini : c.claudeGpt;
        tokSum += pm.tokens.totalTokens;
        costSum += pm.cost.totalCost;
        turnSum += pm.tokenSteps;
      }
      estimates.push({
        pool,
        scope,
        sampleCount: matching.length,
        avgTokensAtLimit: tokSum / matching.length,
        avgCostAtLimit: costSum / matching.length,
        avgTurnsAtLimit: turnSum / matching.length,
      });
    }
  }
  return estimates;
}

function buildPoolResetTimeline(
  pool: QuotaPool,
  events: ResetStepEvent[],
  config: ResetScheduleConfig,
  nowMs: number,
): PoolResetTimeline {
  const raw5h = buildFiveHourWindows(events, config, nowMs, pool);
  const rawWeekly = buildWeeklyWindows(events, config, nowMs, pool);

  const fiveHourCycles = raw5h
    .map((def, idx) => aggregateCycle(def, '5h', events, config.limitHits, idx, pool))
    .reverse()
    .slice(0, 60);

  const weeklyCycles = rawWeekly
    .map((def, idx) => aggregateCycle(def, 'weekly', events, config.limitHits, idx, pool))
    .reverse()
    .slice(0, 26);

  return {
    pool,
    current5h: fiveHourCycles.find((c) => c.isCurrent) ?? fiveHourCycles[0],
    currentWeekly: weeklyCycles.find((c) => c.isCurrent) ?? weeklyCycles[0],
    fiveHourCycles,
    weeklyCycles,
  };
}

function buildResetAnalytics(
  dataset: LoadedDataset,
  pricing: PricingConfig,
  filters: {
    includeSubagents: boolean;
    projectId: string | null;
    model: string | null;
    search: string | null;
  },
  now: Date,
): ResetAnalytics {
  const config: ResetScheduleConfig = pricing.resetConfig ?? createDefaultResetConfig();
  const nowMs = now.getTime();
  const events: ResetStepEvent[] = [];

  for (const conv of dataset.conversations.values()) {
    const meta = conv.meta;
    if (!filters.includeSubagents && meta.parentConversationId !== null) continue;
    if (filters.projectId && meta.projectId !== filters.projectId) continue;
    if (filters.search) {
      const hay = [
        meta.title,
        meta.projectDisplayName,
        meta.workspacePath ?? '',
        meta.agentName ?? '',
        meta.id,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(filters.search)) continue;
    }

    const comp = computeDirectConversation(conv, pricing, null, null, filters.model);
    for (const item of comp.filteredSteps) {
      const tsStr = item.step.createdAt ?? meta.lastModifiedTime;
      if (!tsStr) continue;
      const tsMs = Date.parse(tsStr);
      if (Number.isNaN(tsMs)) continue;
      events.push({
        tsMs,
        conversationId: meta.id,
        projectDisplayName: meta.projectDisplayName,
        model: item.step.model,
        pool: getQuotaPoolForModel(item.step.model, item.provider),
        inputTokens: item.step.inputTokens,
        cacheReadTokens: item.step.cacheReadTokens,
        outputTokens: item.step.outputTokens,
        cost: item.cost,
        isTokenBearing: item.isTokenBearing,
        hasError: item.step.hasError,
        isCacheMissSpike: Boolean(item.step.isCacheMissSpike),
      });
    }
  }

  events.sort((a, b) => a.tsMs - b.tsMs);

  // Combined (all-pools) timeline for overview bar presets & stacked charts
  const raw5h = buildFiveHourWindows(events, config, nowMs, 'all');
  const rawWeekly = buildWeeklyWindows(events, config, nowMs, 'all');

  const fiveHourCycles = raw5h
    .map((def, idx) => aggregateCycle(def, '5h', events, config.limitHits, idx, 'all'))
    .reverse()
    .slice(0, 60);

  const weeklyCycles = rawWeekly
    .map((def, idx) => aggregateCycle(def, 'weekly', events, config.limitHits, idx, 'all'))
    .reverse()
    .slice(0, 26);

  const current5h = fiveHourCycles.find((c) => c.isCurrent) ?? fiveHourCycles[0];
  const currentWeekly = weeklyCycles.find((c) => c.isCurrent) ?? weeklyCycles[0];

  // Independent per-pool timelines matching Antigravity's separate Gemini vs Claude & GPT clocks
  const pools: Record<QuotaPool, PoolResetTimeline> = {
    gemini: buildPoolResetTimeline('gemini', events, config, nowMs),
    claude_gpt: buildPoolResetTimeline('claude_gpt', events, config, nowMs),
  };

  const limitEstimates = buildLimitEstimates(pools);

  return {
    config,
    current5h,
    currentWeekly,
    fiveHourCycles,
    weeklyCycles,
    pools,
    limitEstimates,
  };
}
