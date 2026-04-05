'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { ProjectGraphResponse, GraphNode, GraphEdge } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Loader2, GitBranch, ShieldCheck, ArrowRightLeft, RotateCw, Network, Merge } from 'lucide-react';

// ---------------------------------------------------------------------------
// Status colors
// ---------------------------------------------------------------------------

const statusColor: Record<string, string> = {
  completed: 'border-emerald-500 bg-emerald-500/15 text-emerald-400',
  running: 'border-sky-500 bg-sky-500/15 text-sky-400',
  failed: 'border-red-500 bg-red-500/15 text-red-400',
  pending: 'border-white/20 bg-white/[0.03] text-white/50',
  cancelled: 'border-white/15 bg-white/[0.02] text-white/30',
};

const statusDot: Record<string, string> = {
  completed: 'bg-emerald-400',
  running: 'bg-sky-400 animate-pulse',
  failed: 'bg-red-400',
  pending: 'bg-white/30',
  cancelled: 'bg-white/20',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProjectDagViewProps {
  projectId: string;
  onSelectStage?: (stageId: string) => void;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const NODE_W = 180;
const NODE_H = 64;
const GAP_X = 60;
const GAP_Y = 30;
const PAD = 20;

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  col: number;
  row: number;
}

function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): { layoutNodes: LayoutNode[]; width: number; height: number } {
  if (nodes.length === 0) return { layoutNodes: [], width: 0, height: 0 };

  // Build adjacency
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.stageId, 0);
    children.set(n.stageId, []);
  }
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    children.get(e.from)?.push(e.to);
  }

  // Topological layering (Kahn's algorithm)
  const columns = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const col = columns.get(id) ?? 0;
    for (const child of (children.get(id) || [])) {
      columns.set(child, Math.max(columns.get(child) || 0, col + 1));
      inDegree.set(child, (inDegree.get(child) || 0) - 1);
      if (inDegree.get(child) === 0) queue.push(child);
    }
    if (!columns.has(id)) columns.set(id, 0);
  }

  // Group by column
  const colGroups = new Map<number, string[]>();
  for (const [id, col] of columns) {
    if (!colGroups.has(col)) colGroups.set(col, []);
    colGroups.get(col)!.push(id);
  }

  const nodeMap = new Map(nodes.map(n => [n.stageId, n]));
  const layoutNodes: LayoutNode[] = [];

  for (const [col, ids] of colGroups) {
    ids.forEach((id, row) => {
      const node = nodeMap.get(id);
      if (!node) return;
      layoutNodes.push({
        ...node,
        col,
        row,
        x: PAD + col * (NODE_W + GAP_X),
        y: PAD + row * (NODE_H + GAP_Y),
      });
    });
  }

  const maxCol = Math.max(...layoutNodes.map(n => n.col), 0);
  const maxRows = Math.max(...Array.from(colGroups.values()).map(ids => ids.length), 0);

  return {
    layoutNodes,
    width: PAD * 2 + (maxCol + 1) * NODE_W + maxCol * GAP_X,
    height: PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectDagView({ projectId, onSelectStage }: ProjectDagViewProps) {
  const [graph, setGraph] = useState<ProjectGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const g = await api.projectGraph(projectId);
      setGraph(g);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-white/40">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-white/40">
        No graph data available.
      </div>
    );
  }

  const { layoutNodes, width, height } = layoutGraph(graph.nodes, graph.edges);
  const nodePos = new Map(layoutNodes.map(n => [n.stageId, n]));

  const handleNodeClick = (stageId: string) => {
    setSelectedNode(stageId);
    onSelectStage?.(stageId);
  };

  return (
    <div className="overflow-auto rounded-xl border border-white/8 bg-white/[0.015]">
      <svg width={width} height={height} className="block">
        {/* Edges */}
        {graph.edges.map((edge, i) => {
          const from = nodePos.get(edge.from);
          const to = nodePos.get(edge.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <g key={i}>
              <path
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={1.5}
                markerEnd="url(#arrowhead)"
              />
              {edge.label && (
                <text
                  x={mx}
                  y={(y1 + y2) / 2 - 6}
                  textAnchor="middle"
                  className="fill-white/30 text-[9px]"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Arrow marker */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="rgba(255,255,255,0.2)" />
          </marker>
        </defs>

        {/* Nodes */}
        {layoutNodes.map((node) => {
          const isSelected = selectedNode === node.stageId;
          const colors = statusColor[node.status] || statusColor.pending;
          const kind = node.nodeKind || node.stageType || 'stage';
          const KindIcon =
            kind === 'gate' ? ShieldCheck :
            kind === 'switch' ? ArrowRightLeft :
            kind === 'loop-start' || kind === 'loop-end' ? RotateCw :
            kind === 'fan-out' ? GitBranch :
            kind === 'join' ? Merge :
            kind === 'subgraph-ref' ? Network :
            null;
          const kindBorder =
            kind === 'gate' ? 'border-l-amber-400/60' :
            kind === 'switch' ? 'border-l-sky-400/60' :
            kind === 'loop-start' || kind === 'loop-end' ? 'border-l-violet-400/60' :
            kind === 'fan-out' ? 'border-l-purple-400/60' :
            kind === 'join' ? 'border-l-purple-400/60' :
            kind === 'subgraph-ref' ? 'border-l-teal-400/60' :
            '';
          return (
            <g
              key={node.stageId}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => handleNodeClick(node.stageId)}
              className="cursor-pointer"
            >
              <foreignObject width={NODE_W} height={NODE_H}>
                <div
                  className={cn(
                    'h-full rounded-lg border px-3 py-2 transition-all',
                    colors,
                    kindBorder && `border-l-2 ${kindBorder}`,
                    isSelected && 'ring-2 ring-sky-400/50',
                    node.active && 'ring-1 ring-sky-400/30',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {KindIcon ? (
                      <KindIcon className="h-3 w-3 shrink-0 opacity-70" />
                    ) : (
                      <div className={cn('h-2 w-2 rounded-full shrink-0', statusDot[node.status] || statusDot.pending)} />
                    )}
                    <span className="text-xs font-medium truncate">{node.stageId}</span>
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-[10px] opacity-70">
                    <span className="uppercase tracking-wider">{kind}</span>
                    {(kind === 'fan-out' || node.stageType === 'fan-out') && node.branchTotal != null && (
                      <span className="flex items-center gap-0.5">
                        <GitBranch className="h-2.5 w-2.5" />
                        {node.branchCompleted ?? 0}/{node.branchTotal}
                      </span>
                    )}
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
