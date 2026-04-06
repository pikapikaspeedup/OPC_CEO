'use client';

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { TemplateNodeFE, TemplateEdgeFE } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const NODE_W = 180;
const NODE_H = 56;
const GAP_X = 80;
const GAP_Y = 40;
const PAD = 32;

// ---------------------------------------------------------------------------
// Node kind → colour
// ---------------------------------------------------------------------------
const KIND_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  stage:       { bg: 'fill-indigo-500/15',  border: 'stroke-indigo-500/40', text: 'text-indigo-300' },
  'fan-out':   { bg: 'fill-violet-500/15',  border: 'stroke-violet-500/40', text: 'text-violet-300' },
  join:        { bg: 'fill-blue-500/15',    border: 'stroke-blue-500/40',   text: 'text-blue-300' },
  gate:        { bg: 'fill-amber-500/15',   border: 'stroke-amber-500/40',  text: 'text-amber-300' },
  switch:      { bg: 'fill-cyan-500/15',    border: 'stroke-cyan-500/40',   text: 'text-cyan-300' },
  'loop-start':{ bg: 'fill-teal-500/15',    border: 'stroke-teal-500/40',   text: 'text-teal-300' },
  'loop-end':  { bg: 'fill-teal-500/15',    border: 'stroke-teal-500/40',   text: 'text-teal-300' },
  'subgraph-ref': { bg: 'fill-pink-500/15', border: 'stroke-pink-500/40',   text: 'text-pink-300' },
};

const KIND_LABEL: Record<string, string> = {
  stage: '阶段', 'fan-out': '分叉', join: '汇合', gate: '审批', switch: '分支',
  'loop-start': '循环始', 'loop-end': '循环终', 'subgraph-ref': '子图',
};

// ---------------------------------------------------------------------------
// Layout: topological layering (Sugiyama-ish)
// ---------------------------------------------------------------------------
interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  order: number;
  node: TemplateNodeFE;
}

function layoutDAG(nodes: TemplateNodeFE[], edges: TemplateEdgeFE[]): { lnodes: LayoutNode[]; width: number; height: number } {
  if (nodes.length === 0) return { lnodes: [], width: 0, height: 0 };

  const inDeg = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) { inDeg.set(n.id, 0); children.set(n.id, []); }
  for (const e of edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    children.get(e.from)?.push(e.to);
  }

  // BFS topological layering
  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDeg) { if (deg === 0) { queue.push(id); layerOf.set(id, 0); } }

  let idx = 0;
  while (idx < queue.length) {
    const cur = queue[idx++];
    const curLayer = layerOf.get(cur)!;
    for (const ch of children.get(cur) ?? []) {
      const newLayer = curLayer + 1;
      layerOf.set(ch, Math.max(layerOf.get(ch) ?? 0, newLayer));
      const remaining = (inDeg.get(ch) ?? 1) - 1;
      inDeg.set(ch, remaining);
      if (remaining === 0) queue.push(ch);
    }
  }

  // Handle any nodes not reached (disconnected or cycles)
  for (const n of nodes) {
    if (!layerOf.has(n.id)) {
      layerOf.set(n.id, 0);
    }
  }

  // Group nodes by layer
  const layers = new Map<number, TemplateNodeFE[]>();
  for (const n of nodes) {
    const l = layerOf.get(n.id) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(n);
  }
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);

  // Position nodes
  const lnodes: LayoutNode[] = [];
  let maxRowWidth = 0;
  for (const layer of sortedLayers) {
    const row = layers.get(layer)!;
    maxRowWidth = Math.max(maxRowWidth, row.length);
  }

  for (const layer of sortedLayers) {
    const row = layers.get(layer)!;
    const totalRowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const maxTotalW = maxRowWidth * NODE_W + (maxRowWidth - 1) * GAP_X;
    const offsetX = (maxTotalW - totalRowW) / 2;

    for (let i = 0; i < row.length; i++) {
      lnodes.push({
        id: row[i].id,
        x: PAD + offsetX + i * (NODE_W + GAP_X),
        y: PAD + layer * (NODE_H + GAP_Y),
        w: NODE_W,
        h: NODE_H,
        layer,
        order: i,
        node: row[i],
      });
    }
  }

  const totalW = PAD * 2 + maxRowWidth * NODE_W + (maxRowWidth - 1) * GAP_X;
  const totalH = PAD * 2 + sortedLayers.length * NODE_H + (sortedLayers.length - 1) * GAP_Y;
  return { lnodes, width: totalW, height: totalH };
}

// ---------------------------------------------------------------------------
// Edge path builder (bezier)
// ---------------------------------------------------------------------------
function edgePath(fromX: number, fromY: number, fromW: number, fromH: number, toX: number, toY: number, toW: number): string {
  const x1 = fromX + fromW / 2;
  const y1 = fromY + fromH;
  const x2 = toX + toW / 2;
  const y2 = toY;
  const cy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface DAGViewProps {
  nodes: TemplateNodeFE[];
  edges: TemplateEdgeFE[];
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  className?: string;
  /** Custom position offsets per node (persisted by parent) */
  nodeOffsets?: Record<string, { dx: number; dy: number }>;
  /** Called when a node has been dragged to a new position */
  onNodeDragEnd?: (nodeId: string, dx: number, dy: number) => void;
}

export function DAGView({ nodes, edges, onNodeClick, selectedNodeId, className, nodeOffsets, onNodeDragEnd }: DAGViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    baseDx: number;
    baseDy: number;
    currentDx: number;
    currentDy: number;
  } | null>(null);

  const { lnodes, width, height } = useMemo(() => layoutDAG(nodes, edges), [nodes, edges]);
  const nodeMap = useMemo(() => new Map(lnodes.map(n => [n.id, n])), [lnodes]);

  const handleNodeClick = useCallback((id: string) => {
    onNodeClick?.(id);
  }, [onNodeClick]);

  // Drag handlers via window-level listeners for smooth tracking
  const handleMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (!onNodeDragEnd) return;
    e.stopPropagation();
    const existing = nodeOffsets?.[nodeId];
    setDrag({
      nodeId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      baseDx: existing?.dx ?? 0,
      baseDy: existing?.dy ?? 0,
      currentDx: existing?.dx ?? 0,
      currentDy: existing?.dy ?? 0,
    });
  }, [onNodeDragEnd, nodeOffsets]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      setDrag(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          currentDx: prev.baseDx + (e.clientX - prev.startMouseX),
          currentDy: prev.baseDy + (e.clientY - prev.startMouseY),
        };
      });
    };
    const onUp = () => {
      setDrag(prev => {
        if (prev && onNodeDragEnd) {
          onNodeDragEnd(prev.nodeId, prev.currentDx, prev.currentDy);
        }
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag?.nodeId, onNodeDragEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Get effective position for a layout node, accounting for drag & persisted offsets */
  const getPos = useCallback((ln: LayoutNode) => {
    if (drag && drag.nodeId === ln.id) {
      return { x: ln.x + drag.currentDx, y: ln.y + drag.currentDy };
    }
    const off = nodeOffsets?.[ln.id];
    if (off) return { x: ln.x + off.dx, y: ln.y + off.dy };
    return { x: ln.x, y: ln.y };
  }, [drag, nodeOffsets]);

  if (nodes.length === 0) {
    return (
      <div className={cn('py-10 text-center text-sm text-[var(--app-text-muted)]', className)}>
        无 DAG 节点
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-auto rounded-xl border border-white/8 bg-white/[0.02]', className)}
    >
      <svg
        width={width}
        height={height}
        className="block"
        style={{ minWidth: width, minHeight: height }}
      >
        {/* Edges */}
        {edges.map((edge) => {
          const fromNode = nodeMap.get(edge.from);
          const toNode = nodeMap.get(edge.to);
          if (!fromNode || !toNode) return null;
          const fromPos = getPos(fromNode);
          const toPos = getPos(toNode);
          const edgeKey = `${edge.from}→${edge.to}`;
          const isHovered = hoveredEdge === edgeKey;
          const isHighlighted = selectedNodeId === edge.from || selectedNodeId === edge.to;
          const d = edgePath(fromPos.x, fromPos.y, fromNode.w, fromNode.h, toPos.x, toPos.y, toNode.w);
          return (
            <g key={edgeKey}>
              <path
                d={d}
                fill="none"
                className={cn(
                  'transition-all duration-200',
                  isHighlighted || isHovered
                    ? 'stroke-indigo-400/70'
                    : 'stroke-white/15',
                )}
                strokeWidth={isHighlighted || isHovered ? 2 : 1.5}
                markerEnd="url(#arrowhead)"
                onMouseEnter={() => setHoveredEdge(edgeKey)}
                onMouseLeave={() => setHoveredEdge(null)}
              />
              {/* Invisible wider path for easier hovering */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                onMouseEnter={() => setHoveredEdge(edgeKey)}
                onMouseLeave={() => setHoveredEdge(null)}
              />
              {/* Conditional label */}
              {edge.condition && (
                <text
                  x={(fromPos.x + fromNode.w / 2 + toPos.x + toNode.w / 2) / 2}
                  y={(fromPos.y + fromNode.h + toPos.y) / 2}
                  textAnchor="middle"
                  className="fill-amber-400/60 text-[9px]"
                  dy={-4}
                >
                  {edge.condition}
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
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" className="fill-white/30" />
          </marker>
        </defs>

        {/* Nodes */}
        {lnodes.map((ln) => {
          const c = KIND_COLORS[ln.node.kind] ?? KIND_COLORS.stage;
          const isSelected = selectedNodeId === ln.id;
          const isDragging = drag?.nodeId === ln.id;
          const pos = getPos(ln);
          return (
            <g
              key={ln.id}
              className={cn('cursor-pointer', isDragging && 'opacity-80')}
              onClick={() => { if (!isDragging) handleNodeClick(ln.id); }}
              onMouseDown={(e) => handleMouseDown(ln.id, e)}
              style={isDragging ? { filter: 'drop-shadow(0 4px 12px rgba(99,102,241,0.3))' } : undefined}
            >
              <rect
                x={pos.x}
                y={pos.y}
                width={ln.w}
                height={ln.h}
                rx={12}
                ry={12}
                className={cn(
                  c.bg,
                  isDragging ? '' : 'transition-all duration-200',
                  isSelected ? 'stroke-indigo-400 stroke-2' : c.border,
                )}
                strokeWidth={isSelected ? 2 : 1}
              />
              {/* Kind badge */}
              <text
                x={pos.x + 10}
                y={pos.y + 16}
                className={cn('text-[9px] font-medium', c.text.replace('text-', 'fill-'))}
              >
                {KIND_LABEL[ln.node.kind] ?? ln.node.kind}
              </text>
              {/* Label / ID */}
              <text
                x={pos.x + 10}
                y={pos.y + 34}
                className="fill-white/90 text-[12px] font-semibold"
              >
                {truncate(ln.node.label ?? ln.node.id, 18)}
              </text>
              {/* Stage ID */}
              <text
                x={pos.x + 10}
                y={pos.y + 48}
                className="fill-white/30 text-[9px] font-mono"
              >
                {truncate(ln.node.id, 20)}
              </text>
              {/* Drag handle indicator (only when drag is enabled) */}
              {onNodeDragEnd && !isDragging && (
                <text
                  x={pos.x + ln.w - 16}
                  y={pos.y + 14}
                  className="fill-white/15 text-[10px] select-none pointer-events-none"
                >
                  ⠿
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
