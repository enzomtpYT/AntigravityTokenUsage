import fs from 'node:fs';
import path from 'node:path';

export type WatchChangeListener = (reason: string) => void;

// Do NOT watch `conversation_summaries.db-shm`: SQLite touches `-shm` on
// read-only opens in WAL mode, which would otherwise create a self-triggering loop.
const DB_WATCH_FILENAMES = new Set([
  'conversation_summaries.db',
  'conversation_summaries.db-wal',
]);

/**
 * Debounced filesystem watcher for `~/.gemini/antigravity/brain` (recursive)
 * and `conversation_summaries.db` / `-wal` files. Tracks `(mtimeMs, size)`
 * signatures so duplicate or read-only metadata events never trigger false refreshes.
 */
export class AntigravityWatcher {
  private readonly dataDir: string;
  private readonly debounceMs: number;
  private readonly listeners = new Set<WatchChangeListener>();
  private readonly fileSignatures = new Map<string, string>();
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingReasons = new Set<string>();
  private running = false;

  constructor(dataDir: string, debounceMs = 800) {
    this.dataDir = dataDir;
    this.debounceMs = debounceMs;
  }

  onChange(listener: WatchChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private hasFileActuallyChanged(fullPath: string): boolean {
    try {
      const stat = fs.statSync(fullPath);
      const sig = `${stat.mtimeMs}:${stat.size}`;
      const prev = this.fileSignatures.get(fullPath);
      if (prev === sig) return false;
      this.fileSignatures.set(fullPath, sig);
      return true;
    } catch {
      // File may have been deleted/rotated — treat as changed once
      if (this.fileSignatures.has(fullPath)) {
        this.fileSignatures.delete(fullPath);
        return true;
      }
      return false;
    }
  }

  private seedSignatures(): void {
    for (const name of DB_WATCH_FILENAMES) {
      const p = path.join(this.dataDir, name);
      try {
        const st = fs.statSync(p);
        this.fileSignatures.set(p, `${st.mtimeMs}:${st.size}`);
      } catch {
        // ignore missing
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.seedSignatures();

    // 1. Watch dataDir (non-recursive) for conversation_summaries.db / -wal writes
    if (fs.existsSync(this.dataDir)) {
      try {
        const dbDirWatcher = fs.watch(this.dataDir, { persistent: false }, (_event, filename) => {
          if (!filename) return;
          const name = String(filename);
          if (!DB_WATCH_FILENAMES.has(name)) return;
          const fullPath = path.join(this.dataDir, name);
          if (this.hasFileActuallyChanged(fullPath)) {
            this.scheduleNotify(name);
          }
        });
        dbDirWatcher.on('error', () => {
          // Ignore transient watcher errors
        });
        this.watchers.push(dbDirWatcher);
      } catch {
        // Fail gracefully if dataDir cannot be watched
      }
    }

    // 2. Watch brain/ recursively for transcript.jsonl updates
    const brainDir = path.join(this.dataDir, 'brain');
    if (fs.existsSync(brainDir)) {
      try {
        const brainWatcher = fs.watch(
          brainDir,
          { recursive: true, persistent: false },
          (_event, filename) => {
            if (!filename) return;
            const name = String(filename);
            if (!name.endsWith('transcript.jsonl')) return;
            const fullPath = path.join(brainDir, name);
            if (this.hasFileActuallyChanged(fullPath)) {
              this.scheduleNotify(`transcript:${name}`);
            }
          },
        );
        brainWatcher.on('error', () => {
          // Ignore transient watcher errors
        });
        this.watchers.push(brainWatcher);
      } catch {
        // Fallback: non-recursive watch on brainDir if recursive is unsupported
        try {
          const fallbackWatcher = fs.watch(brainDir, { persistent: false }, () => {
            this.scheduleNotify('brain');
          });
          fallbackWatcher.on('error', () => {});
          this.watchers.push(fallbackWatcher);
        } catch {
          // Fail gracefully
        }
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingReasons.clear();
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
    }
    this.watchers = [];
  }

  private scheduleNotify(reason: string): void {
    this.pendingReasons.add(reason);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const summary = Array.from(this.pendingReasons).join(', ');
      this.pendingReasons.clear();
      for (const listener of this.listeners) {
        try {
          listener(summary || 'change');
        } catch {
          // Don't let one failing listener break others
        }
      }
    }, this.debounceMs);
  }
}
