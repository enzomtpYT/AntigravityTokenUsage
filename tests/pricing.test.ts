import { describe, expect, test } from 'bun:test';
import {
  calculateStepCost,
  calculateWhatIfComparisons,
  calculateWhatIfCost,
  computeTokenTotals,
  createDefaultPricingConfig,
  DEFAULT_FALLBACK_MODEL_ID,
  mergePricingConfig,
  resolveModelPricing,
} from '../src/shared/pricing.ts';

describe('Pricing Engine', () => {
  test('calculates exact step cost with separate uncached input and cache-read tokens', () => {
    const config = createDefaultPricingConfig();
    const pro = config.models['gemini-2.5-pro'];
    // input: $1.25/1M, cacheRead: $0.125/1M, output: $10.00/1M
    const breakdown = calculateStepCost(100_000, 900_000, 50_000, pro);

    expect(breakdown.inputCost).toBeCloseTo(0.125, 8);
    expect(breakdown.cacheReadCost).toBeCloseTo(0.1125, 8);
    expect(breakdown.outputCost).toBeCloseTo(0.5, 8);
    expect(breakdown.totalCost).toBeCloseTo(0.7375, 8);

    // Without cache: (100k + 900k) * 1.25/1M + 50k * 10/1M = 1.25 + 0.5 = 1.75
    expect(breakdown.costWithoutCache).toBeCloseTo(1.75, 8);
    // Cache savings: 900k * (1.25 - 0.125) / 1M = 1.0125
    expect(breakdown.cacheSavings).toBeCloseTo(1.0125, 8);
    expect(breakdown.totalCost + breakdown.cacheSavings).toBeCloseTo(
      breakdown.costWithoutCache,
      8,
    );
  });

  test('clamps negative token inputs to zero', () => {
    const config = createDefaultPricingConfig();
    const breakdown = calculateStepCost(-500, -100, -50, config.models['gemini-2.5-pro']);
    expect(breakdown.totalCost).toBe(0);
    expect(breakdown.cacheSavings).toBe(0);
  });

  test('computes TokenTotals and cacheHitRatio accurately', () => {
    const totals = computeTokenTotals(20_000, 80_000, 5_000);
    expect(totals.totalContext).toBe(100_000);
    expect(totals.totalTokens).toBe(105_000);
    expect(totals.cacheHitRatio).toBeCloseTo(0.8, 8);

    const zero = computeTokenTotals(0, 0, 100);
    expect(zero.totalContext).toBe(0);
    expect(zero.cacheHitRatio).toBe(0);
  });

  test('resolves exact, pattern-matched, and fallback models', () => {
    const config = createDefaultPricingConfig();

    // Missing model -> fallback
    const missing = resolveModelPricing(null, config);
    expect(missing.isFallback).toBe(true);
    expect(missing.resolvedModelId).toBe(DEFAULT_FALLBACK_MODEL_ID);
    expect(missing.pricing.id).toBe(DEFAULT_FALLBACK_MODEL_ID);

    // Exact match (official Gemini 4 Neon Standard API rate: $3 / $0.15 / $15)
    const exact = resolveModelPricing('gemini-4-neon-high', config);
    expect(exact.isFallback).toBe(false);
    expect(exact.resolvedModelId).toBe('gemini-4-neon-high');
    expect(exact.pricing.inputPer1M).toBe(3.0);
    expect(exact.pricing.cacheReadPer1M).toBe(0.15);
    expect(exact.pricing.outputPer1M).toBe(15.0);

    // Official Claude Opus 5.5 ($4 / $0.20 / $20) & Sonnet 5.5 ($2 / $0.10 / $10)
    const opus55 = resolveModelPricing('claude-opus-5-5-thinking', config);
    expect(opus55.pricing.inputPer1M).toBe(4.0);
    expect(opus55.pricing.cacheReadPer1M).toBe(0.2);
    expect(opus55.pricing.outputPer1M).toBe(20.0);

    const sonnet55 = resolveModelPricing('claude-sonnet-5-5-thinking', config);
    expect(sonnet55.pricing.inputPer1M).toBe(2.0);
    expect(sonnet55.pricing.cacheReadPer1M).toBe(0.1);
    expect(sonnet55.pricing.outputPer1M).toBe(10.0);

    // Official Gemini 4 Carbon / Hydrogen / 3.8 Flash
    expect(resolveModelPricing('gemini-4-carbon-high', config).pricing.inputPer1M).toBe(2.0);
    expect(resolveModelPricing('gemini-4-hydrogen-medium', config).pricing.inputPer1M).toBe(1.5);
    expect(resolveModelPricing('gemini-3.8-flash-high', config).pricing.inputPer1M).toBe(0.75);

    // Unseen future models resolved via pattern heuristic
    const futureClaudeOpus = resolveModelPricing('claude-opus-6-0', config);
    expect(futureClaudeOpus.isFallback).toBe(false);
    expect(futureClaudeOpus.resolvedModelId).toBe('claude-opus-6-0');
    expect(futureClaudeOpus.pricing.inputPer1M).toBe(config.models['claude-opus-4-6'].inputPer1M);

    const futureGeminiFlash = resolveModelPricing('gemini-3.0-flash-exp', config);
    expect(futureGeminiFlash.isFallback).toBe(false);
    expect(futureGeminiFlash.pricing.inputPer1M).toBe(
      config.models['gemini-2.5-flash'].inputPer1M,
    );

    const futureGpt = resolveModelPricing('gpt-5.2-codex', config);
    expect(futureGpt.pricing.inputPer1M).toBe(config.models['gpt-5'].inputPer1M);

    // Completely unknown model falls back to fallback pricing while preserving raw id
    const unknown = resolveModelPricing('mystery-model-9000', config);
    expect(unknown.isFallback).toBe(false);
    expect(unknown.resolvedModelId).toBe('mystery-model-9000');
    expect(unknown.pricing.inputPer1M).toBe(config.models[DEFAULT_FALLBACK_MODEL_ID].inputPer1M);
  });

  test('merges custom pricing overrides and fallback settings', () => {
    const merged = mergePricingConfig({
      fallbackModelId: 'claude-sonnet-4-5',
      includeUntagged: false,
      models: {
        'gemini-4-neon-high': {
          ...createDefaultPricingConfig().models['gemini-4-neon-high'],
          inputPer1M: 9.99,
        },
      },
    });

    expect(merged.fallbackModelId).toBe('claude-sonnet-4-5');
    expect(merged.includeUntagged).toBe(false);
    expect(merged.models['gemini-4-neon-high'].inputPer1M).toBe(9.99);
    // Other defaults preserved
    expect(merged.models['gemini-2.5-flash'].outputPer1M).toBe(2.5);

    const resolved = resolveModelPricing(undefined, merged);
    expect(resolved.isFallback).toBe(true);
    expect(resolved.resolvedModelId).toBe('claude-sonnet-4-5');
  });

  test('computes What-If projections sorted cheapest to most expensive', () => {
    const config = createDefaultPricingConfig();
    const totals = computeTokenTotals(1_000_000, 4_000_000, 500_000);
    const baseline = 10.0;

    const single = calculateWhatIfCost(totals, config.models['gemini-2.5-flash'], baseline);
    // 1M * 0.3 + 4M * 0.03 + 0.5M * 2.5 = 0.3 + 0.12 + 1.25 = 1.67
    expect(single.projectedCost).toBeCloseTo(1.67, 8);
    expect(single.deltaCost).toBeCloseTo(1.67 - 10.0, 8);
    expect(single.deltaPercent).toBeCloseTo((1.67 - 10.0) / 10.0, 8);

    const all = calculateWhatIfComparisons(totals, baseline, config);
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].projectedCost).toBeGreaterThanOrEqual(all[i - 1].projectedCost);
    }
  });

  test('defaults fallback model to gemini-3.8-flash and supports >200k long-context tiered pricing + manual overrides', () => {
    const config = createDefaultPricingConfig();
    expect(DEFAULT_FALLBACK_MODEL_ID).toBe('gemini-3.8-flash');
    expect(config.fallbackModelId).toBe('gemini-3.8-flash');
    expect(config.models['gemini-3.8-flash']).toBeDefined();
    expect(config.models['gemini-4-hydrogen-tiered-high']).toBeDefined();

    // Per-conversation manual override for untagged step
    const overridden = resolveModelPricing(null, config, 'gemini-4-neon-high');
    expect(overridden.isFallback).toBe(false);
    expect(overridden.isOverridden).toBe(true);
    expect(overridden.resolvedModelId).toBe('gemini-4-neon-high');

    // Long-context (>200k) multiplier
    const pro = config.models['gemini-2.5-pro'];
    const longOff = calculateStepCost(100_000, 150_000, 10_000, pro, {
      enabled: false,
      threshold: 200_000,
      inputMultiplier: 2.0,
      outputMultiplier: 1.5,
    });
    const longOn = calculateStepCost(100_000, 150_000, 10_000, pro, {
      enabled: true,
      threshold: 200_000,
      inputMultiplier: 2.0,
      outputMultiplier: 1.5,
    });
    expect(longOff.longContextApplied).toBe(false);
    expect(longOn.longContextApplied).toBe(true);
    expect(longOn.inputCost).toBeCloseTo(longOff.inputCost * 2.0, 8);
    expect(longOn.cacheReadCost).toBeCloseTo(longOff.cacheReadCost * 2.0, 8);
    expect(longOn.outputCost).toBeCloseTo(longOff.outputCost * 1.5, 8);
    expect(longOn.totalCost - longOff.totalCost).toBeCloseTo(longOff.longContextSurcharge ?? 0, 8);
  });
});
