'use client';

import { forwardRef } from 'react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export type WorkspacePrimitiveTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

const surfaceToneClass: Record<WorkspacePrimitiveTone, string> = {
  neutral: 'border-[var(--app-border-soft)] bg-[var(--app-surface)]',
  accent: 'border-[var(--app-border-strong)] bg-[var(--app-accent-soft)]',
  info: 'border-sky-400/16 bg-sky-400/[0.08]',
  success: 'border-emerald-400/16 bg-emerald-400/[0.08]',
  warning: 'border-amber-400/16 bg-amber-400/[0.08]',
  danger: 'border-red-400/16 bg-red-400/[0.08]',
};

const textToneClass: Record<WorkspacePrimitiveTone, string> = {
  neutral: 'text-[var(--app-text)]',
  accent: 'text-[var(--app-text)]',
  info: 'text-[var(--app-text)]',
  success: 'text-[var(--app-text)]',
  warning: 'text-[var(--app-text)]',
  danger: 'text-[var(--app-text)]',
};

const badgeToneClass: Record<WorkspacePrimitiveTone, string> = {
  neutral: 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)]',
  accent: 'border-[var(--app-border-strong)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
  info: 'border-sky-400/20 bg-sky-400/10 text-sky-700',
  success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-700',
  warning: 'border-amber-400/20 bg-amber-400/10 text-amber-700',
  danger: 'border-red-400/20 bg-red-400/10 text-red-700',
};

export const workspaceFieldClassName =
  'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text)] placeholder:text-[var(--app-text-muted)] focus-visible:ring-[var(--app-accent)]/20';

export const workspaceOutlineActionClassName =
  'border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text-soft)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]';

export const workspaceGhostActionClassName =
  'text-[var(--app-text-muted)] hover:bg-[var(--app-raised)] hover:text-[var(--app-text)]';

export const workspaceCodeBlockClassName =
  'rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-3 font-mono text-xs leading-5 text-[var(--app-text-soft)]';

type WorkspaceSurfaceProps = {
  children: React.ReactNode;
  className?: string;
  tone?: WorkspacePrimitiveTone;
  padding?: 'none' | 'sm' | 'md' | 'lg';
};

export const WorkspaceSurface = forwardRef<HTMLDivElement, WorkspaceSurfaceProps>(function WorkspaceSurface({
  children,
  className,
  tone = 'neutral',
  padding = 'md',
}, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[24px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] backdrop-blur-xl',
        surfaceToneClass[tone],
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-4',
        padding === 'lg' && 'p-5',
        className,
      )}
    >
      {children}
    </div>
  );
});

export function WorkspaceInteractiveSurface({
  children,
  className,
  tone = 'neutral',
  active = false,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: WorkspacePrimitiveTone;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'group w-full cursor-pointer rounded-[22px] border p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] transition-all',
        active
          ? 'border-[var(--app-border-strong)] bg-[linear-gradient(135deg,rgba(47,109,246,0.12),rgba(255,255,255,0.95))]'
          : surfaceToneClass[tone],
        !active && 'hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised)]',
        className,
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      {children}
    </div>
  );
}

export function WorkspaceMiniMetric({
  label,
  value,
  detail,
  tone = 'neutral',
  className,
  valueClassName,
  detailClassName,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: WorkspacePrimitiveTone;
  className?: string;
  valueClassName?: string;
  detailClassName?: string;
}) {
  return (
    <WorkspaceSurface tone={tone} padding="sm" className={cn('min-w-0', className)}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{label}</div>
      <div className={cn('mt-2 text-xl font-semibold tracking-[-0.04em]', textToneClass[tone], valueClassName)}>{value}</div>
      {detail ? <div className={cn('mt-1 truncate text-[11px] text-[var(--app-text-soft)]', detailClassName)}>{detail}</div> : null}
    </WorkspaceSurface>
  );
}

export function WorkspaceListItem({
  icon,
  title,
  description,
  meta,
  actions,
  tone = 'neutral',
  className,
  onClick,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: WorkspacePrimitiveTone;
  className?: string;
  onClick?: () => void;
}) {
  const content = (
    <div className="flex min-w-0 items-start gap-3">
      {icon ? (
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised-2)] text-[var(--app-accent)]">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--app-text)]">{title}</div>
        {description ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--app-text-soft)]">{description}</div> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--app-text-muted)]">{meta}</div> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );

  if (onClick) {
    return (
      <WorkspaceInteractiveSurface tone={tone} className={className} onClick={onClick}>
        {content}
      </WorkspaceInteractiveSurface>
    );
  }

  return (
    <WorkspaceSurface tone={tone} padding="sm" className={className}>
      {content}
    </WorkspaceSurface>
  );
}

export function WorkspaceBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: WorkspacePrimitiveTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]',
        badgeToneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function WorkspaceIconFrame({
  children,
  tone = 'accent',
  className,
}: {
  children: React.ReactNode;
  tone?: WorkspacePrimitiveTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border',
        surfaceToneClass[tone],
        tone === 'accent' ? 'text-[var(--app-accent)]' : textToneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function WorkspaceStatusDot({
  tone = 'neutral',
  pulse = false,
  className,
}: {
  tone?: WorkspacePrimitiveTone;
  pulse?: boolean;
  className?: string;
}) {
  const colorClass: Record<WorkspacePrimitiveTone, string> = {
    neutral: 'bg-[var(--app-text-muted)]',
    accent: 'bg-[var(--app-accent)]',
    info: 'bg-sky-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
  };

  return (
    <span
      className={cn(
        'inline-flex h-2 w-2 shrink-0 rounded-full',
        colorClass[tone],
        pulse && 'animate-pulse',
        className,
      )}
    />
  );
}

export function WorkspaceSectionHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">{eyebrow}</div> : null}
        <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[var(--app-text)]">
          {icon ? <span className="text-[var(--app-accent)]">{icon}</span> : null}
          <span>{title}</span>
        </div>
        {description ? <div className="mt-1 text-xs leading-5 text-[var(--app-text-soft)]">{description}</div> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

export function WorkspaceEmptyBlock({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[22px] border border-dashed border-[var(--app-border-soft)] bg-[var(--app-raised)] px-5 py-8 text-center',
        className,
      )}
    >
      {icon ? <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-accent)]">{icon}</div> : null}
      <div className="text-sm font-semibold text-[var(--app-text)]">{title}</div>
      {description ? <div className="mt-1 text-xs leading-5 text-[var(--app-text-soft)]">{description}</div> : null}
      {children}
    </div>
  );
}

export function WorkspaceTabsList({
  children,
  className,
  variant = 'pill',
}: {
  children: React.ReactNode;
  className?: string;
  variant?: 'pill' | 'underline';
}) {
  return (
    <TabsList
      className={cn(
        variant === 'pill' && 'w-full rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-1',
        variant === 'underline' && 'h-10 gap-1 rounded-none border-b border-[var(--app-border-soft)] bg-transparent p-0',
        className,
      )}
    >
      {children}
    </TabsList>
  );
}

export function WorkspaceTabsTrigger({
  value,
  children,
  className,
  variant = 'pill',
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
  variant?: 'pill' | 'underline';
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        variant === 'pill' && 'flex-1 rounded-full text-xs text-[var(--app-text-soft)] data-[state=active]:bg-[var(--app-accent-soft)] data-[state=active]:text-[var(--app-accent)]',
        variant === 'underline' && 'h-10 rounded-none border-0 border-b-2 border-transparent px-3 text-xs font-medium text-[var(--app-text-soft)] data-[state=active]:border-[var(--app-accent)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--app-accent)]',
        className,
      )}
    >
      {children}
    </TabsTrigger>
  );
}

export function WorkspaceEditorFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] transition-colors focus-within:border-[var(--app-border-strong)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
