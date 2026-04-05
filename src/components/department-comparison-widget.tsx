'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { Workspace, Project, DepartmentConfig, DailyDigestFE } from '@/lib/types';

interface DepartmentComparisonWidgetProps {
  workspaces: Workspace[];
  projects: Project[];
  departments: Map<string, DepartmentConfig>;
}

interface DeptStat {
  name: string;
  type: string;
  active: number;
  completed: number;
  failed: number;
  total: number;
  completionRate: number;
  tokenUsage?: { totalTokens: number; estimatedCostUsd: number };
}

export default function DepartmentComparisonWidget({ workspaces, projects, departments }: DepartmentComparisonWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const [digestData, setDigestData] = useState<Map<string, DailyDigestFE>>(new Map());

  useEffect(() => {
    if (!expanded) return;
    Promise.all(
      workspaces.map(async ws => {
        try {
          const d = await api.getDailyDigest(ws.uri, undefined, 'week');
          return [ws.uri, d] as const;
        } catch { return null; }
      }),
    ).then(results => {
      const map = new Map<string, DailyDigestFE>();
      for (const r of results) {
        if (r) map.set(r[0], r[1]);
      }
      setDigestData(map);
    });
  }, [expanded, workspaces]);

  const stats: DeptStat[] = workspaces.map(ws => {
    const dept = departments.get(ws.uri);
    const wsProjects = projects.filter(p => p.workspace === ws.uri);
    const active = wsProjects.filter(p => p.status === 'active').length;
    const completed = wsProjects.filter(p => p.status === 'completed').length;
    const failed = wsProjects.filter(p => p.status === 'failed').length;
    const total = wsProjects.length;
    const digest = digestData.get(ws.uri);

    return {
      name: dept?.name || ws.name || ws.uri.split('/').pop() || ws.uri,
      type: dept?.type || 'build',
      active,
      completed,
      failed,
      total,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      tokenUsage: digest?.tokenUsage,
    };
  });

  const maxTotal = Math.max(...stats.map(s => s.total), 1);

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
      <button
        className="flex w-full items-center justify-between text-sm font-semibold text-white/60 hover:text-white/80 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span>📊 部门对比</span>
        <span className="text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_50px_50px_50px_60px_80px] gap-1 text-[10px] text-white/30 px-1">
            <span>部门</span>
            <span className="text-center">活跃</span>
            <span className="text-center">完成</span>
            <span className="text-center">失败</span>
            <span className="text-center">完成率</span>
            <span className="text-right">Token(周)</span>
          </div>

          {/* Rows */}
          {stats.map(stat => (
            <div key={stat.name} className="grid grid-cols-[1fr_50px_50px_50px_60px_80px] gap-1 items-center rounded-lg px-1 py-1.5 hover:bg-white/[0.03] text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-white/80">{stat.name}</span>
                <span className="text-[10px] text-white/30">{stat.type}</span>
              </div>
              <span className="text-center text-sky-400/80 tabular-nums">{stat.active}</span>
              <span className="text-center text-emerald-400/80 tabular-nums">{stat.completed}</span>
              <span className="text-center text-red-400/80 tabular-nums">{stat.failed}</span>
              <div className="flex items-center justify-center gap-1">
                <div className="h-1.5 w-8 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500/60"
                    style={{ width: `${stat.completionRate}%` }}
                  />
                </div>
                <span className="text-[10px] text-white/40 tabular-nums">{stat.completionRate}%</span>
              </div>
              <span className="text-right text-white/50 tabular-nums text-[10px]">
                {stat.tokenUsage
                  ? `${(stat.tokenUsage.totalTokens / 1000).toFixed(0)}k ($${stat.tokenUsage.estimatedCostUsd.toFixed(1)})`
                  : '—'}
              </span>
            </div>
          ))}

          {/* Summary bar */}
          <div className="pt-2 border-t border-white/5 mt-1">
            <div className="flex gap-4 text-[10px] text-white/40">
              <span>总计: {stats.reduce((s, d) => s + d.total, 0)} 项目</span>
              <span>活跃: {stats.reduce((s, d) => s + d.active, 0)}</span>
              <span>完成: {stats.reduce((s, d) => s + d.completed, 0)}</span>
              {digestData.size > 0 && (
                <span className="ml-auto text-amber-400/60">
                  周 Token: {(Array.from(digestData.values()).reduce((s, d) => s + (d.tokenUsage?.totalTokens || 0), 0) / 1000).toFixed(0)}k
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
