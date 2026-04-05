'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { AnalyticsData } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  CheckCircle2,
  Sparkles,
  MessageSquare,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string | number;
  subValue?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', color)}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs text-white/50">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
      {subValue && <div className="text-[11px] text-white/30">{subValue}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini bar chart (pure CSS)
// ---------------------------------------------------------------------------

function MiniBarChart({
  data,
  maxBars = 14,
}: {
  data: Array<{ label: string; value: number }>;
  maxBars?: number;
}) {
  const sliced = data.slice(-maxBars);
  const maxVal = Math.max(...sliced.map(d => d.value), 1);

  return (
    <div className="flex items-end gap-1 h-20">
      {sliced.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-gradient-to-t from-sky-500/60 to-sky-400/40 transition-all duration-300"
            style={{ height: `${(d.value / maxVal) * 100}%`, minHeight: d.value > 0 ? 4 : 0 }}
            title={`${d.label}: ${d.value}`}
          />
          <span className="text-[8px] text-white/20 truncate w-full text-center">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Language mapping (gRPC enum → name)
// ---------------------------------------------------------------------------

const LANG_MAP: Record<number, string> = {
  0: 'Unknown', 1: 'Python', 2: 'JavaScript', 3: 'TypeScript',
  4: 'Go', 5: 'Ruby', 6: 'Java', 7: 'C#', 8: 'C++', 9: 'C',
  10: 'PHP', 11: 'Rust', 12: 'Swift', 13: 'Kotlin', 14: 'Dart',
  15: 'Lua', 16: 'R', 17: 'Shell', 18: 'SQL', 19: 'HTML',
  20: 'CSS', 21: 'Markdown', 22: 'JSON', 23: 'YAML', 24: 'TOML',
  25: 'XML', 26: 'Dockerfile', 27: 'Makefile',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AnalyticsDashboardProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalyticsDashboard({ className }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await api.analytics();
      setData(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-16 text-white/40', className)}>
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn('rounded-xl border border-white/8 bg-white/[0.02] p-8 text-center', className)}>
        <BarChart3 className="mx-auto mb-3 h-8 w-8 text-white/15" />
        <p className="text-sm text-white/40">无法加载分析数据</p>
        <Button variant="ghost" size="sm" onClick={fetchData} className="mt-3 gap-1.5 rounded-full">
          <RefreshCw className="h-3 w-3" />
          重试
        </Button>
      </div>
    );
  }

  const accepted = data.completionStatistics?.numCompletionsAccepted ?? 0;
  const generated = data.completionStatistics?.numCompletionsGenerated ?? 0;
  const acceptRate = generated > 0 ? ((accepted / generated) * 100).toFixed(1) : '—';
  const totalChats = (data.chatsByModel || []).reduce((sum, m) => sum + (m.numChats || 0), 0);

  // Daily completions for bar chart
  const dailyData = (data.completionsByDay || []).map(d => ({
    label: d.date ? d.date.slice(5) : '',
    value: d.numCompletionsAccepted ?? 0,
  }));

  // Language distribution
  const langData = (data.completionsByLanguage || [])
    .filter(l => (l.numCompletionsAccepted ?? 0) > 0)
    .sort((a, b) => (b.numCompletionsAccepted ?? 0) - (a.numCompletionsAccepted ?? 0))
    .slice(0, 8);

  const langTotal = langData.reduce((s, l) => s + (l.numCompletionsAccepted ?? 0), 0);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-white/50" />
          <h2 className="text-lg font-bold text-white">Analytics</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchData}
          className="gap-1.5 rounded-full text-white/40 hover:text-white/60"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Sparkles}
          label="Completions Generated"
          value={generated.toLocaleString()}
          color="bg-violet-400/10 text-violet-400"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completions Accepted"
          value={accepted.toLocaleString()}
          subValue={`${acceptRate}% acceptance rate`}
          color="bg-emerald-400/10 text-emerald-400"
        />
        <StatCard
          icon={MessageSquare}
          label="Chat Sessions"
          value={totalChats.toLocaleString()}
          color="bg-sky-400/10 text-sky-400"
        />
        <StatCard
          icon={TrendingUp}
          label="Acceptance Rate"
          value={`${acceptRate}%`}
          color="bg-amber-400/10 text-amber-400"
        />
      </div>

      {/* Daily completions chart */}
      {dailyData.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-white/40">
            Daily Completions Accepted
          </div>
          <MiniBarChart data={dailyData} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Language distribution */}
        {langData.length > 0 && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-white/40">
              By Language
            </div>
            <div className="space-y-2">
              {langData.map((l, i) => {
                const name = LANG_MAP[l.language ?? 0] || `Lang #${l.language}`;
                const count = l.numCompletionsAccepted ?? 0;
                const pct = langTotal > 0 ? (count / langTotal) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-white/60 w-20 truncate">{name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-400/60 to-emerald-400/40"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-white/30 tabular-nums w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Chat by model */}
        {(data.chatsByModel || []).length > 0 && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-white/40">
              Chats by Model
            </div>
            <div className="space-y-2">
              {(data.chatsByModel || [])
                .filter(m => (m.numChats ?? 0) > 0)
                .sort((a, b) => (b.numChats ?? 0) - (a.numChats ?? 0))
                .map((m, i) => {
                  const pct = totalChats > 0 ? ((m.numChats ?? 0) / totalChats) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-white/60 w-24 truncate">{m.model || 'Unknown'}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-400/60 to-sky-400/40"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-white/30 tabular-nums w-8 text-right">{m.numChats}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
