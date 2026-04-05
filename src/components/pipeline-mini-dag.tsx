'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, type GraphNode, type ProjectGraphResponse } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-400',
  running: 'bg-sky-400 animate-pulse',
  waiting: 'bg-white/20',
  failed: 'bg-red-400',
  blocked: 'bg-amber-400',
  skipped: 'bg-white/10',
};

const STATUS_BORDER: Record<string, string> = {
  completed: 'border-emerald-500/30',
  running: 'border-sky-500/30',
  waiting: 'border-white/10',
  failed: 'border-red-500/30',
  blocked: 'border-amber-500/30',
  skipped: 'border-white/5',
};

interface PipelineMiniDAGProps {
  projectId: string;
  className?: string;
}

export default function PipelineMiniDAG({ projectId, className }: PipelineMiniDAGProps) {
  const [graph, setGraph] = useState<ProjectGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.projectGraph(projectId)
      .then(setGraph)
      .catch(() => setGraph(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return <Loader2 className="h-3 w-3 animate-spin text-[var(--app-text-muted)]" />;
  }

  if (!graph || graph.nodes.length === 0) return null;

  // Topological sort for display order
  const ordered = topoSort(graph);

  return (
    <div className={cn('flex items-center gap-0.5 overflow-x-auto', className)}>
      {ordered.map((node, idx) => (
        <div key={node.stageId} className="flex items-center">
          {idx > 0 && <div className="w-2 h-px bg-white/15 flex-shrink-0" />}
          <div
            className={cn(
              'flex-shrink-0 rounded border px-1.5 py-0.5',
              STATUS_BORDER[node.status] || 'border-white/10',
            )}
            title={`${node.stageId} (${node.status})${node.branchCompleted != null ? ` ${node.branchCompleted}/${node.branchTotal}` : ''}`}
          >
            <div className="flex items-center gap-1">
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_COLORS[node.status] || 'bg-white/20')} />
              <span className="text-[9px] text-white/60 max-w-[60px] truncate">
                {node.stageId.length > 8 ? node.stageId.slice(0, 8) : node.stageId}
              </span>
              {node.branchCompleted != null && node.branchTotal != null && (
                <span className="text-[8px] text-white/40">{node.branchCompleted}/{node.branchTotal}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Simple topological sort using edges */
function topoSort(graph: ProjectGraphResponse): GraphNode[] {
  const nodeMap = new Map(graph.nodes.map(n => [n.stageId, n]));
  const inDegree = new Map<string, number>();
  for (const n of graph.nodes) inDegree.set(n.stageId, 0);
  for (const e of graph.edges) {
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: GraphNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) result.push(node);
    for (const e of graph.edges) {
      if (e.from === id) {
        const newDeg = (inDegree.get(e.to) || 1) - 1;
        inDegree.set(e.to, newDeg);
        if (newDeg === 0) queue.push(e.to);
      }
    }
  }

  // Add any remaining nodes (cycles or disconnected)
  for (const n of graph.nodes) {
    if (!result.find(r => r.stageId === n.stageId)) result.push(n);
  }

  return result;
}
