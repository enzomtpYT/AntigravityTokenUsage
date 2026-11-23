import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Coins,
  FlaskConical,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  MessageSquareText,
  Network,
  Search,
  X,
} from 'lucide-react';
import type { DashboardPayload } from '../shared/types';
import type { NavTab } from './Layout';
import { cn, formatTokens, formatUsd } from '../utils/format';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  data: DashboardPayload | null;
  onNavigateTab: (tab: NavTab) => void;
  onSelectProject: (projectId: string) => void;
  onSelectConversation: (conversationId: string) => void;
}

interface PaletteItem {
  id: string;
  group: 'Navigation' | 'Projects' | 'Conversations';
  title: string;
  subtitle?: string;
  metric?: string;
  badge?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export function CommandPalette({
  open,
  onClose,
  data,
  onNavigateTab,
  onSelectProject,
  onSelectConversation,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const list: PaletteItem[] = [];

    const tabs: { id: NavTab; label: string; desc: string; icon: React.ReactNode }[] = [
      { id: 'overview', label: 'Overview', desc: 'KPIs, spend timeline & Sankey cost flow', icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: 'projects', label: 'Projects', desc: 'Spend Treemap & workspace rollups', icon: <FolderKanban className="h-4 w-4" /> },
      { id: 'conversations', label: 'Conversations', desc: 'Chats, subagent trees & deep step inspector', icon: <MessageSquareText className="h-4 w-4" /> },
      { id: 'swarms', label: 'Swarms & Agents', desc: 'Gantt execution waterfall & agent roles', icon: <Network className="h-4 w-4" /> },
      { id: 'models', label: 'Models & Pricing', desc: 'Subscription ROI, What-If simulator & rate card', icon: <Coins className="h-4 w-4" /> },
      { id: 'efficiency', label: 'Efficiency Lab', desc: 'Cache-miss detector, scatter plot & heatmaps', icon: <FlaskConical className="h-4 w-4" /> },
    ];

    for (const t of tabs) {
      if (!q || t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)) {
        list.push({
          id: `tab:${t.id}`,
          group: 'Navigation',
          title: t.label,
          subtitle: t.desc,
          icon: t.icon,
          onSelect: () => {
            onNavigateTab(t.id);
            onClose();
          },
        });
      }
    }

    if (data) {
      const matchingProjects = data.projects
        .filter(
          (p) =>
            !q ||
            p.displayName.toLowerCase().includes(q) ||
            (p.workspacePath ?? '').toLowerCase().includes(q),
        )
        .slice(0, q ? 8 : 5);

      for (const p of matchingProjects) {
        list.push({
          id: `proj:${p.id}`,
          group: 'Projects',
          title: p.displayName,
          subtitle: p.workspacePath ?? `${p.conversationCount} chats`,
          metric: `${formatUsd(p.rolledUp.cost.totalCost)} · ${formatTokens(p.rolledUp.tokens.totalTokens)}`,
          icon: <FolderKanban className="h-4 w-4 text-sky-400" />,
          onSelect: () => {
            onSelectProject(p.id);
            onClose();
          },
        });
      }

      const matchingConvs = data.conversations
        .filter(
          (c) =>
            !q ||
            c.title.toLowerCase().includes(q) ||
            c.projectDisplayName.toLowerCase().includes(q) ||
            (c.agentName ?? '').toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q),
        )
        .slice(0, q ? 14 : 6);

      for (const c of matchingConvs) {
        const isSub = Boolean(c.parentConversationId);
        list.push({
          id: `conv:${c.id}`,
          group: 'Conversations',
          title: c.title || 'Untitled Conversation',
          subtitle: `${c.projectDisplayName}${c.agentName ? ` · @${c.agentName}` : ''}`,
          metric: `${formatUsd(c.rolledUp.cost.totalCost)} · ${formatTokens(c.rolledUp.tokens.totalTokens)}`,
          badge: isSub ? c.agentName ?? 'subagent' : c.subagentCount > 0 ? `${c.subagentCount} sub` : undefined,
          icon: isSub ? (
            <Bot className="h-4 w-4 text-violet-400" />
          ) : c.subagentCount > 0 ? (
            <GitBranch className="h-4 w-4 text-indigo-400" />
          ) : (
            <MessageSquareText className="h-4 w-4 text-[var(--text-muted)]" />
          ),
          onSelect: () => {
            onSelectConversation(c.id);
            onClose();
          },
        });
      }
    }

    return list;
  }, [query, data, onNavigateTab, onSelectProject, onSelectConversation, onClose]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (items.length > 0 ? (i + 1) % items.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (items.length > 0 ? (i - 1 + items.length) % items.length : 0));
      } else if (e.key === 'Enter' && items[activeIndex]) {
        e.preventDefault();
        items[activeIndex].onSelect();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, items, activeIndex, onClose]);

  if (!open) return null;

  let lastGroup: string | null = null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5 py-3">
          <Search className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a tab, project, conversation, or subagent..."
            className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--text-muted)]">
              No matching tabs, projects, or conversations.
            </div>
          ) : (
            items.map((item, idx) => {
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              const isActive = idx === activeIndex;
              return (
                <div key={item.id}>
                  {showGroup && (
                    <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={item.onSelect}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer',
                      isActive ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="shrink-0">{item.icon}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                            {item.title}
                          </span>
                          {item.badge && (
                            <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        {item.subtitle && (
                          <div className="truncate text-[11px] text-[var(--text-muted)]">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    {item.metric && (
                      <span className="mono-num shrink-0 text-[11px] text-[var(--text-secondary)]">
                        {item.metric}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2 text-[10px] text-[var(--text-muted)]">
          <div className="flex items-center gap-3">
            <span><kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5 font-mono">↑↓</kbd> Navigate</span>
            <span><kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5 font-mono">↵</kbd> Open</span>
            <span><kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5 font-mono">Esc</kbd> Close</span>
          </div>
          <span>Quick Jump</span>
        </div>
      </div>
    </div>
  );
}
