'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';

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
        <span className="text-white/50">{label}</span>
        <span className={cn(
          'font-mono tabular-nums',
          isDanger ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-white/60'
        )}>
          {used.toLocaleString()} / {unlimited ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
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
      <div className={cn('rounded-xl border border-white/8 bg-white/[0.02] p-4', className)}>
        <div className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-2">
          🎫 Token 配额
        </div>
        <p className="text-xs text-white/30">所有部门均无配额限制</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-4', className)}>
      <div className="text-xs font-semibold uppercase tracking-widest text-white/40">
        🎫 Token 配额
      </div>

      {quotas.map(q => {
        const name = q.workspace.split('/').pop() || q.workspace;
        return (
          <div key={q.workspace} className="space-y-2">
            <div className="text-xs font-medium text-white/70">{name}</div>
            <ProgressBar used={q.quota.used.daily} limit={q.quota.daily} label="今日" />
            <ProgressBar used={q.quota.used.monthly} limit={q.quota.monthly} label="本月" />
          </div>
        );
      })}
    </div>
  );
}
