import type { ReactNode } from 'react';
import { cn } from '../utils/format';

export interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  icon?: ReactNode;
  accentColor?: string;
  footer?: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function KpiCard({
  title,
  value,
  subtitle,
  badge,
  icon,
  accentColor,
  footer,
  className,
  onClick,
}: KpiCardProps) {
  const Component = onClick ? 'button' : 'div';
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'surface-card relative flex flex-col justify-between rounded-xl p-4 text-left transition-colors duration-150',
        'hover:border-[var(--border-strong)]',
        onClick && 'cursor-pointer hover:bg-[var(--bg-elevated)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {accentColor && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: accentColor }}
            />
          )}
          <span className="text-xs font-medium tracking-wide text-[var(--text-secondary)]">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {badge}
          {icon && (
            <span className="text-[var(--text-muted)]">{icon}</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <div className="mono-num text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          {value}
        </div>
      </div>

      {subtitle && (
        <div className="mt-1.5 text-xs text-[var(--text-secondary)]">
          {subtitle}
        </div>
      )}

      {footer && (
        <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)]">
          {footer}
        </div>
      )}
    </Component>
  );
}
