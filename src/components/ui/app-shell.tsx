'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export function AppShell({
  sidebar,
  header,
  children,
}: {
  sidebar: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="apple-reference-shell flex h-dvh flex-col overflow-hidden bg-[var(--app-ink)] text-[var(--app-text)]">
      {header}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebar}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

export function Pane({
  className,
  tone = 'default',
  children,
}: {
  className?: string;
  tone?: 'default' | 'strong' | 'soft';
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-[var(--panel-radius)] border shadow-[var(--panel-shadow)] backdrop-blur-xl',
        tone === 'strong' && 'app-pane-strong',
        tone === 'default' && 'app-pane',
        tone === 'soft' && 'app-pane-soft',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PaneHeader({
  eyebrow,
  title,
  meta,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-4', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="app-eyebrow">{eyebrow}</div>}
        <div className="mt-2 app-heading text-[clamp(1.15rem,1.5vw,1.6rem)] leading-none">{title}</div>
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function StatusChip({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  className?: string;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)]',
    success: 'border-emerald-400/18 bg-emerald-400/10 text-emerald-700',
    warning: 'border-amber-400/18 bg-amber-400/10 text-amber-700',
    danger: 'border-red-400/18 bg-red-400/10 text-red-700',
    info: 'border-sky-400/18 bg-sky-400/10 text-sky-700',
    accent: 'border-transparent bg-[var(--app-accent-soft)] text-[var(--app-text)]',
  };

  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-3 text-[10px] font-semibold uppercase tracking-[0.18em]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-[280px] flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon && <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-accent)]">{icon}</div>}
      <div className="app-heading text-2xl">{title}</div>
      {body && <div className="mt-3 max-w-md text-sm leading-7 text-[var(--app-text-soft)]">{body}</div>}
    </div>
  );
}

export function ToolbarCluster({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)]/90 p-1.5', className)}>
      {children}
    </div>
  );
}

export function ModeTabs({
  value,
  onValueChange,
  tabs,
  className,
  fill = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: Array<{ value: string; label: React.ReactNode; icon?: React.ReactNode }>;
  className?: string;
  fill?: boolean;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)]/92 p-1.5 shadow-[var(--panel-shadow)]',
        className,
      )}
    >
      {tabs.map(tab => {
        const active = tab.value === value;

        return (
          <button
            key={tab.value}
            type="button"
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-all',
              fill && 'flex-1 justify-center',
              active
                ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]'
                : 'text-[var(--app-text-muted)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]',
            )}
            onClick={() => onValueChange(tab.value)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function WorkspaceHeader({
  eyebrow,
  title,
  meta,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="app-eyebrow">{eyebrow}</div>}
        <div className="mt-2 app-heading text-[clamp(1.4rem,2vw,2.1rem)] leading-[1.05]">{title}</div>
        {meta && <div className="mt-4 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export type WorkspaceMetricTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function WorkspaceMetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: WorkspaceMetricTone;
  className?: string;
}) {
  const toneClasses: Record<WorkspaceMetricTone, string> = {
    neutral: 'from-white to-[#f8fbff] text-[var(--app-text)]',
    success: 'from-emerald-400/[0.12] to-white text-[var(--app-text)]',
    warning: 'from-amber-400/[0.12] to-white text-[var(--app-text)]',
    danger: 'from-red-400/[0.12] to-white text-[var(--app-text)]',
    info: 'from-sky-400/[0.12] to-white text-[var(--app-text)]',
    accent: 'from-[var(--app-accent-soft)] to-white text-[var(--app-text)]',
  };

  return (
    <div
      className={cn(
        'rounded-[22px] border border-[var(--app-border-soft)] bg-gradient-to-br p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]',
        toneClasses[tone],
        className,
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</div>
      {detail ? <div className="mt-2 text-xs leading-5 text-[var(--app-text-soft)]">{detail}</div> : null}
    </div>
  );
}

export function WorkspaceHero({
  eyebrow,
  title,
  body,
  meta,
  actions,
  metrics,
  className,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  metrics?: React.ReactNode;
  className?: string;
}) {
  return (
    <Pane tone="strong" className={cn('relative overflow-hidden p-5 md:p-7', className)}>
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[var(--app-accent)]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/4 h-56 w-56 rounded-full bg-[var(--app-signal)]/8 blur-3xl" />
      <div className="relative">
        <WorkspaceHeader
          eyebrow={eyebrow}
          title={title}
          meta={meta}
          actions={actions}
        />
        {body ? <div className="mt-4 max-w-3xl text-sm leading-7 text-[var(--app-text-soft)]">{body}</div> : null}
        {metrics ? <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics}</div> : null}
      </div>
    </Pane>
  );
}

export function InspectorTabs({
  value,
  onValueChange,
  tabs,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: Array<{ value: string; label: React.ReactNode }>;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => next && onValueChange(String(next))} className={className}>
      <TabsList className="h-10 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-1">
        {tabs.map(tab => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="rounded-full px-4 text-[11px] font-semibold uppercase tracking-[0.18em] data-[state=active]:bg-[var(--app-accent-soft)] data-[state=active]:text-[var(--app-text)]"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
