'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Filter, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, type AuditEvent } from '@/lib/api';

const KIND_ICONS: Record<string, string> = {
  'run.start': '▶️',
  'run.complete': '✅',
  'run.failed': '❌',
  'run.timeout': '⏰',
  'project.created': '📁',
  'project.completed': '🎉',
  'approval.submitted': '📋',
  'approval.resolved': '✔️',
  'dispatch': '🚀',
  'intervene': '🔧',
};

export default function AuditLogWidget() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<string>('');

  useEffect(() => {
    api.auditEvents({ limit: 50 })
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const kinds = useMemo(() => {
    const set = new Set(events.map(e => e.kind));
    return Array.from(set).sort();
  }, [events]);

  const filtered = useMemo(() => {
    if (!kindFilter) return events;
    return events.filter(e => e.kind === kindFilter);
  }, [events, kindFilter]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-soft)]">
          <FileText className="h-4 w-4" /> 审计日志
        </h3>
        {kinds.length > 1 && (
          <div className="flex items-center gap-1">
            <Filter className="h-3 w-3 text-[var(--app-text-muted)]" />
            <select
              className="bg-transparent text-xs text-[var(--app-text-muted)] border-none outline-none cursor-pointer"
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value)}
            >
              <option value="">全部</option>
              {kinds.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/[0.03] divide-y divide-white/5 max-h-80 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-[var(--app-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> 加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--app-text-muted)]">暂无审计记录</div>
        ) : (
          filtered.slice(0, 30).map((event, idx) => {
            const time = new Date(event.timestamp);
            const icon = KIND_ICONS[event.kind] || '📝';
            return (
              <div key={`${event.timestamp}-${idx}`} className="px-4 py-2.5 hover:bg-white/[0.03] transition-colors">
                <div className="flex items-start gap-2">
                  <span className="text-sm flex-shrink-0 mt-0.5">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--app-text-soft)] truncate">{event.message}</div>
                    <div className="flex gap-2 mt-0.5 text-[10px] text-[var(--app-text-muted)]">
                      <span className={cn(
                        'rounded-full px-1.5 py-px',
                        event.kind.includes('failed') || event.kind.includes('timeout')
                          ? 'bg-red-500/10 text-red-300'
                          : event.kind.includes('complete') || event.kind.includes('approved')
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-white/5 text-white/50',
                      )}>{event.kind}</span>
                      <span>{time.toLocaleTimeString()}</span>
                      {event.projectId && (
                        <span className="font-mono">{event.projectId.slice(0, 8)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
