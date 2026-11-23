import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultPricingConfig } from '../shared/pricing';
import type { DashboardPayload, PricingConfig } from '../shared/types';
import type { LiveTokenDelta } from '../components/LiveToast';

export type DatePreset = '7d' | '30d' | 'all' | 'custom';
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

export interface DashboardFilterState {
  datePreset: DatePreset;
  startDate: string;
  endDate: string;
  projectId: string;
  model: string;
  includeSubagents: boolean;
  search: string;
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computePresetRange(preset: DatePreset): { startDate: string; endDate: string } {
  if (preset === 'all' || preset === 'custom') {
    return { startDate: '', endDate: '' };
  }
  const end = new Date();
  const start = new Date();
  const days = preset === '7d' ? 6 : 29;
  start.setDate(end.getDate() - days);
  return {
    startDate: formatYmd(start),
    endDate: formatYmd(end),
  };
}

const INITIAL_FILTERS: DashboardFilterState = {
  datePreset: 'all',
  startDate: '',
  endDate: '',
  projectId: '',
  model: '',
  includeSubagents: true,
  search: '',
};

export interface UseDashboardDataResult {
  data: DashboardPayload | null;
  pricing: PricingConfig;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  connectionStatus: ConnectionStatus;
  lastUpdatedAt: string | null;
  filters: DashboardFilterState;
  setDatePreset: (preset: DatePreset) => void;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  setProjectId: (projectId: string) => void;
  setModel: (model: string) => void;
  setIncludeSubagents: (include: boolean) => void;
  setSearch: (search: string) => void;
  resetFilters: () => void;
  refresh: () => Promise<void>;
  savePricing: (next: PricingConfig) => Promise<void>;
  resetPricing: () => Promise<void>;
  setConversationModelOverride: (conversationId: string, modelId: string | null) => Promise<void>;
  liveDelta: LiveTokenDelta | null;
  dismissLiveDelta: () => void;
}

export function useDashboardData(): UseDashboardDataResult {
  const [filters, setFilters] = useState<DashboardFilterState>(INITIAL_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [pricing, setPricing] = useState<PricingConfig>(() => createDefaultPricingConfig());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [liveDelta, setLiveDelta] = useState<LiveTokenDelta | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);
  const prevTotalsRef = useRef<{ tokens: number; cost: number; steps: number } | null>(null);
  const prevFingerprintRef = useRef<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Debounce search input so typing feels snappy without hammering the API
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(filters.search.trim());
    }, 220);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    if (filters.projectId) params.set('projectId', filters.projectId);
    if (filters.model) params.set('model', filters.model);
    params.set('includeSubagents', String(filters.includeSubagents));
    if (debouncedSearch) params.set('search', debouncedSearch);
    return params.toString();
  }, [
    filters.startDate,
    filters.endDate,
    filters.projectId,
    filters.model,
    filters.includeSubagents,
    debouncedSearch,
  ]);

  const fetchDashboard = useCallback(
    async (silent = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!hasLoadedRef.current) {
        setLoading(true);
      } else if (!silent) {
        setRefreshing(true);
      }

      try {
        const res = await fetch(`/api/dashboard?${queryString}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new Error(`Dashboard request failed (${res.status})`);
        }
        const payload: DashboardPayload = await res.json();
        const fingerprint = JSON.stringify([
          queryString,
          payload.kpis.tokens.totalTokens,
          Number(payload.kpis.cost.totalCost.toFixed(6)),
          payload.kpis.totalSteps,
          payload.kpis.conversationCount,
          payload.watchedFiles,
          payload.pricing.fallbackModelId,
          payload.pricing.includeUntagged,
          payload.pricing.longContextEnabled,
          payload.pricing.monthlySubscriptionUsd,
          Object.keys(payload.pricing.conversationModelOverrides ?? {}).length,
        ]);

        // Skip redundant React state updates on silent SSE pings if nothing actually changed
        if (silent && prevFingerprintRef.current === fingerprint) {
          setError(null);
          return;
        }
        prevFingerprintRef.current = fingerprint;

        // If this was a silent live SSE update, emit a token-delta toast when usage increased
        if (silent && prevTotalsRef.current) {
          const dTokens = payload.kpis.tokens.totalTokens - prevTotalsRef.current.tokens;
          const dCost = payload.kpis.cost.totalCost - prevTotalsRef.current.cost;
          const dSteps = payload.kpis.totalSteps - prevTotalsRef.current.steps;
          if (dTokens > 0 || dSteps > 0) {
            setLiveDelta({
              tokens: Math.max(0, dTokens),
              cost: Math.max(0, dCost),
              steps: Math.max(0, dSteps),
              timestamp: Date.now(),
            });
            if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = window.setTimeout(() => setLiveDelta(null), 5000);
          }
        }
        prevTotalsRef.current = {
          tokens: payload.kpis.tokens.totalTokens,
          cost: payload.kpis.cost.totalCost,
          steps: payload.kpis.totalSteps,
        };
        setData(payload);
        if (payload.pricing) {
          setPricing(payload.pricing);
        }
        setLastUpdatedAt(payload.generatedAt || new Date().toISOString());
        setError(null);
        hasLoadedRef.current = true;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message || 'Failed to load dashboard data');
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [queryString],
  );

  useEffect(() => {
    void fetchDashboard(false);
  }, [fetchDashboard]);

  // Keep a stable ref to fetchDashboard for SSE events
  const fetchRef = useRef(fetchDashboard);
  useEffect(() => {
    fetchRef.current = fetchDashboard;
  }, [fetchDashboard]);

  // Subscribe to SSE live updates from /api/events
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/events');

      es.onopen = () => {
        if (!closed) setConnectionStatus('live');
      };

      es.addEventListener('connected', () => {
        if (!closed) setConnectionStatus('live');
      });

      es.addEventListener('update', () => {
        if (!closed) {
          setConnectionStatus('live');
          void fetchRef.current(true);
        }
      });

      es.onmessage = (event) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(event.data);
          if (parsed?.type === 'connected') {
            setConnectionStatus('live');
          } else if (parsed?.type === 'update') {
            setConnectionStatus('live');
            void fetchRef.current(true);
          }
        } catch {
          // Ignore non-JSON heartbeat payloads
        }
      };

      es.onerror = () => {
        if (closed) return;
        setConnectionStatus('reconnecting');
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  const setDatePreset = useCallback((preset: DatePreset) => {
    if (preset === 'custom') {
      setFilters((prev) => ({ ...prev, datePreset: 'custom' }));
      return;
    }
    const range = computePresetRange(preset);
    setFilters((prev) => ({
      ...prev,
      datePreset: preset,
      startDate: range.startDate,
      endDate: range.endDate,
    }));
  }, []);

  const setStartDate = useCallback((startDate: string) => {
    setFilters((prev) => ({
      ...prev,
      datePreset: startDate || prev.endDate ? 'custom' : 'all',
      startDate,
    }));
  }, []);

  const setEndDate = useCallback((endDate: string) => {
    setFilters((prev) => ({
      ...prev,
      datePreset: prev.startDate || endDate ? 'custom' : 'all',
      endDate,
    }));
  }, []);

  const setProjectId = useCallback((projectId: string) => {
    setFilters((prev) => ({ ...prev, projectId }));
  }, []);

  const setModel = useCallback((model: string) => {
    setFilters((prev) => ({ ...prev, model }));
  }, []);

  const setIncludeSubagents = useCallback((includeSubagents: boolean) => {
    setFilters((prev) => ({ ...prev, includeSubagents }));
  }, []);

  const setSearch = useCallback((search: string) => {
    setFilters((prev) => ({ ...prev, search }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, []);

  const refresh = useCallback(async () => {
    await fetchDashboard(false);
  }, [fetchDashboard]);

  const savePricing = useCallback(
    async (next: PricingConfig) => {
      const res = await fetch('/api/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        throw new Error(`Failed to save pricing (${res.status})`);
      }
      const saved: PricingConfig = await res.json();
      setPricing(saved);
      await fetchDashboard(false);
    },
    [fetchDashboard],
  );

  const resetPricing = useCallback(async () => {
    const res = await fetch('/api/pricing/reset', {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error(`Failed to reset pricing (${res.status})`);
    }
    const reset: PricingConfig = await res.json();
    setPricing(reset);
    await fetchDashboard(false);
  }, [fetchDashboard]);

  const setConversationModelOverride = useCallback(
    async (conversationId: string, modelId: string | null) => {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/model-override`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId }),
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to save model override (${res.status})`);
      }
      const result: { pricing: PricingConfig } = await res.json();
      if (result.pricing) setPricing(result.pricing);
      await fetchDashboard(false);
    },
    [fetchDashboard],
  );

  const dismissLiveDelta = useCallback(() => {
    setLiveDelta(null);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  return {
    data,
    pricing,
    loading,
    refreshing,
    error,
    connectionStatus,
    lastUpdatedAt,
    filters,
    setDatePreset,
    setStartDate,
    setEndDate,
    setProjectId,
    setModel,
    setIncludeSubagents,
    setSearch,
    resetFilters,
    refresh,
    savePricing,
    resetPricing,
    setConversationModelOverride,
    liveDelta,
    dismissLiveDelta,
  };
}
