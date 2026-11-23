import fs from 'node:fs';
import path from 'node:path';
import {
  createDefaultPricingConfig,
  mergePricingConfig,
} from '../src/shared/pricing.ts';
import type { DashboardPayload, ModelPricing, PricingConfig } from '../src/shared/types.ts';
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

  return { ok: true, overrides };
}

export interface ServerOptions {
  port?: number;
  hostname?: string;
  dataDir?: string;
  overridesPath?: string;
  distDir?: string;
  enableWatcher?: boolean;
}

export function createAppServer(options: ServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 3001);
  const hostname = options.hostname ?? process.env.HOST ?? '127.0.0.1';
  const dataDir = options.dataDir ?? getDefaultDataDir();
  const overridesPath =
    options.overridesPath ?? path.resolve(process.cwd(), 'data', 'pricing-overrides.json');
  const distDir = options.distDir ?? path.resolve(process.cwd(), 'dist');
  const enableWatcher = options.enableWatcher ?? true;

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
