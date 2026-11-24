# AGENTS.md — Engineering Guide for Coding Agents

This file is the canonical instruction guide for all AI coding agents working in **Antigravity Token Usage & API Cost Dashboard** (symlinked from `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.clinerules`, `.windsurfrules`, and `.github/copilot-instructions.md`).

---

## 1. Project Overview & Tech Stack

- **Purpose**: Local real-time analytics dashboard reading `~/.gemini/antigravity` strictly read-only to track token usage, prompt-cache savings, multi-agent/swarm lifespans, turn latencies, and estimated public API costs.
- **Runtime & Package Manager**: **Bun** (`bun install`, `bun test`, `bun run dev`, `bun run build`, `bun run start`).
- **Backend (`server/`)**: `Bun.serve` + `bun:sqlite` (`{ readonly: true }`) + `fs.watch` + SSE `/api/events`.
- **Frontend (`src/`)**: React 19, Vite 6, TypeScript (strict), Tailwind CSS v4, **tree-shaken Apache ECharts (`echarts/core`)**, Lucide React.
- **Shared Contracts (`src/shared/`)**: Imported by both `server/` and `src/`.

### Directory Map

```text
server/
  data-loader.ts    # Read-only SQLite + incremental (mtime,size) JSONL parser + hierarchy builder
  analytics.ts      # Pure aggregation engine (KPIs, Sankey, scatter, swarms, efficiency scores, WoW)
  watcher.ts        # Debounced fs.watch on ~/.gemini/antigravity
  index.ts          # Hardened Bun HTTP/SSE server, localhost CORS/CSRF, security headers, LRU cache
src/
  shared/
    types.ts        # Single source of truth for API & domain TypeScript interfaces
    pricing.ts      # Default model rate card (Gemini 3.8 Flash fallback), cost/ROI/What-If math
  components/
    EChart.tsx      # Tree-shaken echarts/core wrapper + ResizeObserver + dark/light theme hook
    Layout.tsx      # 6-tab sidebar shell + live SSE status + Cmd+K trigger + theme toggle
    FilterBar.tsx   # Global date/project/model/subagent/search filters + CSV/JSON export
    ConversationInspector.tsx  # Step-level ECharts context/cost/latency inspector + manual model tagger
    CommandPalette.tsx         # Cmd/Ctrl+K quick jump
    LiveToast.tsx              # Real-time SSE token-delta toast
  pages/
    OverviewPage.tsx           # KPIs, Fun Insights/WoW strip, zoomable time-series, Sankey
    ProjectsPage.tsx           # Spend Treemap + sortable workspace table
    ConversationsPage.tsx      # Expandable parent-child conversation tree
    SwarmsPage.tsx             # Swarm Gantt waterfall + agent role leaderboard
    ResetsPage.tsx             # Quota & Resets (5h/weekly cycles, dual pools, server resets, limit hits)
    ModelsPage.tsx             # Subscription ROI, What-If simulator, editable rate card
    EfficiencyLabPage.tsx      # Efficiency grade, scatter plot, heatmaps, tool chains, outliers
  utils/
    sanitize.ts     # escapeHtml() & sanitizeCssColor() for ECharts HTML tooltips
    export.ts       # Formula-safe CSV & JSON exporters
    format.ts       # USD, token, duration, latency, percent, grade badge formatters
public/
  theme-init.js     # External pre-paint theme script (keeps CSP script-src 'self' inline-free)
tests/
  pricing.test.ts
  data-loader.test.ts
  analytics.test.ts
  security.test.ts
```

---

## 2. Non-Negotiable Invariants

### Read-Only Local Data Guarantee
- **NEVER** write to, create files in, or open `~/.gemini/antigravity` read-write.
- `conversation_summaries.db` MUST always be opened with `new Database(dbPath, { readonly: true })`.
- User-editable settings (pricing overrides, subscription price, manual conversation model tags) live strictly inside `data/pricing-overrides.json` in this repository.

### Verified Antigravity Token Semantics
Verified directly against real `transcript.jsonl` files:
- `input_tokens` = **uncached (fresh)** input tokens (NOT inclusive of `cache_read_tokens`).
- `cache_read_tokens` = **separate cached** input tokens.
- `totalContext = input_tokens + cache_read_tokens`.
- `totalTokens = input_tokens + cache_read_tokens + output_tokens`.
- `cacheHitRatio = cache_read_tokens / (input_tokens + cache_read_tokens)`.
- Never subtract `cache_read_tokens` from `input_tokens`.
- Older transcripts (pre-Nov 21) omit the `model` field. Keep them clearly labeled `Untagged (est. <Fallback>)` (default fallback: `gemini-3.8-flash`) unless overridden via `conversationModelOverrides`.

### Strict No-Double-Counting Rollup Rule
- Global KPIs, time-series, heatmaps, models, and tools MUST iterate each included conversation's **direct** steps once.
- Per-conversation and per-project `rolledUp` metrics aggregate unique descendant subagents via cycle-safe BFS (`collectDescendants`). Never sum parent `rolledUp` + child `rolledUp`.

---

## 3. Security & XSS Rules

1. **ECharts HTML Tooltip Escaping (Critical)**:
   - ECharts renders `tooltip.formatter` strings as HTML. **EVERY** dynamic field (conversation titles, project names, agent names, model labels, tool names, dates, formatted values) MUST be wrapped in `escapeHtml(...)` from `src/utils/sanitize.ts`.
   - Every dynamic color embedded in `style="..."` MUST pass through `sanitizeCssColor(...)`.
2. **Localhost Binding & CORS/CSRF**:
   - Keep `server/index.ts` defaulting to `hostname: '127.0.0.1'` (`HOST` env override allowed).
   - Never restore `Access-Control-Allow-Origin: *`. Only allow `http://localhost:*` and `http://127.0.0.1:*`, and keep `isMutatingOriginAllowed(req)` enforced on all `PUT`/`POST` routes.
3. **CSP & Inline Scripts**:
   - Do not add inline `<script>` tags to `index.html`; keep `public/theme-init.js` external so `script-src 'self'` remains strict.
4. **Input & Export Hygiene**:
   - Preserve body size caps (`MAX_JSON_BODY_BYTES`), prototype-pollution key blocks (`__proto__`, `constructor`, `prototype`), safe `decodeURIComponent`, `fs.realpathSync` static file checks, and CSV formula-injection prefixing (`=`, `+`, `-`, `@`, `\t`, `\r`) in `src/utils/export.ts`.

---

## 4. Performance & ECharts Conventions

- **Tree-Shaken ECharts Only**: Never `import * as echarts from 'echarts'`. Import from `echarts/core` and register any new chart/component module in `src/components/EChart.tsx`. Import `type { EChartsCoreOption }` from `../components/EChart`.
- **Route Splitting**: Keep secondary tabs lazy-loaded via `React.lazy()` in `src/App.tsx`.
- **Backend Cache Invalidation**: Whenever `datasetDirty` triggers a reload or `pricingConfig` mutates in `server/index.ts`, increment `datasetVersion` / `pricingVersion` and clear `dashboardCache`.

---

## 5. Verification Checklist (Required Before Finishing Any Change)

Run and confirm **zero errors** on both commands before reporting work complete:

```bash
bun test          # Unit + analytics + security tests
bun run build     # tsc --noEmit && vite build
```
