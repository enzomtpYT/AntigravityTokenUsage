import { describe, expect, test } from 'bun:test';
import { buildConversationDetail, buildDashboardPayload } from '../server/analytics.ts';
import type { LoadedConversation, LoadedDataset, RawStepRecord } from '../server/data-loader.ts';
import { parseGeminiResetRss } from '../server/reset-feed.ts';
import { createDefaultPricingConfig } from '../src/shared/pricing.ts';

function makeStep(overrides: Partial<RawStepRecord> = {}): RawStepRecord {
  return {
    stepIndex: 0,
    createdAt: '2026-11-21T14:00:00.000Z',
    type: 'PLANNER_RESPONSE',
    source: 'MODEL',
    status: 'DONE',
    rawModel: 'gemini-4-neon-high',
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    toolCalls: [],
    thinkingChars: 0,
    contentChars: 0,
    hasMedia: false,
    hasError: false,
    ...overrides,
  };
}

function makeFixtureDataset(): LoadedDataset {
  const conversations = new Map<string, LoadedConversation>();

  // Main conversation (Project A) with 1 child subagent + 1 grandchild subagent
  conversations.set('conv-main', {
    meta: {
      id: 'conv-main',
      title: 'Build Dashboard',
      status: 'IDLE',
      source: 'USER',
      workspacePath: '/home/dev/proj-a',
      projectDisplayName: 'proj-a',
      projectId: '/home/dev/proj-a',
      rawProjectId: 'uuid-a',
      parentConversationId: null,
      nestingDepth: 0,
      agentName: null,
      groupId: null,
      dbStepCount: 3,
      lastModifiedTime: '2026-11-22T15:00:00.000Z',
      lastUserInputTime: '2026-11-21T14:00:00.000Z',
    },
    hasTranscript: true,
    children: ['conv-sub'],
    steps: [
      makeStep({
        stepIndex: 0,
        createdAt: '2026-11-21T14:00:00.000Z',
        type: 'USER_INPUT',
        source: 'USER_EXPLICIT',
        rawModel: null,
        hasMedia: true,
      }),
      makeStep({
        stepIndex: 1,
        createdAt: '2026-11-21T14:05:00.000Z',
        rawModel: 'gemini-4-neon-high', // $1.25 / $0.125 / $10
        inputTokens: 100_000,
        cacheReadTokens: 900_000,
        outputTokens: 10_000,
        toolCalls: ['read_file', 'edit_file'],
        thinkingChars: 2000,
        contentChars: 1000,
      }),
      makeStep({
        stepIndex: 2,
        createdAt: '2026-11-22T15:00:00.000Z',
        rawModel: 'gemini-4-neon-high',
        inputTokens: 50_000,
        cacheReadTokens: 100_000,
        outputTokens: 5_000,
        toolCalls: ['run_command'],
        hasError: true,
        errorText: 'exit code 1',
      }),
    ],
  });

  // Child subagent (Project A)
  conversations.set('conv-sub', {
    meta: {
      id: 'conv-sub',
      title: 'Backend Worker',
      status: 'IDLE',
      source: 'SUBAGENT',
      workspacePath: '/home/dev/proj-a',
      projectDisplayName: 'proj-a',
      projectId: '/home/dev/proj-a',
      rawProjectId: 'uuid-a',
      parentConversationId: 'conv-main',
      nestingDepth: 1,
      agentName: 'backend',
      groupId: 'swarm-1',
      dbStepCount: 1,
      lastModifiedTime: '2026-11-22T15:10:00.000Z',
      lastUserInputTime: null,
    },
    hasTranscript: true,
    children: ['conv-grandchild'],
    steps: [
      makeStep({
        stepIndex: 0,
        createdAt: '2026-11-22T15:10:00.000Z',
        rawModel: 'gemini-flash-worker-agy', // $0.3 / $0.03 / $2.5
        inputTokens: 200_000,
        cacheReadTokens: 800_000,
        outputTokens: 20_000,
        toolCalls: ['read_file'],
        thinkingChars: 500,
        contentChars: 500,
      }),
    ],
  });

  // Grandchild subagent (Project A)
  conversations.set('conv-grandchild', {
    meta: {
      id: 'conv-grandchild',
      title: 'Verifier Helper',
      status: 'IDLE',
      source: 'SUBAGENT',
      workspacePath: '/home/dev/proj-a',
      projectDisplayName: 'proj-a',
      projectId: '/home/dev/proj-a',
      rawProjectId: 'uuid-a',
      parentConversationId: 'conv-sub',
      nestingDepth: 2,
      agentName: 'verifier',
      groupId: 'swarm-1',
      dbStepCount: 1,
      lastModifiedTime: '2026-11-22T15:20:00.000Z',
      lastUserInputTime: null,
    },
    hasTranscript: true,
    children: [],
    steps: [
      makeStep({
        stepIndex: 0,
        createdAt: '2026-11-22T15:20:00.000Z',
        rawModel: 'gemini-flash-worker-agy',
        inputTokens: 100_000,
        cacheReadTokens: 0,
        outputTokens: 10_000,
      }),
    ],
  });

  // Untagged older conversation (Project B) on an earlier day
  conversations.set('conv-old', {
    meta: {
      id: 'conv-old',
      title: 'Legacy Debug',
      status: 'IDLE',
      source: 'USER',
      workspacePath: '/home/dev/proj-b',
      projectDisplayName: 'proj-b',
      projectId: '/home/dev/proj-b',
      rawProjectId: 'uuid-b',
      parentConversationId: null,
      nestingDepth: 0,
      agentName: null,
      groupId: null,
      dbStepCount: 1,
      lastModifiedTime: '2026-11-20T09:00:00.000Z',
      lastUserInputTime: '2026-11-20T09:00:00.000Z',
    },
    hasTranscript: true,
    children: [],
    steps: [
      makeStep({
        stepIndex: 0,
        createdAt: '2026-11-20T09:00:00.000Z',
        rawModel: null, // Uses fallback model (gemini-2.5-pro)
        inputTokens: 40_000,
        cacheReadTokens: 60_000,
        outputTokens: 4_000,
      }),
    ],
  });

  return {
    dataDir: '/mock/antigravity',
    loadedAt: '2026-11-22T16:00:00.000Z',
    watchedFiles: 5,
    conversations,
  };
}

describe('Analytics Engine', () => {
  test('computes KPIs, direct vs rolled-up subagent metrics with zero double counting', () => {
    const dataset = makeFixtureDataset();
    const pricing = createDefaultPricingConfig();
    const now = new Date('2026-11-22T18:00:00.000Z');

    const payload = buildDashboardPayload(dataset, pricing, { includeSubagents: true }, now);

    // Exact global token totals across all 4 conversations (each counted ONCE):
    // uncached: 100k + 50k + 200k + 100k + 40k = 490,000
    // cacheRead: 900k + 100k + 800k + 0 + 60k = 1,860,000
    // output: 10k + 5k + 20k + 10k + 4k = 49,000
    expect(payload.kpis.tokens.uncachedInput).toBe(490_000);
    expect(payload.kpis.tokens.cacheRead).toBe(1_860_000);
    expect(payload.kpis.tokens.output).toBe(49_000);
    expect(payload.kpis.tokens.totalContext).toBe(2_350_000);
    expect(payload.kpis.tokens.totalTokens).toBe(2_399_000);

    expect(payload.kpis.conversationCount).toBe(4);
    expect(payload.kpis.mainConversationCount).toBe(2);
    expect(payload.kpis.subagentCount).toBe(2);
    expect(payload.kpis.userPrompts).toBe(1);

    // Active days: Nov 20, Nov 21, Nov 22 -> 3 consecutive days ending today
    expect(payload.kpis.activeDays).toBe(3);
    expect(payload.kpis.currentStreakDays).toBe(3);
    expect(payload.kpis.longestStreakDays).toBe(3);

    // Check conversation direct vs rolledUp (no double counting of grandchild!)
    const main = payload.conversations.find((c) => c.id === 'conv-main')!;
    const sub = payload.conversations.find((c) => c.id === 'conv-sub')!;
    const grand = payload.conversations.find((c) => c.id === 'conv-grandchild')!;

    expect(main.subagentCount).toBe(2);
    expect(main.direct.tokens.uncachedInput).toBe(150_000);
    expect(main.rolledUp.tokens.uncachedInput).toBe(450_000); // 150k + 200k + 100k
    expect(sub.rolledUp.tokens.uncachedInput).toBe(300_000); // 200k + 100k
    expect(grand.rolledUp.tokens.uncachedInput).toBe(100_000);

    // Project A: direct = main only (150k), rolledUp = main + sub + grandchild (450k)
    const projA = payload.projects.find((p) => p.displayName === 'proj-a')!;
    expect(projA.conversationCount).toBe(1);
    expect(projA.subagentCount).toBe(2);
    expect(projA.direct.tokens.uncachedInput).toBe(150_000);
    expect(projA.rolledUp.tokens.uncachedInput).toBe(450_000);
  });

  test('builds daily/hourly time-series, calendar heatmap, 7x24 matrix, tools, efficiency, and top turns', () => {
    const dataset = makeFixtureDataset();
    const pricing = createDefaultPricingConfig();
    const payload = buildDashboardPayload(
      dataset,
      pricing,
      { includeSubagents: true },
      new Date('2026-11-22T18:00:00.000Z'),
    );

    expect(payload.dailySeries.map((d) => d.bucket)).toEqual([
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    // Cumulative cost at final day equals total KPI cost
    const lastDaily = payload.dailySeries[payload.dailySeries.length - 1];
    expect(lastDaily.cumulativeCost).toBeCloseTo(payload.kpis.cost.totalCost, 8);

    expect(payload.calendarHeatmap).toHaveLength(3);
    expect(payload.hourDayHeatmap).toHaveLength(7 * 24);

    // 2026-11-21 is a Saturday (UTC day 6), hour 14
    const sat14 = payload.hourDayHeatmap.find((c) => c.dayOfWeek === 6 && c.hour === 14)!;
    expect(sat14.steps).toBe(2); // step 0 (USER_INPUT) + step 1 (PLANNER_RESPONSE)

    // Tool stats
    const readTool = payload.tools.find((t) => t.name === 'read_file')!;
    expect(readTool.calls).toBe(2);
    expect(readTool.conversationCount).toBe(2);
    const runCmd = payload.tools.find((t) => t.name === 'run_command')!;
    expect(runCmd.errorCount).toBe(1);

    // Efficiency metrics
    expect(payload.efficiency.totalToolCalls).toBe(4);
    expect(payload.efficiency.totalErrors).toBe(1);
    expect(payload.efficiency.mediaSteps).toBe(1);
    expect(payload.efficiency.totalThinkingChars).toBe(2500);
    expect(payload.efficiency.totalContentChars).toBe(1500);
    expect(payload.efficiency.thinkingToOutputRatio).toBeCloseTo(2500 / 1500, 8);

    // Expensive turns sorted descending by cost
    expect(payload.expensiveTurns.length).toBe(5);
    for (let i = 1; i < payload.expensiveTurns.length; i++) {
      expect(payload.expensiveTurns[i - 1].cost).toBeGreaterThanOrEqual(
        payload.expensiveTurns[i].cost,
      );
    }
  });

  test('applies filters: includeSubagents, date range, project, model, search, and includeUntagged', () => {
    const dataset = makeFixtureDataset();
    const pricing = createDefaultPricingConfig();

    // 1. Exclude subagents
    const mainOnly = buildDashboardPayload(dataset, pricing, { includeSubagents: false });
    expect(mainOnly.kpis.conversationCount).toBe(2);
    expect(mainOnly.kpis.subagentCount).toBe(0);
    expect(mainOnly.kpis.tokens.uncachedInput).toBe(190_000); // 150k + 40k

    // 2. Date range filter (Nov 22 only)
    const nov22 = buildDashboardPayload(dataset, pricing, {
      includeSubagents: true,
      startDate: '2026-11-22',
      endDate: '2026-11-22',
    });
    expect(nov22.dailySeries).toHaveLength(1);
    expect(nov22.dailySeries[0].bucket).toBe('2026-11-22');
    expect(nov22.kpis.tokens.uncachedInput).toBe(350_000); // 50k + 200k + 100k

    // 3. Project filter
    const projB = buildDashboardPayload(dataset, pricing, {
      includeSubagents: true,
      projectId: '/home/dev/proj-b',
    });
    expect(projB.conversations.map((c) => c.id)).toEqual(['conv-old']);
    // Dropdown lists still include all projects
    expect(projB.availableProjects).toHaveLength(2);

    // 4. Model filter
    const flashOnly = buildDashboardPayload(dataset, pricing, {
      includeSubagents: true,
      model: 'gemini-flash-worker-agy',
    });
    expect(flashOnly.kpis.tokens.uncachedInput).toBe(300_000);

    // 5. Search filter
    const searchRes = buildDashboardPayload(dataset, pricing, {
      includeSubagents: true,
      search: 'legacy',
    });
    expect(searchRes.conversations.map((c) => c.id)).toEqual(['conv-old']);

    // 6. Exclude untagged steps via pricing config
    const noUntagged = buildDashboardPayload(
      dataset,
      { ...pricing, includeUntagged: false },
      { includeSubagents: true },
    );
    // conv-old's 40k uncached input is excluded
    expect(noUntagged.kpis.tokens.uncachedInput).toBe(450_000);
  });

  test('builds ConversationDetailResponse with steps, subagents, and ancestor breadcrumbs', () => {
    const dataset = makeFixtureDataset();
    const pricing = createDefaultPricingConfig();

    expect(buildConversationDetail('missing-id', dataset, pricing)).toBeNull();

    const grandDetail = buildConversationDetail('conv-grandchild', dataset, pricing)!;
    expect(grandDetail.conversation.id).toBe('conv-grandchild');
    expect(grandDetail.ancestors.map((a) => a.id)).toEqual(['conv-main', 'conv-sub']);
    expect(grandDetail.steps).toHaveLength(1);
    expect(grandDetail.steps[0].cost.totalCost).toBeGreaterThan(0);

    const mainDetail = buildConversationDetail('conv-main', dataset, pricing)!;
    expect(mainDetail.ancestors).toEqual([]);
    expect(mainDetail.subagents.map((s) => s.id)).toEqual(['conv-sub', 'conv-grandchild']);
    expect(mainDetail.steps).toHaveLength(3);
  });

  test('computes V2 Sankey, Scatter, Swarm Analytics, Subscription ROI, Cache Miss, Latency, and Error Cost', () => {
    const dataset = makeFixtureDataset();
    const pricing = createDefaultPricingConfig();
    const payload = buildDashboardPayload(
      dataset,
      pricing,
      { includeSubagents: true },
      new Date('2026-11-22T18:00:00.000Z'),
    );

    // Sankey nodes & links
    expect(payload.sankey.nodes.length).toBeGreaterThan(0);
    expect(payload.sankey.links.length).toBeGreaterThan(0);

    // Scatter turns
    expect(payload.scatterTurns.length).toBe(5);

    // Swarm analytics
    expect(payload.swarmAnalytics.swarmSessionCount).toBe(1);
    expect(payload.swarmAnalytics.totalSubagents).toBe(2);
    expect(payload.swarmAnalytics.sessions[0].rootId).toBe('conv-main');
    expect(payload.swarmAnalytics.sessions[0].spans.length).toBe(3);
    expect(payload.swarmAnalytics.roleStats.length).toBeGreaterThanOrEqual(2);

    // Subscription ROI
    expect(payload.subscriptionRoi.monthlyPriceUsd).toBe(20);
    expect(payload.subscriptionRoi.monthlyProjectedApiUsd).toBeGreaterThan(0);

    // V2 efficiency diagnostics
    expect(payload.efficiency.errorCost).toBeGreaterThan(0);
    expect(payload.efficiency.longContextSteps).toBeGreaterThanOrEqual(2);
    expect(payload.efficiency.cacheMissSpikes).toBeGreaterThanOrEqual(1);
    expect(payload.efficiency.totalActiveMs).toBeGreaterThan(0);
    expect(payload.efficiency.medianLatencyMs).toBeGreaterThan(0);

    // Untagged model label clarity
    const untaggedModel = payload.models.find((m) => m.isFallback);
    expect(untaggedModel?.modelId).toBe('gemini-3.8-flash');
    expect(untaggedModel?.label).toBe('Untagged (est. Gemini 3.8 Flash)');

    // V3 Fun Insights, Efficiency Score/Grade, WoW Deltas, and Tool Chains
    expect(payload.funInsights.booksRead).toBeGreaterThan(0);
    expect(payload.funInsights.novelsWritten).toBeGreaterThan(0);
    expect(payload.funInsights.estimatedLinesOfCode).toBeGreaterThan(0);
    expect(payload.funInsights.codingPersona.title.length).toBeGreaterThan(0);
    expect(payload.funInsights.peakDay).not.toBeNull();
    expect(payload.funInsights.peakHour).not.toBeNull();

    expect(payload.efficiency.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(payload.efficiency.efficiencyScore).toBeLessThanOrEqual(100);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(payload.efficiency.efficiencyGrade);
    expect(payload.efficiency.optimizationTips.length).toBeGreaterThan(0);

    expect(payload.periodDeltas.current7dCost).toBeGreaterThan(0);
    expect(payload.toolChains.length).toBeGreaterThan(0);
    expect(payload.toolChains[0].from).toBe('read_file');
    expect(payload.toolChains[0].to).toBe('edit_file');
  });

  test('reconstructs 5h & weekly reset windows with dual pools, server-reset cutlines, and limit-hit estimates', () => {
    const dataset = makeFixtureDataset();
    const basePricing = createDefaultPricingConfig();

    // Add a server-side reset cutline on Nov 22 at 15:15Z (splitting conv-main/conv-sub at 15:00–15:10Z
    // from conv-grandchild at 15:20Z) plus a limit hit on Gemini 5h pool at 15:12Z
    const pricing = {
      ...basePricing,
      resetConfig: {
        ...basePricing.resetConfig,
        customResets: [
          {
            id: 'rst-google-1',
            timestamp: '2026-11-22T15:15:00.000Z',
            scope: 'both' as const,
            pool: 'all' as const,
            label: 'Google bonus reset',
          },
        ],
        limitHits: [
          {
            id: 'hit-1',
            timestamp: '2026-11-22T15:12:00.000Z',
            scope: '5h' as const,
            pool: 'gemini' as const,
            note: 'Hit 5h quota',
          },
        ],
      },
    };

    const payload = buildDashboardPayload(
      dataset,
      pricing,
      { includeSubagents: true },
      new Date('2026-11-22T16:00:00.000Z'),
    );

    const ra = payload.resetAnalytics;
    expect(ra.fiveHourCycles.length).toBeGreaterThanOrEqual(4);
    expect(ra.weeklyCycles.length).toBeGreaterThanOrEqual(2);
    expect(ra.current5h.isCurrent).toBe(true);
    expect(ra.current5h.startedByServerReset).toBe(true);
    expect(ra.current5h.serverResetLabel).toBe('Google bonus reset');
    // Post-reset window starting at 15:15Z captures ONLY conv-grandchild (15:20Z -> 110,000 tokens)
    expect(ra.current5h.combined.tokens.totalTokens).toBe(110_000);

    // Prior 5h cycle on Nov 22 (15:00Z..15:15Z) was closed early by server reset and has the limit hit
    const closedEarly5h = ra.fiveHourCycles.find((c) => c.endedEarlyByServerReset);
    expect(closedEarly5h).toBeDefined();
    expect(closedEarly5h!.gemini.tokens.totalTokens).toBe(1_175_000); // 155k + 1,020k
    expect(closedEarly5h!.claudeGpt.tokens.totalTokens).toBe(0);
    expect(closedEarly5h!.limitHits).toHaveLength(1);

    // Weekly cycle was also split at 2026-11-22T15:15:00Z
    expect(ra.currentWeekly.startedByServerReset).toBe(true);
    expect(ra.weeklyCycles.some((c) => c.endedEarlyByServerReset)).toBe(true);

    // Empirical limit estimate generated for Gemini 5h pool
    const gemEst = ra.limitEstimates.find((e) => e.pool === 'gemini' && e.scope === '5h');
    expect(gemEst).toBeDefined();
    expect(gemEst!.sampleCount).toBe(1);
    expect(gemEst!.avgCostAtLimit).toBeGreaterThan(0);

    // Per-project breakdown inside each reset cycle
    expect(ra.current5h.byProjectTokens['proj-a']).toBe(110_000);
    expect(ra.current5h.byProjectCost['proj-a']).toBeGreaterThan(0);

    // Global filtering "Since reset -> Today" (open-ended endDate) vs "Reset -> Next reset" (bounded)
    const sinceReset = buildDashboardPayload(
      dataset,
      pricing,
      { includeSubagents: true, startDate: '2026-11-22T15:15:00.000Z' },
      new Date('2026-11-22T16:00:00.000Z'),
    );
    expect(sinceReset.kpis.tokens.totalTokens).toBe(110_000);

    const betweenResets = buildDashboardPayload(
      dataset,
      pricing,
      {
        includeSubagents: true,
        startDate: '2026-11-21T00:00:00.000Z',
        endDate: '2026-11-22T15:15:00.000Z',
      },
      new Date('2026-11-22T16:00:00.000Z'),
    );
    // Captures Nov 21 conv-main step (1,010k) + Nov 22 conv-main step (155k) + conv-sub (1,020k) = 2,185,000
    expect(betweenResets.kpis.tokens.totalTokens).toBe(2_185_000);
  });

  test('uses rolling 7-day weekly windows without phantom Monday UTC splits between server resets', () => {
    const dataset = makeFixtureDataset();
    const basePricing = createDefaultPricingConfig();

    // Two server resets spanning Monday 00:00Z (Sat Nov 21 09:18Z -> Mon Nov 23 20:16Z)
    const pricing = {
      ...basePricing,
      resetConfig: {
        ...basePricing.resetConfig,
        customResets: [
          {
            id: 'rst-sat',
            timestamp: '2026-11-21T09:18:53.000Z',
            scope: 'both' as const,
            pool: 'all' as const,
            label: 'Saturday server reset',
          },
          {
            id: 'rst-mon',
            timestamp: '2026-11-23T20:16:58.000Z',
            scope: 'both' as const,
            pool: 'all' as const,
            label: 'Monday server reset',
          },
        ],
      },
    };

    const payload = buildDashboardPayload(
      dataset,
      pricing,
      { includeSubagents: true },
      new Date('2026-11-24T00:00:00.000Z'),
    );

    const weeks = payload.resetAnalytics.weeklyCycles;
    // Current window: Mon Nov 23 20:16:58Z -> Mon Nov 30 20:16:58Z
    expect(weeks[0].startAt).toBe('2026-11-23T20:16:58.000Z');
    expect(weeks[0].endAt).toBe('2026-11-30T20:16:58.000Z');
    // Immediately preceding window must run straight from Sat Nov 21 09:18:53Z -> Mon Nov 23 20:16:58Z
    // with NO phantom Monday 00:00Z cut in between!
    expect(weeks[1].startAt).toBe('2026-11-21T09:18:53.000Z');
    expect(weeks[1].endAt).toBe('2026-11-23T20:16:58.000Z');
    expect(weeks[1].startedByServerReset).toBe(true);
    expect(weeks[1].endedEarlyByServerReset).toBe(true);
  });

  test('tracks independent per-pool reset clocks where Gemini-only resets do not alter Claude & GPT', () => {
    const dataset = makeFixtureDataset();
    const basePricing = createDefaultPricingConfig();

    const claudeSyncEnd = '2026-11-28T12:00:00.000Z';
    const pricing = {
      ...basePricing,
      resetConfig: {
        ...basePricing.resetConfig,
        syncedNextWeeklyReset: {
          claude_gpt: claudeSyncEnd,
        },
        customResets: [
          {
            id: 'rst-gemini-only',
            timestamp: '2026-11-22T15:15:00.000Z',
            scope: 'both' as const,
            pool: 'gemini' as const,
            label: 'Gemini-only quota reset',
          },
        ],
      },
    };

    const payload = buildDashboardPayload(
      dataset,
      pricing,
      { includeSubagents: true },
      new Date('2026-11-22T16:00:00.000Z'),
    );

    const { gemini, claude_gpt } = payload.resetAnalytics.pools;

    // Gemini pool: cut by the Gemini-only reset -> 5h & 7-day weekly anchored at 2026-11-22T15:15:00Z
    expect(gemini.current5h.startedByServerReset).toBe(true);
    expect(gemini.current5h.startAt).toBe('2026-11-22T15:15:00.000Z');
    expect(gemini.current5h.endAt).toBe('2026-11-22T20:15:00.000Z');
    expect(gemini.current5h.isIdle).toBeUndefined();
    expect(gemini.currentWeekly.startedByServerReset).toBe(true);
    expect(gemini.currentWeekly.startAt).toBe('2026-11-22T15:15:00.000Z');
    expect(gemini.currentWeekly.endAt).toBe('2026-11-29T15:15:00.000Z');

    // Claude & GPT pool: untouched by Gemini-only reset!
    // 5h has no Claude/GPT turns in the last 5h -> idle (100% ready)
    expect(claude_gpt.current5h.startedByServerReset).toBe(false);
    expect(claude_gpt.current5h.isIdle).toBe(true);
    // Weekly uses its own synced countdown independently of Gemini
    expect(claude_gpt.currentWeekly.startedByServerReset).toBe(false);
    expect(claude_gpt.currentWeekly.isSynced).toBe(true);
    expect(claude_gpt.currentWeekly.endAt).toBe(claudeSyncEnd);
  });

  test('parseGeminiResetRss extracts only confirmed resets and detects all-models vs gemini pool', () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel>
        <item>
          <title>[Reset] Neon + Carbon + Hydrogen quota reset for everyone</title>
          <link>https://geminireset.com/history/#e-2026-11-23</link>
          <guid isPermaLink="false">geminireset:2026-11-23:123</guid>
          <pubDate>Mon, 23 Nov 2026 20:16:58 GMT</pubDate>
          <category>Confirmed reset</category>
          <description>Resetting Gemini quotas for everyone on Antigravity!</description>
        </item>
        <item>
          <title>[Promised] Neon cache fix rolling out</title>
          <link>https://geminireset.com/history/#e-2026-11-20</link>
          <guid isPermaLink="false">geminireset:2026-11-20-promise:456</guid>
          <pubDate>Fri, 20 Nov 2026 18:38:40 GMT</pubDate>
          <category>Reset promised</category>
          <description>Will issue a reset later.</description>
        </item>
        <item>
          <title>[Reset] First-birthday reset across all models</title>
          <link>https://geminireset.com/history/#e-2026-11-17</link>
          <guid isPermaLink="false">geminireset:2026-11-17:789</guid>
          <pubDate>Tue, 17 Nov 2026 23:38:48 GMT</pubDate>
          <category>Confirmed reset</category>
          <description>Resetting quota for everyone across all models!</description>
        </item>
      </channel></rss>`;

    const parsed = parseGeminiResetRss(sampleXml);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].label).toBe('Neon + Carbon + Hydrogen quota reset for everyone');
    expect(parsed[0].pool).toBe('gemini');
    expect(parsed[0].source).toBe('geminireset');
    expect(parsed[0].sourceUrl).toBe('https://geminireset.com/history/#e-2026-11-23');
    expect(parsed[1].pool).toBe('all');
  });
});
