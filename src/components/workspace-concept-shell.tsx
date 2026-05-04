'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen,
  BriefcaseBusiness,
  ChevronRight,
  Command,
  Radio,
  Settings2,
  UserRound,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/lib/api';
import type { UserInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

export type WorkspaceConceptSection = 'ceo' | 'projects' | 'knowledge' | 'operations' | 'settings';

type WorkspaceConceptShellProps = {
  activeSection: WorkspaceConceptSection;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  utility?: ReactNode;
  children: ReactNode;
  headerVariant?: 'default' | 'compact';
  className?: string;
  contentClassName?: string;
  onOpenCeo: () => void;
  onOpenProjects: () => void;
  onOpenKnowledge: () => void;
  onOpenOps: () => void;
  onOpenSettings: () => void;
};

const navItems = [
  { key: 'ceo', label: 'CEO Office', icon: UserRound },
  { key: 'projects', label: 'Projects', icon: BriefcaseBusiness },
  { key: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { key: 'operations', label: 'Ops', icon: Radio },
  { key: 'settings', label: 'Settings', icon: Settings2 },
] as const;

function getDisplayName(user: UserInfo | null): string {
  if (user?.name?.trim()) return user.name.trim();
  if (user?.email) return user.email.split('@')[0] || 'CEO';
  return 'CEO';
}

function getCompanyName(user: UserInfo | null): string {
  const domain = user?.email?.split('@')[1];
  if (!domain) return 'AI 未来科技有限公司';
  return domain.split('.')[0]?.toUpperCase() || 'OPC';
}

export default function WorkspaceConceptShell({
  activeSection,
  title,
  subtitle,
  badges,
  actions,
  utility,
  children,
  headerVariant = 'default',
  className,
  contentClassName,
  onOpenCeo,
  onOpenProjects,
  onOpenKnowledge,
  onOpenOps,
  onOpenSettings,
}: WorkspaceConceptShellProps) {
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.me()
      .then((nextUser) => {
        if (!cancelled) setUser(nextUser);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = getDisplayName(user);
  const initials = displayName.slice(0, 1).toUpperCase();
  const companyName = getCompanyName(user);
  const compactHeader = headerVariant === 'compact';
  const handlers = useMemo<Record<WorkspaceConceptSection, () => void>>(() => ({
    ceo: onOpenCeo,
    projects: onOpenProjects,
    knowledge: onOpenKnowledge,
    operations: onOpenOps,
    settings: onOpenSettings,
  }), [onOpenCeo, onOpenKnowledge, onOpenOps, onOpenProjects, onOpenSettings]);

  return (
    <div className={cn('flex h-full min-h-0 bg-[#f3f6fa] text-[#111827]', className)}>
      <aside className="hidden w-[216px] shrink-0 border-r border-[#dfe5ee] bg-[#f4f7fb] px-3 py-6 lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#0b64d8] text-white shadow-[0_14px_28px_rgba(11,100,216,0.2)]">
            <Command className="h-5 w-5" />
          </div>
          <div className="text-[22px] font-semibold tracking-[-0.05em] text-[#0d1b2e]">OPC</div>
        </div>

        <nav className="mt-10 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.key === activeSection;

            return (
              <button
                key={item.key}
                type="button"
                onClick={handlers[item.key]}
                className={cn(
                  'flex h-14 w-full items-center gap-3 rounded-[10px] px-4 text-left text-[15px] font-medium transition-colors',
                  active ? 'bg-[#e6effb] text-[#145fc2]' : 'text-[#1f2937] hover:bg-white',
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2">
          <div className="rounded-[10px] border border-[#dfe5ee] bg-white p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e6effb] text-sm font-semibold text-[#145fc2]">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[#111827]">{displayName}</div>
                <div className="truncate text-[12px] text-[#7c8799]">CEO</div>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-11 w-full items-center justify-between rounded-[10px] border border-[#dfe5ee] bg-white px-3 text-[12px] text-[#566176] hover:bg-[#f9fbff]"
          >
            <span className="truncate">{companyName}</span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className={cn('mx-auto flex min-h-full w-full max-w-[1580px] flex-col gap-5 px-4 py-4 md:px-8 md:py-6', compactHeader && 'gap-3 md:py-5', contentClassName)}>
            <div className={cn('flex flex-col gap-4 xl:flex-row xl:justify-between', compactHeader ? 'xl:items-center' : 'xl:items-start')}>
              <div className="min-w-0">
                <div className={cn('flex flex-wrap items-center gap-3', compactHeader && 'gap-x-4 gap-y-2')}>
                  <h1 className={cn(
                    'font-semibold leading-tight text-[#111827]',
                    compactHeader ? 'text-[24px] tracking-[0]' : 'text-[clamp(1.6rem,2.4vw,2.25rem)] tracking-[-0.06em]',
                  )}>
                    {title}
                  </h1>
                  {compactHeader && subtitle ? (
                    <div className="text-sm font-medium text-[#6b768a]">{subtitle}</div>
                  ) : null}
                  {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
                </div>
                {!compactHeader && subtitle ? <div className="mt-2 max-w-3xl text-[13px] leading-6 text-[#6b768a]">{subtitle}</div> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {actions}
                {utility}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:hidden">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = item.key === activeSection;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={handlers[item.key]}
                    className={cn(
                      'flex min-h-11 items-center justify-center gap-2 rounded-[12px] border px-2 text-[12px] font-medium',
                      active
                        ? 'border-[#b8cff8] bg-[#e6effb] text-[#145fc2]'
                        : 'border-[#dfe5ee] bg-white text-[#344054]',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            {children}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
