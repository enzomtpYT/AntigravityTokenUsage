import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RawStepRecord {
  stepIndex: number;
  createdAt: string | null;
  type: string;
  source: string;
  status: string;
  rawModel: string | null;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  toolCalls: string[];
  thinkingChars: number;
  contentChars: number;
  hasMedia: boolean;
  hasError: boolean;
  errorText?: string;
}

export interface RawConversationMeta {
  id: string;
  title: string;
  status: string;
  source: string;
  workspacePath: string | null;
  projectDisplayName: string;
  projectId: string;
  rawProjectId: string;
  parentConversationId: string | null;
  nestingDepth: number;
  agentName: string | null;
  groupId: string | null;
  dbStepCount: number;
  lastModifiedTime: string | null;
  lastUserInputTime: string | null;
}

export interface LoadedConversation {
  meta: RawConversationMeta;
  steps: RawStepRecord[];
  hasTranscript: boolean;
  children: string[];
}

export interface LoadedDataset {
  dataDir: string;
  loadedAt: string;
  watchedFiles: number;
  conversations: Map<string, LoadedConversation>;
}

interface TranscriptCacheEntry {
  mtimeMs: number;
  size: number;
  steps: RawStepRecord[];
}

interface DbConversationRow {
  conversation_id: string;
  title: string | null;
  step_count: number | null;
  last_modified_time: string | null;
  workspace_uris: string | null;
  status: string | null;
  source: string | null;
  project_id: string | null;
  agent_name: string | null;
  parent_conversation_id: string | null;
  nesting_depth: number | null;
  last_user_input_time: string | null;
  group_id: string | null;
}

export function getDefaultDataDir(): string {
  const fromEnv = process.env.ANTIGRAVITY_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), '.gemini', 'antigravity');
}

/**
 * Normalizes ISO-8601 and SQLite/Go datetime strings (e.g. "2026-11-16 12:58:56.317+00:00")
 * into canonical ISO-8601 UTC strings. Rejects Go zero times ("0001-01-01...").
 */
export function normalizeTimestamp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('0001-01-01')) return null;

  // Replace space separator between date and time with 'T'
  const isoCandidate = /^\d{4}-\d{2}-\d{2} /.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed;

  const parsed = Date.parse(isoCandidate);
  if (Number.isNaN(parsed)) return null;

  const date = new Date(parsed);
  if (date.getUTCFullYear() < 1970) return null;
  return date.toISOString();
}

export interface NormalizedWorkspace {
  workspacePath: string | null;
  projectDisplayName: string;
  projectId: string;
}

/**
 * Normalizes `workspace_uris` (JSON array of `file://...` URIs) into a canonical
 * workspace path, display name, and project grouping ID.
 */
export function normalizeWorkspaceUris(
  workspaceUrisRaw: string | null | undefined,
  rawProjectId?: string | null,
): NormalizedWorkspace {
  let uris: string[] = [];

  if (typeof workspaceUrisRaw === 'string' && workspaceUrisRaw.trim()) {
    const trimmed = workspaceUrisRaw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          uris = parsed.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
        }
      } catch {
        // Ignore malformed JSON and fall through
      }
    } else {
      uris = [trimmed];
    }
  }

  const firstUri = uris[0]?.trim();
  if (firstUri) {
    let normalized = firstUri;
    if (normalized.startsWith('file://')) {
      normalized = normalized.slice('file://'.length);
      // Handle Windows file:///C:/... -> C:/...
      if (/^\/[a-zA-Z]:\//.test(normalized)) {
        normalized = normalized.slice(1);
      }
    }

    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep raw string if URI decoding fails
    }

    // Normalize backslashes to forward slashes and strip trailing slashes (except root '/')
    normalized = normalized.replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    if (normalized) {
      const displayName = path.posix.basename(normalized) || normalized;
      return {
        workspacePath: normalized,
        projectDisplayName: displayName,
        projectId: normalized,
      };
    }
  }

  const cleanProjectId = rawProjectId?.trim();
  if (cleanProjectId) {
    return {
      workspacePath: null,
      projectDisplayName: cleanProjectId,
      projectId: `project:${cleanProjectId}`,
    };
  }

  return {
    workspacePath: null,
    projectDisplayName: 'Unassigned / General',
    projectId: 'unassigned',
  };
}

/**
 * Defensively parses a single JSONL line from `transcript.jsonl`.
 * Returns null for empty, malformed, or non-object lines.
 */
export function parseTranscriptLine(line: string, fallbackIndex: number): RawStepRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const stepIndex =
    typeof obj.step_index === 'number' && Number.isFinite(obj.step_index)
      ? obj.step_index
      : fallbackIndex;

  const createdAt = normalizeTimestamp(obj.created_at);
  const type = typeof obj.type === 'string' && obj.type ? obj.type : 'UNKNOWN';
  const source = typeof obj.source === 'string' && obj.source ? obj.source : 'UNKNOWN';
  const status = typeof obj.status === 'string' && obj.status ? obj.status : 'UNKNOWN';
  const rawModel =
    typeof obj.model === 'string' && obj.model.trim().length > 0 ? obj.model.trim() : null;

  const inputTokens = Math.max(0, Number(obj.input_tokens) || 0);
  const cacheReadTokens = Math.max(0, Number(obj.cache_read_tokens) || 0);
  const outputTokens = Math.max(0, Number(obj.output_tokens) || 0);

  const toolCalls: string[] = [];
  if (Array.isArray(obj.tool_calls)) {
    for (const tc of obj.tool_calls) {
      if (typeof tc === 'string' && tc.trim()) {
        toolCalls.push(tc.trim());
      } else if (tc && typeof tc === 'object') {
        const name = (tc as Record<string, unknown>).name;
        if (typeof name === 'string' && name.trim()) {
          toolCalls.push(name.trim());
        }
      }
    }
  }

  const thinkingChars = typeof obj.thinking === 'string' ? obj.thinking.length : 0;
  const contentChars = typeof obj.content === 'string' ? obj.content.length : 0;
  const hasMedia = Array.isArray(obj.media) ? obj.media.length > 0 : Boolean(obj.media);

  let errorText: string | undefined;
  if (typeof obj.error === 'string' && obj.error.trim().length > 0) {
    errorText = obj.error.trim();
  } else if (obj.error && typeof obj.error === 'object') {
    try {
      errorText = JSON.stringify(obj.error);
    } catch {
      errorText = 'Unknown error';
    }
  }

  const hasError = status === 'ERROR' || Boolean(errorText);

  return {
    stepIndex,
    createdAt,
    type,
    source,
    status,
    rawModel,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    toolCalls,
    thinkingChars,
    contentChars,
    hasMedia,
    hasError,
    ...(errorText ? { errorText } : {}),
  };
}

/**
 * Parses an entire JSONL string into `RawStepRecord[]`.
 */
export function parseTranscriptContent(content: string): RawStepRecord[] {
  const lines = content.split(/\r?\n/);
  const steps: RawStepRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTranscriptLine(lines[i], i);
    if (parsed) {
      steps.push(parsed);
    }
  }
  return steps;
}

/**
 * Strictly read-only incremental data loader for `~/.gemini/antigravity`.
 * Caches parsed `transcript.jsonl` files by `(mtimeMs, size)` so live refreshes
 * only re-parse modified files.
 */
export class AntigravityDataLoader {
  private readonly dataDir: string;
  private readonly transcriptCache = new Map<string, TranscriptCacheEntry>();

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? getDefaultDataDir();
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getCacheStats(): { cachedTranscripts: number } {
    return { cachedTranscripts: this.transcriptCache.size };
  }

  /**
   * Loads conversation metadata from `conversation_summaries.db` (strictly read-only)
   * and transcripts from `brain/*\/.system_generated/logs/transcript.jsonl`.
   */
  load(): LoadedDataset {
    const dbMetaMap = this.readDatabaseMetadata();
    const { transcripts, watchedFiles } = this.readTranscriptsIncremental();

    const conversations = new Map<string, LoadedConversation>();

    // 1. Add all conversations present in SQLite DB
    for (const [id, meta] of dbMetaMap.entries()) {
      const steps = transcripts.get(id) ?? [];
      conversations.set(id, {
        meta,
        steps,
        hasTranscript: transcripts.has(id),
        children: [],
      });
    }

    // 2. Add orphan transcripts not present in SQLite DB
    for (const [id, steps] of transcripts.entries()) {
      if (conversations.has(id)) continue;
      const lastStepAt = steps.length > 0 ? steps[steps.length - 1].createdAt : null;
      conversations.set(id, {
        meta: {
          id,
          title: `Untitled Conversation (${id.slice(0, 8)})`,
          status: 'UNKNOWN',
          source: 'ORPHAN',
          workspacePath: null,
          projectDisplayName: 'Unassigned / General',
          projectId: 'unassigned',
          rawProjectId: '',
          parentConversationId: null,
          nestingDepth: 0,
          agentName: null,
          groupId: null,
          dbStepCount: steps.length,
          lastModifiedTime: lastStepAt,
          lastUserInputTime: null,
        },
        steps,
        hasTranscript: true,
        children: [],
      });
    }

    // 3. Build cycle-safe parent-child hierarchy
    this.buildHierarchy(conversations);

    return {
      dataDir: this.dataDir,
      loadedAt: new Date().toISOString(),
      watchedFiles,
      conversations,
    };
  }

  private readDatabaseMetadata(): Map<string, RawConversationMeta> {
    const result = new Map<string, RawConversationMeta>();
    const dbPath = path.join(this.dataDir, 'conversation_summaries.db');

    if (!fs.existsSync(dbPath)) {
      return result;
    }

    let db: Database | null = null;
    try {
      // Strictly read-only access to ~/.gemini/antigravity/conversation_summaries.db
      db = new Database(dbPath, { readonly: true });

      const rows = db
        .query<DbConversationRow, []>(
          `SELECT
            conversation_id,
            title,
            step_count,
            last_modified_time,
            workspace_uris,
            status,
            source,
            project_id,
            agent_name,
            parent_conversation_id,
            nesting_depth,
            last_user_input_time,
            group_id
          FROM conversation_summaries`,
        )
        .all();

      // Optional supplemental parent table (present in newer Antigravity schemas)
      const parentOverrides = new Map<string, string>();
      try {
        const parentRows = db
          .query<{ conversation_id: string; parent_id: string }, []>(
            `SELECT conversation_id, parent_id FROM conversation_parents`,
          )
          .all();
        for (const pr of parentRows) {
          if (pr.conversation_id && pr.parent_id) {
            parentOverrides.set(pr.conversation_id, pr.parent_id);
          }
        }
      } catch {
        // Table may not exist in older schemas or test fixtures; ignore safely
      }

      for (const row of rows) {
        const id = row.conversation_id?.trim();
        if (!id) continue;

        const rawProjectId = row.project_id?.trim() ?? '';
        const ws = normalizeWorkspaceUris(row.workspace_uris, rawProjectId);

        const rawParent =
          row.parent_conversation_id?.trim() || parentOverrides.get(id)?.trim() || null;
        const agentName = row.agent_name?.trim() || null;
        const groupId = row.group_id?.trim() || null;

        const rawTitle = row.title?.trim();
        const fallbackTitle = agentName
          ? `${agentName} (${id.slice(0, 8)})`
          : `Untitled (${id.slice(0, 8)})`;

        result.set(id, {
          id,
          title: rawTitle || fallbackTitle,
          status: row.status?.trim() || 'UNKNOWN',
          source: row.source?.trim() || 'UNKNOWN',
          workspacePath: ws.workspacePath,
          projectDisplayName: ws.projectDisplayName,
          projectId: ws.projectId,
          rawProjectId,
          parentConversationId: rawParent && rawParent !== id ? rawParent : null,
          nestingDepth: Math.max(0, Number(row.nesting_depth) || 0),
          agentName,
          groupId,
          dbStepCount: Math.max(0, Number(row.step_count) || 0),
          lastModifiedTime: normalizeTimestamp(row.last_modified_time),
          lastUserInputTime: normalizeTimestamp(row.last_user_input_time),
        });
      }
    } catch {
      // Gracefully handle busy/locked/corrupt DB without crashing the server
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
      }
    }

    return result;
  }

  private readTranscriptsIncremental(): {
    transcripts: Map<string, RawStepRecord[]>;
    watchedFiles: number;
  } {
    const transcripts = new Map<string, RawStepRecord[]>();
    const brainDir = path.join(this.dataDir, 'brain');
    let watchedFiles = 0;

    if (fs.existsSync(path.join(this.dataDir, 'conversation_summaries.db'))) {
      watchedFiles += 1;
    }

    if (!fs.existsSync(brainDir)) {
      this.transcriptCache.clear();
      return { transcripts, watchedFiles };
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(brainDir, { withFileTypes: true });
    } catch {
      return { transcripts, watchedFiles };
    }

    const activePaths = new Set<string>();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const conversationId = entry.name;
      const transcriptPath = path.join(
        brainDir,
        conversationId,
        '.system_generated',
        'logs',
        'transcript.jsonl',
      );

      let stat: fs.Stats;
      try {
        stat = fs.statSync(transcriptPath);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }

      watchedFiles += 1;
      activePaths.add(transcriptPath);

      const cached = this.transcriptCache.get(transcriptPath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        transcripts.set(conversationId, cached.steps);
        continue;
      }

      try {
        const content = fs.readFileSync(transcriptPath, 'utf8');
        const steps = parseTranscriptContent(content);
        this.transcriptCache.set(transcriptPath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          steps,
        });
        transcripts.set(conversationId, steps);
      } catch {
        // If file is momentarily unreadable, reuse cache if available
        if (cached) {
          transcripts.set(conversationId, cached.steps);
        }
      }
    }

    // Evict removed transcripts from cache
    for (const cachedPath of this.transcriptCache.keys()) {
      if (!activePaths.has(cachedPath)) {
        this.transcriptCache.delete(cachedPath);
      }
    }

    return { transcripts, watchedFiles };
  }

  private buildHierarchy(conversations: Map<string, LoadedConversation>): void {
    // 1. Validate parent references & break any cycles
    for (const conv of conversations.values()) {
      const parentId = conv.meta.parentConversationId;
      if (!parentId) continue;

      if (parentId === conv.meta.id || !conversations.has(parentId)) {
        // Parent doesn't exist in dataset -> treat as top-level in our tree
        conv.meta.parentConversationId = null;
        continue;
      }

      // Cycle detection: walk up from parentId to ensure we never reach conv.meta.id
      const visited = new Set<string>([conv.meta.id]);
      let cursor: string | null = parentId;
      let hasCycle = false;
      while (cursor) {
        if (visited.has(cursor)) {
          hasCycle = true;
          break;
        }
        visited.add(cursor);
        cursor = conversations.get(cursor)?.meta.parentConversationId ?? null;
      }

      if (hasCycle) {
        conv.meta.parentConversationId = null;
        continue;
      }

      conversations.get(parentId)!.children.push(conv.meta.id);
    }

    // 2. Recompute nestingDepth & inherit workspace from parent if unassigned
    for (const conv of conversations.values()) {
      let depth = 0;
      let cursor = conv.meta.parentConversationId;
      const seen = new Set<string>([conv.meta.id]);
      let ancestorWithWorkspace: RawConversationMeta | null = null;

      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        depth += 1;
        const parent = conversations.get(cursor);
        if (!parent) break;
        if (!ancestorWithWorkspace && parent.meta.projectId !== 'unassigned') {
          ancestorWithWorkspace = parent.meta;
        }
        cursor = parent.meta.parentConversationId;
      }

      conv.meta.nestingDepth = depth;
      if (conv.meta.projectId === 'unassigned' && ancestorWithWorkspace) {
        conv.meta.workspacePath = ancestorWithWorkspace.workspacePath;
        conv.meta.projectDisplayName = ancestorWithWorkspace.projectDisplayName;
        conv.meta.projectId = ancestorWithWorkspace.projectId;
      }
    }

    // 3. Deterministically sort children lists by first step / lastModifiedTime / id
    for (const conv of conversations.values()) {
      if (conv.children.length <= 1) continue;
      conv.children.sort((aId, bId) => {
        const a = conversations.get(aId)!;
        const b = conversations.get(bId)!;
        const aTime = a.steps[0]?.createdAt ?? a.meta.lastModifiedTime ?? '';
        const bTime = b.steps[0]?.createdAt ?? b.meta.lastModifiedTime ?? '';
        if (aTime !== bTime) return aTime.localeCompare(bTime);
        return aId.localeCompare(bId);
      });
    }
  }
}
