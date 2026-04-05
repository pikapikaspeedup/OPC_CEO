'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { Deliverable, PipelineStageProgressFE } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  FileText,
  Code2,
  Database,
  ClipboardCheck,
  Plus,
  CheckCircle2,
  XCircle,
  RotateCw,
  Loader2,
  Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

// ---------------------------------------------------------------------------
// Type icon
// ---------------------------------------------------------------------------

const typeConfig: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  document: { icon: FileText, color: 'text-sky-400 bg-sky-400/10', label: 'Document' },
  code: { icon: Code2, color: 'text-emerald-400 bg-emerald-400/10', label: 'Code' },
  data: { icon: Database, color: 'text-amber-400 bg-amber-400/10', label: 'Data' },
  review: { icon: ClipboardCheck, color: 'text-violet-400 bg-violet-400/10', label: 'Review' },
};

function TypeBadge({ type }: { type: string }) {
  const cfg = typeConfig[type] || typeConfig.document;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function ReviewBadge({ decision }: { decision?: string }) {
  if (!decision) return <span className="text-[10px] text-white/30">Pending</span>;
  const cfg: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
    approved: { color: 'text-emerald-400', icon: CheckCircle2, label: 'Approved' },
    rejected: { color: 'text-red-400', icon: XCircle, label: 'Rejected' },
    revise: { color: 'text-amber-400', icon: RotateCw, label: 'Revise' },
  };
  const c = cfg[decision] || cfg.revise;
  const Icon = c.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium', c.color)}>
      <Icon className="h-3 w-3" />
      {c.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeliverablesPanelProps {
  projectId: string;
  stages?: PipelineStageProgressFE[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DeliverablesPanel({ projectId, stages }: DeliverablesPanelProps) {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    stageId: '',
    type: 'document' as string,
    title: '',
    artifactPath: '',
  });

  const fetchDeliverables = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDeliverables(projectId);
      setDeliverables(data);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDeliverables();
  }, [fetchDeliverables]);

  const handleCreate = async () => {
    if (!form.stageId || !form.title.trim()) return;
    setCreating(true);
    try {
      await api.createDeliverable(projectId, {
        stageId: form.stageId,
        type: form.type,
        title: form.title.trim(),
        ...(form.artifactPath.trim() ? { artifactPath: form.artifactPath.trim() } : {}),
      });
      setCreateOpen(false);
      setForm({ stageId: '', type: 'document', title: '', artifactPath: '' });
      await fetchDeliverables();
    } catch {
      // handled
    } finally {
      setCreating(false);
    }
  };

  // Group deliverables by stage
  const byStage = deliverables.reduce<Record<string, Deliverable[]>>((acc, d) => {
    (acc[d.stageId] ||= []).push(d);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-white/40">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-white/50" />
          <span className="text-xs font-semibold uppercase tracking-widest text-white/50">
            Deliverables · {deliverables.length}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-full text-xs"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {/* Empty state */}
      {deliverables.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-10 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-white/15" />
          <p className="text-sm text-white/40">No deliverables yet</p>
          <p className="mt-1 text-xs text-white/25">Track outputs from pipeline stages</p>
        </div>
      )}

      {/* Deliverables grouped by stage */}
      {Object.entries(byStage).map(([stageId, items]) => {
        const stageDef = stages?.find(s => s.stageId === stageId);
        return (
          <div key={stageId} className="rounded-xl border border-white/8 bg-white/[0.02] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/6 bg-white/[0.02]">
              <span className="text-xs font-medium text-white/60">
                {stageDef?.groupId || stageId}
              </span>
              <span className="text-[10px] text-white/25">{items.length} items</span>
            </div>
            <div className="divide-y divide-white/6">
              {items.map(d => (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white/80 truncate">{d.title}</span>
                      <TypeBadge type={d.type} />
                    </div>
                    {d.artifactPath && (
                      <div className="mt-0.5 text-[11px] text-white/25 truncate font-mono">
                        {d.artifactPath}
                      </div>
                    )}
                  </div>
                  <ReviewBadge decision={d.quality?.reviewDecision} />
                  <span className="text-[10px] text-white/20 tabular-nums shrink-0">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Deliverable</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Stage</label>
              <NativeSelect value={form.stageId} onChange={e => setForm(f => ({ ...f, stageId: e.target.value }))}>
                <option value="" disabled>Select stage</option>
                {(stages || []).map(s => (
                  <option key={s.stageId} value={s.stageId}>
                    {s.groupId} (#{s.stageIndex})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Type</label>
              <NativeSelect value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="document">📄 Document</option>
                <option value="code">💻 Code</option>
                <option value="data">📊 Data</option>
                <option value="review">📋 Review</option>
              </NativeSelect>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Title</label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. API specification document"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Artifact Path (optional)</label>
              <Input
                value={form.artifactPath}
                onChange={e => setForm(f => ({ ...f, artifactPath: e.target.value }))}
                placeholder="e.g. docs/api-spec.md"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !form.stageId || !form.title.trim()}
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
