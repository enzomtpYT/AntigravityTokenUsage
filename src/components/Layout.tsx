import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  Cpu,
  Flame,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Moon,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Timer,
  X,
} from 'lucide-react';
import type { ConnectionStatus } from '../hooks/useDashboardData';
import { cn, formatRelativeTime } from '../utils/format';

export type NavTab =
  | 'overview'
  | 'projects'
  | 'conversations'
  | 'swarms'
  | 'resets'
  | 'models'
  | 'efficiency';

interface NavItem {
  id: NavTab;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'KPIs, trends & Sankey flow',
    icon: LayoutDashboard,
  },
  {
    id: 'projects',
    label: 'Projects',
    description: 'Treemap & workspace rollups',
    icon: FolderKanban,
  },
  {
    id: 'conversations',
    label: 'Conversations',
    description: 'Chats & deep step inspector',
    icon: MessageSquareText,
  },
  {
    id: 'swarms',
    label: 'Swarms & Agents',
    description: 'Gantt waterfall & agent roles',
    icon: Network,
  },
  {
    id: 'resets',
    label: 'Quota & Resets',
    description: '5h & weekly reset cycles',
    icon: Timer,
  },
  {
    id: 'models',
    label: 'Models & Pricing',
    description: 'ROI, What-If & rate card',
    icon: Cpu,
  },
  {
    id: 'efficiency',
    label: 'Efficiency Lab',
    description: 'Scatter, cache misses & heatmaps',
    icon: Flame,
  },
];

export interface LayoutProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  connectionStatus: ConnectionStatus;
  lastUpdatedAt: string | null;
  watchedFiles?: number;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenCommandPalette?: () => void;
  filterBar?: ReactNode;
  children: ReactNode;
}

function getInitialTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

export function Layout({
  activeTab,
  onTabChange,
  connectionStatus,
  lastUpdatedAt,
  watchedFiles,
  refreshing,
  onRefresh,
  onOpenCommandPalette,
  filterBar,
  children,
}: LayoutProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [, setTick] = useState(0);

  // Refresh relative "last updated" timestamp periodically
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const root = document.documentElement;
    if (next === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
    try {
      localStorage.setItem('agy-theme', next);
    } catch {
      // ignore storage errors
    }
  };

  const activeNav = NAV_ITEMS.find((item) => item.id === activeTab) ?? NAV_ITEMS[0];

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)]">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
              Antigravity
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">Token & Cost Analytics</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] lg:hidden cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 px-2.5 py-3" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onTabChange(item.id);
                setMobileMenuOpen(false);
              }}
              className={cn(
                'group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors cursor-pointer',
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text-primary)] border border-transparent',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-colors',
                  active
                    ? 'text-[var(--accent-primary)]'
                    : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]',
                )}
              />
              <div className="min-w-0">
                <div className="text-xs font-medium leading-tight">{item.label}</div>
                <div className="truncate text-[10px] text-[var(--text-muted)] mt-0.5">
                  {item.description}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Sidebar Footer: Live Status + Read-only badge */}
      <div className="space-y-2 px-3 py-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2 border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {connectionStatus === 'live' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  connectionStatus === 'live'
                    ? 'bg-emerald-500'
                    : connectionStatus === 'reconnecting'
                      ? 'bg-amber-500'
                      : 'bg-zinc-400',
                )}
              />
            </span>
            <span className="text-xs font-medium text-[var(--text-primary)]">
              {connectionStatus === 'live'
                ? 'Live'
                : connectionStatus === 'reconnecting'
                  ? 'Reconnecting'
                  : 'Connecting'}
            </span>
          </div>
          <span className="mono-num text-[11px] text-[var(--text-muted)]">
            {formatRelativeTime(lastUpdatedAt)}
          </span>
        </div>

        <div className="flex items-center justify-between px-1 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent-savings)]" />
            Read-only local
          </span>
          {watchedFiles !== undefined && (
            <span className="mono-num">{watchedFiles} files</span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-60 lg:flex-col bg-[var(--bg-surface)] border-r border-[var(--border-subtle)]">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-64 flex-col bg-[var(--bg-surface)] border-r border-[var(--border-subtle)]">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-[var(--bg-app)]/85 px-4 py-3 backdrop-blur-md border-b border-[var(--border-subtle)] sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] lg:hidden cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-[var(--text-primary)]">
                {activeNav.label}
              </h1>
              <p className="hidden text-xs text-[var(--text-muted)] sm:block">
                {activeNav.description}
              </p>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-2">
            {onOpenCommandPalette && (
              <button
                type="button"
                onClick={onOpenCommandPalette}
                className="hidden md:flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                title="Quick jump (Ctrl+K / Cmd+K)"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Jump to...</span>
                <kbd className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                  ⌘K
                </kbd>
              </button>
            )}

            {/* Compact Live Badge on Header */}
            <div className="hidden sm:flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1.5 border border-[var(--border-subtle)]">
              <span className="relative flex h-2 w-2">
                {connectionStatus === 'live' && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={cn(
                    'relative inline-flex h-2 w-2 rounded-full',
                    connectionStatus === 'live'
                      ? 'bg-emerald-500'
                      : connectionStatus === 'reconnecting'
                        ? 'bg-amber-500'
                        : 'bg-zinc-400',
                  )}
                />
              </span>
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {connectionStatus === 'live'
                  ? 'Live'
                  : connectionStatus === 'reconnecting'
                    ? 'Reconnecting'
                    : 'Connecting'}
              </span>
              {lastUpdatedAt && (
                <span className="mono-num text-[11px] text-[var(--text-muted)] border-l border-[var(--border-subtle)] pl-2">
                  Updated {formatRelativeTime(lastUpdatedAt)}
                </span>
              )}
            </div>

            {/* Manual Refresh Button */}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-60"
              title="Refresh analytics now"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              <span className="hidden md:inline">Refresh</span>
            </button>

            {/* Dark/Light Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center justify-center rounded-lg bg-[var(--bg-surface)] p-1.5 text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        {/* Global Filter Bar + Page Content */}
        <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
          {filterBar}
          {children}
        </main>
      </div>
    </div>
  );
}
