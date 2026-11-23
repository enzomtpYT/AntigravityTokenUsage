import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AntigravityDataLoader,
  normalizeTimestamp,
  normalizeWorkspaceUris,
  parseTranscriptContent,
  parseTranscriptLine,
} from '../server/data-loader.ts';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-loader-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeTranscript(dataDir: string, convId: string, lines: string[]): string {
  const logDir = path.join(dataDir, 'brain', convId, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const filePath = path.join(logDir, 'transcript.jsonl');
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return filePath;
}

describe('Data Loader Utilities', () => {
  test('normalizes workspace URIs cleanly with fallbacks', () => {
    expect(
      normalizeWorkspaceUris('["file:///home/user/Code/My%20Project/"]', 'proj-1'),
    ).toEqual({
      workspacePath: '/home/user/Code/My Project',
      projectDisplayName: 'My Project',
      projectId: '/home/user/Code/My Project',
    });

    expect(normalizeWorkspaceUris('["file:///C:/Users/dev/app/"]')).toEqual({
      workspacePath: 'C:/Users/dev/app',
      projectDisplayName: 'app',
      projectId: 'C:/Users/dev/app',
    });

    expect(normalizeWorkspaceUris('[]', 'custom-project-id')).toEqual({
      workspacePath: null,
      projectDisplayName: 'custom-project-id',
      projectId: 'project:custom-project-id',
    });

    expect(normalizeWorkspaceUris('', '')).toEqual({
      workspacePath: null,
      projectDisplayName: 'Unassigned / General',
      projectId: 'unassigned',
    });
  });

  test('normalizes ISO and SQLite/Go timestamps and rejects zero dates', () => {
    expect(normalizeTimestamp('2026-11-16 12:58:56.317+00:00')).toBe(
      '2026-11-16T12:58:56.317Z',
    );
    expect(normalizeTimestamp('2026-11-22T21:47:18Z')).toBe('2026-11-22T21:47:18.000Z');
    expect(normalizeTimestamp('0001-01-01 00:00:00+00:00')).toBeNull();
    expect(normalizeTimestamp('not-a-date')).toBeNull();
    expect(normalizeTimestamp(null)).toBeNull();
  });

  test('defensively parses JSONL lines and skips malformed entries', () => {
    expect(parseTranscriptLine('', 0)).toBeNull();
    expect(parseTranscriptLine('{not valid json', 1)).toBeNull();
    expect(parseTranscriptLine('[1,2,3]', 2)).toBeNull();

    const step = parseTranscriptLine(
      JSON.stringify({
        step_index: 5,
        created_at: '2026-11-22T10:00:00Z',
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        status: 'ERROR',
        model: 'gemini-4-neon-high',
        input_tokens: 1200,
        cache_read_tokens: 45000,
        output_tokens: 800,
        thinking: 'abcde',
        content: 'hello world',
        tool_calls: [{ name: 'read_file', args: {} }, { name: 'edit_file' }],
        media: [{ mime_type: 'image/png', uri: '/tmp/a.png' }],
        error: 'tool failed',
      }),
      0,
    );

    expect(step).not.toBeNull();
    expect(step!.stepIndex).toBe(5);
    expect(step!.rawModel).toBe('gemini-4-neon-high');
    expect(step!.inputTokens).toBe(1200);
    expect(step!.cacheReadTokens).toBe(45000);
    expect(step!.outputTokens).toBe(800);
    expect(step!.toolCalls).toEqual(['read_file', 'edit_file']);
    expect(step!.thinkingChars).toBe(5);
    expect(step!.contentChars).toBe(11);
    expect(step!.hasMedia).toBe(true);
    expect(step!.hasError).toBe(true);
    expect(step!.errorText).toBe('tool failed');

    const contentSteps = parseTranscriptContent(
      `{"step_index":0,"type":"USER_INPUT"}\n{broken\n{"step_index":1,"input_tokens":50}`,
    );
    expect(contentSteps).toHaveLength(2);
  });
});

describe('AntigravityDataLoader', () => {
  test('loads SQLite DB read-only, parses transcripts incrementally, links hierarchy, and prevents cycles', () => {
    const dir = createTempDir();
    const dbPath = path.join(dir, 'conversation_summaries.db');

    // Create fixture SQLite DB
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE conversation_summaries (
        conversation_id text PRIMARY KEY,
        title text NOT NULL DEFAULT "",
        step_count integer NOT NULL DEFAULT 0,
        last_modified_time datetime NOT NULL,
        workspace_uris text NOT NULL,
        status text NOT NULL DEFAULT "",
        source text NOT NULL DEFAULT "",
        project_id text NOT NULL DEFAULT "",
        agent_name text NOT NULL DEFAULT "",
        parent_conversation_id text NOT NULL DEFAULT "",
        nesting_depth integer NOT NULL DEFAULT 0,
        last_user_input_time datetime NOT NULL,
        group_id text NOT NULL DEFAULT ""
      );
    `);

    const insert = db.query(`
      INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Root conversation
    insert.run(
      'root-1',
      'Main Feature Build',
      4,
      '2026-11-22 10:00:00+00:00',
      '["file:///home/dev/repo-alpha/"]',
      'IDLE',
      'USER',
      'proj-alpha',
      '',
      '',
      0,
      '2026-11-22 09:50:00+00:00',
      '',
    );
    // Child subagent (inherits workspace when empty)
    insert.run(
      'child-1',
      'Research Worker',
      2,
      '2026-11-22 10:05:00+00:00',
      '[]',
      'IDLE',
      'SUBAGENT',
      '',
      'research',
      'root-1',
      1,
      '0001-01-01 00:00:00+00:00',
      'grp-1',
    );
    // Cyclic pair (cyc-a <-> cyc-b) must not cause infinite loops
    insert.run(
      'cyc-a',
      'Cycle A',
      1,
      '2026-11-22 10:00:00+00:00',
      '[]',
      'IDLE',
      'USER',
      '',
      '',
      'cyc-b',
      1,
      '0001-01-01 00:00:00+00:00',
      '',
    );
    insert.run(
      'cyc-b',
      'Cycle B',
      1,
      '2026-11-22 10:00:00+00:00',
      '[]',
      'IDLE',
      'USER',
      '',
      '',
      'cyc-a',
      1,
      '0001-01-01 00:00:00+00:00',
      '',
    );
    db.close();

    // Write transcripts for root-1, child-1, and an orphan-1 (not in DB)
    const rootTranscript = writeTranscript(dir, 'root-1', [
      JSON.stringify({
        step_index: 0,
        created_at: '2026-11-22T10:00:00Z',
        type: 'USER_INPUT',
        source: 'USER_EXPLICIT',
      }),
      JSON.stringify({
        step_index: 1,
        created_at: '2026-11-22T10:01:00Z',
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        model: 'gemini-4-neon-high',
        input_tokens: 1000,
        cache_read_tokens: 5000,
        output_tokens: 200,
      }),
    ]);
    writeTranscript(dir, 'child-1', [
      JSON.stringify({
        step_index: 0,
        created_at: '2026-11-22T10:02:00Z',
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        model: 'gemini-flash-worker-agy',
        input_tokens: 500,
        cache_read_tokens: 2000,
        output_tokens: 100,
      }),
    ]);
    writeTranscript(dir, 'orphan-1', [
      JSON.stringify({
        step_index: 0,
        created_at: '2026-11-22T11:00:00Z',
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        input_tokens: 300,
        cache_read_tokens: 0,
        output_tokens: 50,
      }),
    ]);

    const loader = new AntigravityDataLoader(dir);
    const firstLoad = loader.load();

    expect(firstLoad.conversations.size).toBe(5);
    expect(firstLoad.watchedFiles).toBe(4); // 1 DB + 3 transcripts
    expect(loader.getCacheStats().cachedTranscripts).toBe(3);

    const root = firstLoad.conversations.get('root-1')!;
    const child = firstLoad.conversations.get('child-1')!;
    const orphan = firstLoad.conversations.get('orphan-1')!;

    expect(root.children).toEqual(['child-1']);
    expect(child.meta.nestingDepth).toBe(1);
    expect(child.meta.projectDisplayName).toBe('repo-alpha'); // inherited from parent
    expect(orphan.meta.source).toBe('ORPHAN');
    expect(orphan.meta.projectDisplayName).toBe('Unassigned / General');

    // Second load with unchanged files reuses exact cached array reference
    const secondLoad = loader.load();
    expect(secondLoad.conversations.get('root-1')!.steps).toBe(root.steps);

    // Append a new step to root-1 -> cache invalidates only for root-1
    fs.appendFileSync(
      rootTranscript,
      JSON.stringify({
        step_index: 2,
        created_at: '2026-11-22T10:05:00Z',
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        model: 'gemini-4-neon-high',
        input_tokens: 400,
        cache_read_tokens: 6000,
        output_tokens: 150,
      }) + '\n',
    );

    const thirdLoad = loader.load();
    expect(thirdLoad.conversations.get('root-1')!.steps).toHaveLength(3);
    // child-1 still reused from cache
    expect(thirdLoad.conversations.get('child-1')!.steps).toBe(child.steps);
  });

  test('handles missing data directory gracefully', () => {
    const loader = new AntigravityDataLoader('/tmp/non-existent-antigravity-dir-xyz');
    const dataset = loader.load();
    expect(dataset.conversations.size).toBe(0);
    expect(dataset.watchedFiles).toBe(0);
  });
});
