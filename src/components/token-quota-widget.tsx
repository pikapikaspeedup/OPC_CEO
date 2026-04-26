'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Ticket } from 'lucide-react';
import { WorkspaceSectionHeader, WorkspaceSurface } from '@/components/ui/workspace-primitives';

interface TokenQuotaData {
  workspace: string;
  quota: {
    daily: number;
    monthly: number;
    used: { daily: number; monthly: number };
    canRequestMore: boolean;
  };
}

interface TokenQuotaWidgetProps {
  workspaces: Workspace[];
  className?: string;
}

function ProgressBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const unlimited = limit <= 0;
  const pct = unlimited ? 0 : Math.min((used / limit) * 100, 100);
  const isWarning = !unlimited && pct >= 80;
  const isDanger = !unlimited && pct >= 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--app-text-soft)]">{label}</span>
        <span className={cn(
          'font-mono tabular-nums',
          isDanger ? 'text-red-700' : isWarning ? 'text-amber-700' : 'text-[var(--app-text-soft)]'
        )}>
          {used.toLocaleString()} / {unlimited ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--app-raised-2)]">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isDanger
                ? 'bg-gradient-to-r from-red-500/80 to-red-400/60'
                : isWarning
                  ? 'bg-gradient-to-r from-amber-500/60 to-amber-400/40'
                  : 'bg-gradient-to-r from-sky-500/60 to-emerald-400/40',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function TokenQuotaWidget({ workspaces, className }: TokenQuotaWidgetProps) {
  const [quotas, setQuotas] = useState<TokenQuotaData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadQuotas = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled(
        workspaces.map(ws => api.getDepartmentQuota(ws.uri)),
      );
      const data: TokenQuotaData[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') data.push(r.value);
      }
      setQuotas(data);
    } catch {
      setQuotas([]);
    } finally {
      setLoading(false);
    }
  }, [workspaces]);

  useEffect(() => {
    if (workspaces.length > 0) void loadQuotas();
  }, [workspaces, loadQuotas]);

  // If no quotas configured, show compact message
  const hasAnyQuota = quotas.some(q => q.quota.daily > 0 || q.quota.monthly > 0);

  if (loading) return null;
  if (!hasAnyQuota && quotas.length > 0) {
    return (
      <WorkspaceSurface padding="sm" className={className}>
        <WorkspaceSectionHeader
          title="Token 配额"
          icon={<Ticket className="h-4 w-4" />}
        />
        <p className="mt-3 text-xs text-[var(--app-text-muted)]">所有部门均无配额限制</p>
      </WorkspaceSurface>
    );
  }

  return (
    <WorkspaceSurface padding="sm" className={cn('space-y-4', className)}>
      <WorkspaceSectionHeader
        title="Token 配额"
        icon={<Ticket className="h-4 w-4" />}
      />

      {quotas.map(q => {
        const name = q.workspace.split('/').pop() || q.workspace;
        return (
          <div key={q.workspace} className="space-y-2">
            <div className="text-xs font-medium text-[var(--app-text)]">{name}</div>
            <ProgressBar used={q.quota.used.daily} limit={q.quota.daily} label="今日" />
            <ProgressBar used={q.quota.used.monthly} limit={q.quota.monthly} label="本月" />
          </div>
        );
      })}
    </WorkspaceSurface>
  );
}
