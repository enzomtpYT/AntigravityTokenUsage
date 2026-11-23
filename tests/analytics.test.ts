import { describe, expect, test } from 'bun:test';
import { buildConversationDetail, buildDashboardPayload } from '../server/analytics.ts';
import type { LoadedConversation, LoadedDataset, RawStepRecord } from '../server/data-loader.ts';
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
});
