import { Activity, X } from 'lucide-react';
import { formatTokens, formatUsd } from '../utils/format';

export interface LiveTokenDelta {
  tokens: number;
  cost: number;
  steps: number;
  timestamp: number;
}

export function LiveToast({
  delta,
  onDismiss,
}: {
  delta: LiveTokenDelta | null;
  onDismiss: () => void;
}) {
  if (!delta) return null;

  return (
    <div className="fixed right-4 bottom-4 z-40 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-[var(--bg-surface)] px-3.5 py-2.5 shadow-2xl">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
        <Activity className="h-3.5 w-3.5" />
      </span>
      <div className="text-xs">
        <div className="font-medium text-[var(--text-primary)]">Live Antigravity Activity</div>
        <div className="mono-num text-[11px] text-[var(--text-secondary)]">
          {delta.tokens > 0 && (
            <span className="text-sky-400 font-medium">+{formatTokens(delta.tokens)} tok</span>
          )}
          {delta.cost > 0 && (
            <>
              {' · '}
              <span className="text-emerald-400 font-medium">+{formatUsd(delta.cost)}</span>
            </>
          )}
          {delta.steps > 0 && (
            <>
              {' · '}
              <span>+{delta.steps} {delta.steps === 1 ? 'step' : 'steps'}</span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
