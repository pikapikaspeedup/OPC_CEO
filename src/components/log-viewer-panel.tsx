'use client';

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/components/locale-provider';
import { Play, Pause, Search, RefreshCw, Filter, X, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InspectorTabs, Pane, StatusChip, ToolbarCluster } from '@/components/ui/app-shell';

interface LogViewerPanelProps {
  open: boolean;
  onClose: () => void;
}

interface LogEntry {
  level: number;
  time: number;
  pid: number;
  hostname: string;
  msg: string;
  module?: string;
  err?: unknown;
  [key: string]: unknown;
}

type LogCategory = 'system' | 'conversation' | 'workspace';

const LEVEL_COLORS: Record<number, { label: string; bg: string; text: string }> = {
  10: { label: 'TRACE', bg: 'bg-slate-500/10', text: 'text-slate-500' },
  20: { label: 'DEBUG', bg: 'bg-zinc-500/10', text: 'text-zinc-500' },
  30: { label: 'INFO', bg: 'bg-blue-500/10', text: 'text-blue-500' },
  40: { label: 'WARN', bg: 'bg-amber-500/10', text: 'text-amber-500' },
  50: { label: 'ERROR', bg: 'bg-red-500/10', text: 'text-red-500' },
  60: { label: 'FATAL', bg: 'bg-rose-500/10', text: 'text-rose-500' },
};

function getLevelInfo(level: number) {
  return LEVEL_COLORS[level] || { label: 'UNKNOWN', bg: 'bg-gray-500/10', text: 'text-gray-500' };
}

function extractExtraPayload(log: LogEntry) {
  const omit = ['level', 'time', 'pid', 'hostname', 'msg', 'module', 'v'];
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(log)) {
    if (!omit.includes(k)) {
      extra[k] = log[k];
    }
  }
  return Object.keys(extra).length > 0 ? extra : null;
}

export default function LogViewerPanel({ open, onClose }: LogViewerPanelProps) {
  const { locale, t } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [category, setCategory] = useState<LogCategory>('conversation');
  
  // Filters
  const [minLevel, setMinLevel] = useState<string>('0');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const res = await fetch(`/api/logs?limit=1000&category=${category}`);
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch { /* silent */ }
    if (!isSilent) setLoading(false);
  }, [category]);

  // Initial load or category change
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void fetchLogs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, category, fetchLogs]);

  // Auto refresh
  useEffect(() => {
    if (!open || !autoRefresh) return;
    const t = setInterval(() => {
      fetchLogs(true);
    }, 2000);
    return () => clearInterval(t);
  }, [open, autoRefresh, fetchLogs]);

  if (!open) return null;

  const filteredLogs = logs.filter(l => {
    if (l.level < parseInt(minLevel, 10)) return false;
    if (searchQuery) {
      const qs = searchQuery.toLowerCase();
      const raw = JSON.stringify(l).toLowerCase();
      if (!raw.includes(qs)) return false;
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--app-ink)] font-mono text-[var(--app-text)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--app-border-soft)] bg-[rgba(9,17,27,0.86)] px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-[rgba(9,17,27,0.78)] md:px-5">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
        <Terminal className="hidden h-4 w-4 shrink-0 text-[var(--app-accent)] lg:block" />
        <div className="min-w-0 flex-1">
          <div className="app-eyebrow">{t('logs.title')}</div>
          <div className="truncate text-sm font-semibold text-[var(--app-text)]">
            {t('logs.path', { category })}
          </div>
        </div>

        <ToolbarCluster className="hidden md:inline-flex">
          <InspectorTabs
            value={category}
            onValueChange={(value) => setCategory(value as LogCategory)}
            tabs={[
              { value: 'conversation', label: t('logs.conversation') },
              { value: 'workspace', label: t('logs.workspace') },
              { value: 'system', label: t('logs.system') },
            ]}
          />
        </ToolbarCluster>

        <div className="flex items-center gap-2">
          <div className="relative hidden md:block">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('logs.search')}
              className="h-9 w-52 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] pl-8 pr-3 text-xs placeholder:text-[var(--app-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <Select value={minLevel} onValueChange={(val) => val && setMinLevel(val)}>
            <SelectTrigger className="h-9 w-[124px] rounded-full text-xs">
              <Filter className="h-3 w-3 mr-2" />
              <SelectValue placeholder={t('logs.level')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0" className="text-xs">{t('logs.allLevels')}</SelectItem>
              <SelectItem value="30" className="text-xs text-blue-500">{t('logs.infoUp')}</SelectItem>
              <SelectItem value="40" className="text-xs text-amber-500">{t('logs.warnUp')}</SelectItem>
              <SelectItem value="50" className="text-xs text-red-500">{t('logs.errorUp')}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            className="h-9 rounded-full text-xs font-sans gap-1"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-0.5" />}
            {autoRefresh ? t('logs.auto') : t('logs.paused')}
          </Button>

          <Button variant="outline" size="icon" className="h-9 w-9 rounded-full" onClick={() => fetchLogs()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </header>

      <div className="border-b border-[var(--app-border-soft)] px-3 py-2 md:hidden">
        <div className="mb-2">
          <InspectorTabs
            value={category}
            onValueChange={(value) => setCategory(value as LogCategory)}
            tabs={[
              { value: 'conversation', label: t('logs.conversation') },
              { value: 'workspace', label: t('logs.workspace') },
              { value: 'system', label: t('logs.system') },
            ]}
          />
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('logs.searchPayload')}
            className="h-9 w-full rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] pl-8 pr-3 text-xs placeholder:text-[var(--app-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto bg-[#08121d] p-3 leading-relaxed text-[11px] md:text-xs">
        {filteredLogs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-[var(--app-text-muted)] font-sans">
            <Terminal className="mb-2 h-8 w-8 opacity-20" />
            <p>{t('logs.noLogs')}</p>
          </div>
        ) : (
          <Pane tone="soft" className="overflow-hidden rounded-[20px] border-[var(--app-border-soft)] bg-[rgba(15,23,38,0.88)]">
            <div className="flex items-center gap-2 border-b border-[var(--app-border-soft)] px-4 py-3 font-sans">
              <StatusChip>{filteredLogs.length}</StatusChip>
              <StatusChip>{t(`logs.${category}`)}</StatusChip>
            </div>
            <div className="space-y-0.5 p-2">
              {filteredLogs.map((log, i) => {
                const info = getLevelInfo(log.level);
                const extra = extractExtraPayload(log);
                return (
                  <div key={`${log.time}-${i}`} className="group flex items-start gap-2 rounded-[14px] p-2 transition-colors hover:bg-white/[0.04]">
                    <div className="w-20 shrink-0 overflow-hidden text-ellipsis text-[#6d7f97] md:w-24">
                      {log.time ? new Date(log.time).toLocaleTimeString(locale, { hour12: false, fractionalSecondDigits: 3 }) : '---'}
                    </div>

                    <div className={cn('w-12 shrink-0 rounded px-1 text-center text-[10px] font-bold', info.bg, info.text)}>
                      {info.label}
                    </div>

                    {log.module && (
                      <div className="shrink-0 font-bold text-emerald-400">
                        [{log.module}]
                      </div>
                    )}

                    <div className="flex-1 min-w-0 break-words">
                      <span className={cn('font-medium', log.level >= 50 ? 'text-red-400' : 'text-[#dbe8f5]')}>
                        {log.msg}
                      </span>

                      {extra && (
                        <div className="mt-1 text-[#8ea0b8] opacity-80 transition-opacity group-hover:opacity-100">
                          {JSON.stringify(extra)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Pane>
        )}
      </main>
    </div>
  );
}
