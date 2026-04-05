import {
  Play,
  Split,
  Merge,
  ShieldCheck,
  GitBranch,
  Repeat,
  Network,
  Workflow,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Node kind metadata for display
// ---------------------------------------------------------------------------

export const NODE_KIND_META: Record<string, { label: string; icon: typeof Workflow; color: string }> = {
  'stage':       { label: '阶段',       icon: Play,         color: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
  'fan-out':     { label: 'Fan-Out',    icon: Split,        color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  'join':        { label: 'Join',       icon: Merge,        color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  'gate':        { label: '审批门',     icon: ShieldCheck,  color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  'switch':      { label: '条件分支',   icon: GitBranch,    color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
  'loop-start':  { label: '循环开始',   icon: Repeat,       color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
  'loop-end':    { label: '循环结束',   icon: Repeat,       color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
  'subgraph-ref':{ label: '子图引用',   icon: Network,      color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
};

export const EXECUTION_MODE_LABELS: Record<string, string> = {
  'legacy-single': '单次执行',
  'review-loop': '审阅循环',
  'delivery-single-pass': '交付单次',
  'orchestration': '编排节点',
};
