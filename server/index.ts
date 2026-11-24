import fs from 'node:fs';
import path from 'node:path';
import {
  createDefaultPricingConfig,
  mergePricingConfig,
} from '../src/shared/pricing.ts';
import type {
  CustomResetMarker,
  DashboardPayload,
  LimitHitMarker,
  ModelPricing,
  PricingConfig,
  QuotaPool,
  ResetScheduleConfig,
} from '../src/shared/types.ts';
import {
  buildConversationDetail,
  buildDashboardPayload,
  type AnalyticsFilters,
} from './analytics.ts';
import {
  AntigravityDataLoader,
  getDefaultDataDir,
  type LoadedDataset,
} from './data-loader.ts';
import { fetchGeminiResetFeed } from './reset-feed.ts';
import { AntigravityWatcher } from './watcher.ts';

const LOCALHOST_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_JSON_BODY_BYTES = 256 * 1024; // 256 KB
const MAX_MODELS_COUNT = 100;
const MAX_OVERRIDES_COUNT = 5_000;
const MAX_SSE_CLIENTS = 50;
const DASHBOARD_LRU_LIMIT = 32;

const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function isAllowedLocalOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return LOCALHOST_ORIGIN_RE.test(origin);
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = {
    ...BASE_SECURITY_HEADERS,
    Vary: 'Origin',
  };
  if (isAllowedLocalOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin!;
    headers['Access-Control-Allow-Methods'] = 'GET, PUT, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}

/**
 * Prevents cross-site state mutation (CSRF) from non-localhost web pages.
 */
function isMutatingOriginAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin !== null) {
    return isAllowedLocalOrigin(origin);
  }
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    return false;
  }
  return true;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders(req),
    },
  });
}

async function readBoundedJson(
  req: Request,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large (max 256 KB)' };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400, error: 'Failed to read request body' };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large (max 256 KB)' };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function loadPricingOverrides(overridesPath: string): PricingConfig {
  if (!fs.existsSync(overridesPath)) {
    return createDefaultPricingConfig();
  }
  try {
    const raw = fs.readFileSync(overridesPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PricingConfig>;
    return mergePricingConfig(parsed);
  } catch {
    return createDefaultPricingConfig();
  }
}

export function validateAndSanitizeResetConfig(
  raw: unknown,
): { ok: true; resetConfig: ResetScheduleConfig } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'resetConfig must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(k)) {
      return { ok: false, error: `Disallowed key "${k}" in resetConfig` };
    }
  }

  const fiveHourDurationHours =
    obj.fiveHourDurationHours !== undefined ? Number(obj.fiveHourDurationHours) : 5;
  if (!Number.isFinite(fiveHourDurationHours) || fiveHourDurationHours < 1 || fiveHourDurationHours > 24) {
    return { ok: false, error: 'fiveHourDurationHours must be between 1 and 24' };
  }

  const weeklyResetDayUtc =
    obj.weeklyResetDayUtc !== undefined ? Number(obj.weeklyResetDayUtc) : 1;
  if (!Number.isInteger(weeklyResetDayUtc) || weeklyResetDayUtc < 0 || weeklyResetDayUtc > 6) {
    return { ok: false, error: 'weeklyResetDayUtc must be an integer 0..6' };
  }

  const weeklyResetHourUtc =
    obj.weeklyResetHourUtc !== undefined ? Number(obj.weeklyResetHourUtc) : 0;
  if (!Number.isInteger(weeklyResetHourUtc) || weeklyResetHourUtc < 0 || weeklyResetHourUtc > 23) {
    return { ok: false, error: 'weeklyResetHourUtc must be an integer 0..23' };
  }

  let autoSyncOfficialResets = true;
  if (obj.autoSyncOfficialResets !== undefined) {
    if (typeof obj.autoSyncOfficialResets !== 'boolean') {
      return { ok: false, error: 'autoSyncOfficialResets must be a boolean' };
    }
    autoSyncOfficialResets = obj.autoSyncOfficialResets;
  }

  const lastFeedSyncAt =
    typeof obj.lastFeedSyncAt === 'string' &&
    obj.lastFeedSyncAt.trim() &&
    !Number.isNaN(Date.parse(obj.lastFeedSyncAt))
      ? new Date(obj.lastFeedSyncAt).toISOString()
      : undefined;

  const sanitizeSyncedMap = (input: unknown): Partial<Record<QuotaPool, string>> => {
    const out: Partial<Record<QuotaPool, string>> = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    const m = input as Record<string, unknown>;
    for (const pool of ['gemini', 'claude_gpt'] as const) {
      const val = m[pool];
      if (typeof val === 'string' && val.trim() && !Number.isNaN(Date.parse(val))) {
        out[pool] = new Date(val).toISOString();
      }
    }
    return out;
  };

  const customResets: CustomResetMarker[] = [];
  if (obj.customResets !== undefined) {
    if (!Array.isArray(obj.customResets)) {
      return { ok: false, error: 'customResets must be an array' };
    }
    if (obj.customResets.length > 200) {
      return { ok: false, error: 'Too many customResets (max 200)' };
    }
    for (const item of obj.customResets) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, error: 'Each customReset must be an object' };
      }
      const r = item as Record<string, unknown>;
      if (typeof r.timestamp !== 'string' || Number.isNaN(Date.parse(r.timestamp))) {
        return { ok: false, error: 'Each customReset must have a valid ISO timestamp' };
      }
      const scope =
        r.scope === '5h' || r.scope === 'weekly' || r.scope === 'both' ? r.scope : 'both';
      const pool =
        r.pool === 'all' || r.pool === 'gemini' || r.pool === 'claude_gpt' ? r.pool : 'all';
      const safeSourceUrl =
        typeof r.sourceUrl === 'string' &&
        /^https:\/\/(geminireset\.com|antigravityreset\.com)\//.test(r.sourceUrl.trim())
          ? r.sourceUrl.trim().slice(0, 240)
          : undefined;
      customResets.push({
        id:
          typeof r.id === 'string' && r.id.trim()
            ? r.id.trim().slice(0, 64)
            : `rst-${Date.now()}-${customResets.length}`,
        timestamp: new Date(r.timestamp).toISOString(),
        scope,
        pool,
        label:
          typeof r.label === 'string' && r.label.trim()
            ? r.label.trim().slice(0, 120)
            : 'Server reset',
        ...(r.source === 'geminireset' || r.source === 'manual' ? { source: r.source } : {}),
        ...(safeSourceUrl ? { sourceUrl: safeSourceUrl } : {}),
      });
    }
  }

  const limitHits: LimitHitMarker[] = [];
  if (obj.limitHits !== undefined) {
    if (!Array.isArray(obj.limitHits)) {
      return { ok: false, error: 'limitHits must be an array' };
    }
    if (obj.limitHits.length > 200) {
      return { ok: false, error: 'Too many limitHits (max 200)' };
    }
    for (const item of obj.limitHits) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, error: 'Each limitHit must be an object' };
      }
      const h = item as Record<string, unknown>;
      if (typeof h.timestamp !== 'string' || Number.isNaN(Date.parse(h.timestamp))) {
        return { ok: false, error: 'Each limitHit must have a valid ISO timestamp' };
      }
      const scope = h.scope === '5h' || h.scope === 'weekly' ? h.scope : '5h';
      const pool: QuotaPool = h.pool === 'claude_gpt' ? 'claude_gpt' : 'gemini';
      limitHits.push({
        id:
          typeof h.id === 'string' && h.id.trim()
            ? h.id.trim().slice(0, 64)
            : `hit-${Date.now()}-${limitHits.length}`,
        timestamp: new Date(h.timestamp).toISOString(),
        scope,
        pool,
        ...(typeof h.note === 'string' && h.note.trim()
          ? { note: h.note.trim().slice(0, 160) }
          : {}),
      });
    }
  }

  return {
    ok: true,
    resetConfig: {
      fiveHourDurationHours,
      weeklyResetDayUtc,
      weeklyResetHourUtc,
      autoSyncOfficialResets,
      ...(lastFeedSyncAt ? { lastFeedSyncAt } : {}),
      syncedNext5hReset: sanitizeSyncedMap(obj.syncedNext5hReset),
      syncedNextWeeklyReset: sanitizeSyncedMap(obj.syncedNextWeeklyReset),
      customResets,
      limitHits,
    },
  };
}

export function validateAndSanitizePricingUpdate(
  body: unknown,
): { ok: true; overrides: Partial<PricingConfig> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const raw = body as Record<string, unknown>;
  const overrides: Partial<PricingConfig> = {};

  if (raw.fallbackModelId !== undefined) {
    if (
      typeof raw.fallbackModelId !== 'string' ||
      !raw.fallbackModelId.trim() ||
      raw.fallbackModelId.length > 128 ||
      DANGEROUS_KEYS.has(raw.fallbackModelId.trim())
    ) {
      return { ok: false, error: 'fallbackModelId must be a safe non-empty string' };
    }
    overrides.fallbackModelId = raw.fallbackModelId.trim();
  }

  if (raw.includeUntagged !== undefined) {
    if (typeof raw.includeUntagged !== 'boolean') {
      return { ok: false, error: 'includeUntagged must be a boolean' };
    }
    overrides.includeUntagged = raw.includeUntagged;
  }

  if (raw.longContextEnabled !== undefined) {
    if (typeof raw.longContextEnabled !== 'boolean') {
      return { ok: false, error: 'longContextEnabled must be a boolean' };
    }
    overrides.longContextEnabled = raw.longContextEnabled;
  }

  if (raw.longContextThreshold !== undefined) {
    const val = Number(raw.longContextThreshold);
    if (!Number.isFinite(val) || val <= 0 || val > 100_000_000) {
      return { ok: false, error: 'longContextThreshold must be a reasonable positive number' };
    }
    overrides.longContextThreshold = val;
  }

  if (raw.longContextInputMultiplier !== undefined) {
    const val = Number(raw.longContextInputMultiplier);
    if (!Number.isFinite(val) || val < 1 || val > 100) {
      return { ok: false, error: 'longContextInputMultiplier must be between 1 and 100' };
    }
    overrides.longContextInputMultiplier = val;
  }

  if (raw.longContextOutputMultiplier !== undefined) {
    const val = Number(raw.longContextOutputMultiplier);
    if (!Number.isFinite(val) || val < 1 || val > 100) {
      return { ok: false, error: 'longContextOutputMultiplier must be between 1 and 100' };
    }
    overrides.longContextOutputMultiplier = val;
  }

  if (raw.monthlySubscriptionUsd !== undefined) {
    const val = Number(raw.monthlySubscriptionUsd);
    if (!Number.isFinite(val) || val < 0 || val > 100_000) {
      return { ok: false, error: 'monthlySubscriptionUsd must be between 0 and 100000' };
    }
    overrides.monthlySubscriptionUsd = val;
  }

  if (raw.conversationModelOverrides !== undefined) {
    if (
      !raw.conversationModelOverrides ||
      typeof raw.conversationModelOverrides !== 'object' ||
      Array.isArray(raw.conversationModelOverrides)
    ) {
      return { ok: false, error: 'conversationModelOverrides must be a map of conversationId -> modelId' };
    }
    const entries = Object.entries(raw.conversationModelOverrides as Record<string, unknown>);
    if (entries.length > MAX_OVERRIDES_COUNT) {
      return { ok: false, error: `Too many conversation overrides (max ${MAX_OVERRIDES_COUNT})` };
    }
    const cleanMap: Record<string, string> = Object.create(null);
    for (const [cId, mId] of entries) {
      if (DANGEROUS_KEYS.has(cId) || cId.length > 128) {
        return { ok: false, error: `Invalid conversation override key "${cId}"` };
      }
      if (typeof mId === 'string' && mId.trim() && mId.length <= 128 && !DANGEROUS_KEYS.has(mId.trim())) {
        cleanMap[cId] = mId.trim();
      }
    }
    overrides.conversationModelOverrides = { ...cleanMap };
  }

  if (raw.models !== undefined) {
    if (!raw.models || typeof raw.models !== 'object' || Array.isArray(raw.models)) {
      return { ok: false, error: 'models must be an object map of model pricing configs' };
    }

    const entries = Object.entries(raw.models as Record<string, unknown>);
    if (entries.length > MAX_MODELS_COUNT) {
      return { ok: false, error: `Too many model entries (max ${MAX_MODELS_COUNT})` };
    }

    const sanitizedModels: Record<string, ModelPricing> = Object.create(null);
    for (const [id, entry] of entries) {
      if (DANGEROUS_KEYS.has(id) || !id.trim() || id.length > 128) {
        return { ok: false, error: `Invalid model ID "${id}"` };
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, error: `Invalid model entry for "${id}"` };
      }
      const m = entry as Record<string, unknown>;
      const inputPer1M = Number(m.inputPer1M);
      const cacheReadPer1M = Number(m.cacheReadPer1M);
      const outputPer1M = Number(m.outputPer1M);

      if (
        !Number.isFinite(inputPer1M) ||
        inputPer1M < 0 ||
        inputPer1M > 10_000 ||
        !Number.isFinite(cacheReadPer1M) ||
        cacheReadPer1M < 0 ||
        cacheReadPer1M > 10_000 ||
        !Number.isFinite(outputPer1M) ||
        outputPer1M < 0 ||
        outputPer1M > 10_000
      ) {
        return {
          ok: false,
          error: `Pricing rates for "${id}" must be finite numbers between 0 and 10000`,
        };
      }

      const rawColor = typeof m.color === 'string' ? m.color.trim() : '';
      const safeColor = HEX_COLOR_RE.test(rawColor) ? rawColor : '#94a3b8';

      sanitizedModels[id] = {
        id,
        label:
          typeof m.label === 'string' && m.label.trim()
            ? m.label.trim().slice(0, 120)
            : id,
        provider:
          m.provider === 'google' ||
          m.provider === 'anthropic' ||
          m.provider === 'openai' ||
          m.provider === 'deepseek' ||
          m.provider === 'other'
            ? m.provider
            : 'other',
        inputPer1M,
        cacheReadPer1M,
        outputPer1M,
        color: safeColor,
        ...(typeof m.isReference === 'boolean' ? { isReference: m.isReference } : {}),
        ...(typeof m.note === 'string' ? { note: m.note.slice(0, 240) } : {}),
      };
    }

    overrides.models = { ...sanitizedModels };
  }

  if (raw.resetConfig !== undefined) {
    const rcCheck = validateAndSanitizeResetConfig(raw.resetConfig);
    if (!rcCheck.ok) {
      return { ok: false, error: rcCheck.error };
    }
    overrides.resetConfig = rcCheck.resetConfig;
  }

  return { ok: true, overrides };
}

export interface ServerOptions {
  port?: number;
  hostname?: string;
  dataDir?: string;
  overridesPath?: string;
  distDir?: string;
  enableWatcher?: boolean;
  /** Auto-fetch confirmed resets from geminireset.com/feed.xml on startup when enabled in resetConfig */
  enableAutoFeedSync?: boolean;
}

const AUTO_FEED_SYNC_COOLDOWN_MS = 15 * 60_000; // 15 minutes

export function createAppServer(options: ServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 3001);
  const hostname = options.hostname ?? process.env.HOST ?? '127.0.0.1';
  const dataDir = options.dataDir ?? getDefaultDataDir();
  const overridesPath =
    options.overridesPath ?? path.resolve(process.cwd(), 'data', 'pricing-overrides.json');
  const distDir = options.distDir ?? path.resolve(process.cwd(), 'dist');
  const enableWatcher = options.enableWatcher ?? true;
  const enableAutoFeedSync = options.enableAutoFeedSync ?? enableWatcher;

  const loader = new AntigravityDataLoader(dataDir);
  let pricingConfig: PricingConfig = loadPricingOverrides(overridesPath);
  let cachedDataset: LoadedDataset | null = null;
  let datasetDirty = true;
  let datasetVersion = 0;
  let pricingVersion = 0;

  // Versioned LRU cache for GET /api/dashboard responses (sub-ms repeat hits)
  const dashboardCache = new Map<string, DashboardPayload>();

  function getCachedDashboard(cacheKey: string, compute: () => DashboardPayload): DashboardPayload {
    const hit = dashboardCache.get(cacheKey);
    if (hit) {
      // Refresh LRU recency
      dashboardCache.delete(cacheKey);
      dashboardCache.set(cacheKey, hit);
      return hit;
    }
    const payload = compute();
    if (dashboardCache.size >= DASHBOARD_LRU_LIMIT) {
      const oldestKey = dashboardCache.keys().next().value;
      if (oldestKey !== undefined) dashboardCache.delete(oldestKey);
    }
    dashboardCache.set(cacheKey, payload);
    return payload;
  }

  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();

  function getDataset(): LoadedDataset {
    if (!cachedDataset || datasetDirty) {
      cachedDataset = loader.load();
      datasetDirty = false;
      datasetVersion += 1;
      dashboardCache.clear();
    }
    return cachedDataset;
  }

  function broadcastSseEvent(eventName: string, payload: Record<string, unknown>): void {
    const chunk = encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    for (const controller of sseClients) {
      try {
        controller.enqueue(chunk);
      } catch {
        sseClients.delete(controller);
      }
    }
  }

  let feedSyncInFlight: Promise<{
    added: number;
    totalFeedMarkers: number;
    sourceUrl: string;
    fetchedAt: string;
    resetConfig: ResetScheduleConfig;
  }> | null = null;

  async function runOfficialFeedSync() {
    if (feedSyncInFlight) return feedSyncInFlight;
    feedSyncInFlight = (async () => {
      const result = await fetchGeminiResetFeed();
      const existing = pricingConfig.resetConfig.customResets;
      const existingIds = new Set(existing.map((m) => m.id));
      const existingTimestamps = new Set(existing.map((m) => m.timestamp));

      const merged = [...existing];
      let added = 0;
      for (const marker of result.markers) {
        if (existingIds.has(marker.id) || existingTimestamps.has(marker.timestamp)) {
          continue;
        }
        if (merged.length >= 200) break;
        merged.push(marker);
        existingIds.add(marker.id);
        existingTimestamps.add(marker.timestamp);
        added += 1;
      }

      merged.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

      pricingConfig = mergePricingConfig({
        ...pricingConfig,
        resetConfig: {
          ...pricingConfig.resetConfig,
          customResets: merged,
          lastFeedSyncAt: result.fetchedAt,
        },
      });
      pricingVersion += 1;
      dashboardCache.clear();

      fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
      fs.writeFileSync(overridesPath, JSON.stringify(pricingConfig, null, 2), 'utf8');

      broadcastSseEvent('update', {
        type: 'update',
        reason: 'reset-feed-sync',
        timestamp: new Date().toISOString(),
      });

      return {
        added,
        totalFeedMarkers: result.markers.length,
        sourceUrl: result.sourceUrl,
        fetchedAt: result.fetchedAt,
        resetConfig: pricingConfig.resetConfig,
      };
    })();

    try {
      return await feedSyncInFlight;
    } finally {
      feedSyncInFlight = null;
    }
  }

  const watcher = new AntigravityWatcher(dataDir, 400);
  if (enableWatcher) {
    watcher.onChange((reason) => {
      datasetDirty = true;
      broadcastSseEvent('update', {
        type: 'update',
        reason,
        timestamp: new Date().toISOString(),
      });
    });
    watcher.start();
  }

  // Warm initial load
  getDataset();

  // Optional non-blocking startup auto-sync of confirmed Google server resets
  if (enableAutoFeedSync && pricingConfig.resetConfig.autoSyncOfficialResets !== false) {
    const lastSyncMs = pricingConfig.resetConfig.lastFeedSyncAt
      ? Date.parse(pricingConfig.resetConfig.lastFeedSyncAt)
      : NaN;
    const isFresh = !Number.isNaN(lastSyncMs) && Date.now() - lastSyncMs < AUTO_FEED_SYNC_COOLDOWN_MS;
    if (!isFresh) {
      void runOfficialFeedSync()
        .then((res) => {
          if (res.added > 0) {
            console.log(
              `[antigravity-token-usage] Auto-synced ${res.added} confirmed server reset(s) from ${res.sourceUrl}`,
            );
          }
        })
        .catch((err) => {
          console.warn(
            `[antigravity-token-usage] Startup reset feed auto-sync skipped: ${err instanceof Error ? err.message : 'Network error'}`,
          );
        });
    }
  }

  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: 0,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const { pathname, searchParams } = url;

      if (req.method === 'OPTIONS') {
        const origin = req.headers.get('origin');
        if (origin && !isAllowedLocalOrigin(origin)) {
          return new Response(null, { status: 403, headers: BASE_SECURITY_HEADERS });
        }
        return new Response(null, { status: 204, headers: getCorsHeaders(req) });
      }

      // Enforce localhost origin on all mutating API requests (CSRF protection)
      if ((req.method === 'PUT' || req.method === 'POST') && !isMutatingOriginAllowed(req)) {
        return jsonResponse(req, { error: 'Forbidden origin' }, 403);
      }

      // --- API Routes ---
      if (pathname === '/api/dashboard' && req.method === 'GET') {
        const includeSubagentsParam = searchParams.get('includeSubagents');
        const includeSubagents =
          includeSubagentsParam === null ? true : includeSubagentsParam !== 'false';

        const filters: AnalyticsFilters = {
          startDate: searchParams.get('startDate') || undefined,
          endDate: searchParams.get('endDate') || undefined,
          projectId: searchParams.get('projectId') || undefined,
          model: searchParams.get('model') || undefined,
          includeSubagents,
          search: searchParams.get('search')?.slice(0, 200) || undefined,
        };

        const dataset = getDataset();
        const cacheKey = JSON.stringify([datasetVersion, pricingVersion, filters]);
        const payload = getCachedDashboard(cacheKey, () =>
          buildDashboardPayload(dataset, pricingConfig, filters),
        );
        return jsonResponse(req, payload);
      }

      if (
        pathname.startsWith('/api/conversations/') &&
        pathname.endsWith('/model-override') &&
        req.method === 'PUT'
      ) {
        const inner = pathname.slice('/api/conversations/'.length, -'/model-override'.length);
        const id = safeDecodeURIComponent(inner);
        if (!id || id.includes('/') || id.length > 128 || DANGEROUS_KEYS.has(id)) {
          return jsonResponse(req, { error: 'Invalid conversation ID' }, 400);
        }

        const parsed = await readBoundedJson(req);
        if (!parsed.ok) {
          return jsonResponse(req, { error: parsed.error }, parsed.status);
        }

        const modelId =
          parsed.data && typeof parsed.data === 'object' && 'modelId' in parsed.data
            ? (parsed.data as { modelId: unknown }).modelId
            : undefined;

        const nextOverrides = { ...pricingConfig.conversationModelOverrides };
        if (modelId === null || modelId === '') {
          delete nextOverrides[id];
        } else if (
          typeof modelId === 'string' &&
          modelId.trim() &&
          modelId.length <= 128 &&
          !DANGEROUS_KEYS.has(modelId.trim())
        ) {
          if (Object.keys(nextOverrides).length >= MAX_OVERRIDES_COUNT && !(id in nextOverrides)) {
            return jsonResponse(req, { error: 'Maximum conversation overrides reached' }, 400);
          }
          nextOverrides[id] = modelId.trim();
        } else {
          return jsonResponse(req, { error: 'modelId must be a safe string or null' }, 400);
        }

        pricingConfig = mergePricingConfig({
          ...pricingConfig,
          conversationModelOverrides: nextOverrides,
        });
        pricingVersion += 1;
        dashboardCache.clear();

        try {
          fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
          fs.writeFileSync(overridesPath, JSON.stringify(pricingConfig, null, 2), 'utf8');
        } catch {
          return jsonResponse(req, { error: 'Failed to persist model override' }, 500);
        }

        broadcastSseEvent('update', {
          type: 'update',
          reason: 'model-override',
          timestamp: new Date().toISOString(),
        });

        return jsonResponse(req, {
          conversationId: id,
          modelId: nextOverrides[id] ?? null,
          pricing: pricingConfig,
        });
      }

      if (pathname.startsWith('/api/conversations/') && req.method === 'GET') {
        const rawId = pathname.slice('/api/conversations/'.length);
        const id = safeDecodeURIComponent(rawId);
        if (!id || id.includes('/') || id.length > 128) {
          return jsonResponse(req, { error: 'Invalid conversation ID' }, 400);
        }

        const dataset = getDataset();
        const detail = buildConversationDetail(id, dataset, pricingConfig);
        if (!detail) {
          return jsonResponse(req, { error: 'Conversation not found' }, 404);
        }
        return jsonResponse(req, detail);
      }

      if (pathname === '/api/pricing' && req.method === 'GET') {
        return jsonResponse(req, pricingConfig);
      }

      if (pathname === '/api/pricing' && req.method === 'PUT') {
        const parsed = await readBoundedJson(req);
        if (!parsed.ok) {
          return jsonResponse(req, { error: parsed.error }, parsed.status);
        }

        const validation = validateAndSanitizePricingUpdate(parsed.data);
        if (!validation.ok) {
          return jsonResponse(req, { error: validation.error }, 400);
        }

        pricingConfig = mergePricingConfig(validation.overrides);
        pricingVersion += 1;
        dashboardCache.clear();

        try {
          fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
          fs.writeFileSync(overridesPath, JSON.stringify(pricingConfig, null, 2), 'utf8');
        } catch {
          return jsonResponse(req, { error: 'Failed to persist pricing overrides' }, 500);
        }

        broadcastSseEvent('update', {
          type: 'update',
          reason: 'pricing',
          timestamp: new Date().toISOString(),
        });

        return jsonResponse(req, pricingConfig);
      }

      if (pathname === '/api/resets' && req.method === 'PUT') {
        const parsed = await readBoundedJson(req);
        if (!parsed.ok) {
          return jsonResponse(req, { error: parsed.error }, parsed.status);
        }

        const validation = validateAndSanitizeResetConfig(parsed.data);
        if (!validation.ok) {
          return jsonResponse(req, { error: validation.error }, 400);
        }

        pricingConfig = mergePricingConfig({
          ...pricingConfig,
          resetConfig: {
            ...validation.resetConfig,
            ...(validation.resetConfig.lastFeedSyncAt ?? pricingConfig.resetConfig.lastFeedSyncAt
              ? {
                  lastFeedSyncAt:
                    validation.resetConfig.lastFeedSyncAt ?? pricingConfig.resetConfig.lastFeedSyncAt,
                }
              : {}),
          },
        });
        pricingVersion += 1;
        dashboardCache.clear();

        try {
          fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
          fs.writeFileSync(overridesPath, JSON.stringify(pricingConfig, null, 2), 'utf8');
        } catch {
          return jsonResponse(req, { error: 'Failed to persist reset config' }, 500);
        }

        broadcastSseEvent('update', {
          type: 'update',
          reason: 'reset-config',
          timestamp: new Date().toISOString(),
        });

        return jsonResponse(req, pricingConfig.resetConfig);
      }

      if (pathname === '/api/resets/sync-feed' && req.method === 'POST') {
        try {
          const synced = await runOfficialFeedSync();
          return jsonResponse(req, synced);
        } catch (err) {
          return jsonResponse(
            req,
            {
              error: `Failed to sync reset feed: ${err instanceof Error ? err.message : 'Network error'}`,
            },
            502,
          );
        }
      }

      if (pathname === '/api/pricing/reset' && req.method === 'POST') {
        try {
          if (fs.existsSync(overridesPath)) {
            fs.unlinkSync(overridesPath);
          }
        } catch {
          // Ignore delete errors if file was already removed
        }

        pricingConfig = createDefaultPricingConfig();
        pricingVersion += 1;
        dashboardCache.clear();

        broadcastSseEvent('update', {
          type: 'update',
          reason: 'pricing-reset',
          timestamp: new Date().toISOString(),
        });

        return jsonResponse(req, pricingConfig);
      }

      if (pathname === '/api/events' && req.method === 'GET') {
        if (sseClients.size >= MAX_SSE_CLIENTS) {
          return jsonResponse(req, { error: 'Too many live event connections' }, 429);
        }

        let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
        let pingInterval: ReturnType<typeof setInterval> | null = null;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            sseClients.add(controller);

            const connectedPayload = JSON.stringify({
              type: 'connected',
              timestamp: new Date().toISOString(),
              watchedFiles: getDataset().watchedFiles,
            });
            controller.enqueue(encoder.encode(`event: connected\ndata: ${connectedPayload}\n\n`));

            pingInterval = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(': ping\n\n'));
              } catch {
                if (pingInterval) clearInterval(pingInterval);
                sseClients.delete(controller);
              }
            }, 20_000);
          },
          cancel() {
            if (pingInterval) {
              clearInterval(pingInterval);
              pingInterval = null;
            }
            if (streamController) {
              sseClients.delete(streamController);
              streamController = null;
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            ...getCorsHeaders(req),
          },
        });
      }

      if (pathname.startsWith('/api/')) {
        return jsonResponse(req, { error: 'Not found' }, 404);
      }

      // --- Static Production Serving (dist/) with symlink-safe realpath check ---
      const indexHtmlPath = path.join(distDir, 'index.html');
      if (req.method === 'GET' && fs.existsSync(indexHtmlPath)) {
        const decodedPath = safeDecodeURIComponent(pathname);
        if (decodedPath === null) {
          return jsonResponse(req, { error: 'Malformed path' }, 400);
        }

        const safeRel = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
        const resolvedDist = fs.realpathSync(path.resolve(distDir));
        const candidatePath = path.resolve(resolvedDist, safeRel);

        if (candidatePath.startsWith(resolvedDist + path.sep) && fs.existsSync(candidatePath)) {
          try {
            const realCandidate = fs.realpathSync(candidatePath);
            if (
              realCandidate.startsWith(resolvedDist + path.sep) &&
              fs.statSync(realCandidate).isFile()
            ) {
              const isHtml = realCandidate.endsWith('.html');
              return new Response(Bun.file(realCandidate), {
                headers: {
                  ...BASE_SECURITY_HEADERS,
                  ...(isHtml ? { 'Content-Security-Policy': HTML_CSP } : {}),
                },
              });
            }
          } catch {
            // Fall through to SPA index
          }
        }

        // SPA fallback for client-side routes
        return new Response(Bun.file(indexHtmlPath), {
          headers: {
            ...BASE_SECURITY_HEADERS,
            'Content-Security-Policy': HTML_CSP,
          },
        });
      }

      return jsonResponse(req, { error: 'Not found' }, 404);
    },
  });

  return {
    server,
    stop() {
      watcher.stop();
      for (const c of sseClients) {
        try {
          c.close();
        } catch {
          // ignore
        }
      }
      sseClients.clear();
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const app = createAppServer();
  console.log(
    `[antigravity-token-usage] API server listening on http://${app.server.hostname}:${app.server.port} (data: ${getDefaultDataDir()})`,
  );

  const shutdown = () => {
    app.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
