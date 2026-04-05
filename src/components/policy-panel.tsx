'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { ResourcePolicyFE, PolicyRuleFE } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Shield,
  Plus,
  Loader2,
  CheckCircle2,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Inline rule editor row
// ---------------------------------------------------------------------------

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: PolicyRuleFE;
  onChange: (r: PolicyRuleFE) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Select value={rule.resource} onValueChange={(v) => onChange({ ...rule, resource: v as PolicyRuleFE['resource'] })}>
        <SelectTrigger className="h-7 w-[130px] text-xs bg-white/5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {['runs', 'branches', 'iterations', 'stages', 'concurrent-runs'].map(r => (
            <SelectItem key={r} value={r}>{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        min={1}
        value={rule.limit}
        onChange={(e) => onChange({ ...rule, limit: Number(e.target.value) || 1 })}
        className="h-7 w-20 text-xs bg-white/5"
      />
      <Select value={rule.action} onValueChange={(v) => onChange({ ...rule, action: v as PolicyRuleFE['action'] })}>
        <SelectTrigger className="h-7 w-[90px] text-xs bg-white/5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {['warn', 'block', 'pause'].map(a => (
            <SelectItem key={a} value={a}>{a}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button onClick={onRemove} className="text-white/30 hover:text-red-400 transition-colors">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PolicyPanel() {
  const [policies, setPolicies] = useState<ResourcePolicyFE[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // New policy form state
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<ResourcePolicyFE['scope']>('workspace');
  const [newTargetId, setNewTargetId] = useState('');
  const [newRules, setNewRules] = useState<PolicyRuleFE[]>([
    { resource: 'runs', limit: 10, action: 'warn' },
  ]);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listPolicies();
      setPolicies(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.createPolicy({
        name: newName.trim(),
        scope: newScope,
        targetId: newTargetId.trim() || '*',
        rules: newRules,
        enabled: true,
      });
      setNewName('');
      setNewTargetId('');
      setNewRules([{ resource: 'runs', limit: 10, action: 'warn' }]);
      setShowCreate(false);
      await fetchPolicies();
    } catch {
      // handled
    } finally {
      setCreating(false);
    }
  };

  const updateRule = (index: number, rule: PolicyRuleFE) => {
    setNewRules(prev => prev.map((r, i) => (i === index ? rule : r)));
  };

  const removeRule = (index: number) => {
    setNewRules(prev => prev.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-white/30">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-emerald-400/70" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-text-muted)]">
            Resource Policies
          </span>
          <span className="text-[10px] text-white/30">({policies.length})</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
          className="h-6 text-[10px] px-2"
        >
          <Plus className="h-3 w-3 mr-0.5" />
          Add
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.03] p-3 space-y-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Policy name"
            className="h-8 text-xs bg-white/5"
          />
          <div className="flex gap-2">
            <Select value={newScope} onValueChange={(v) => setNewScope(v as ResourcePolicyFE['scope'])}>
              <SelectTrigger className="h-8 text-xs bg-white/5 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">workspace</SelectItem>
                <SelectItem value="template">template</SelectItem>
                <SelectItem value="project">project</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={newTargetId}
              onChange={(e) => setNewTargetId(e.target.value)}
              placeholder="Target ID (or *)"
              className="h-8 text-xs bg-white/5 flex-1"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Rules</span>
            {newRules.map((rule, i) => (
              <RuleRow key={i} rule={rule} onChange={(r) => updateRule(i, r)} onRemove={() => removeRule(i)} />
            ))}
            <button
              className="text-[10px] text-sky-400/70 hover:text-sky-400 transition-colors"
              onClick={() => setNewRules([...newRules, { resource: 'runs', limit: 10, action: 'warn' }])}
            >
              + Add rule
            </button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleCreate}
              disabled={creating || !newName.trim() || newRules.length === 0}
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Create
            </Button>
          </div>
        </div>
      )}

      {/* Policy list */}
      {policies.length === 0 && !showCreate ? (
        <p className="text-xs text-white/30 px-1">No policies defined.</p>
      ) : (
        <div className="space-y-2">
          {policies.map((policy) => (
            <PolicyCard key={policy.id} policy={policy} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policy card
// ---------------------------------------------------------------------------

function PolicyCard({ policy }: { policy: ResourcePolicyFE }) {
  const [expanded, setExpanded] = useState(false);

  const scopeColor =
    policy.scope === 'workspace' ? 'text-purple-400 bg-purple-400/10' :
    policy.scope === 'template' ? 'text-sky-400 bg-sky-400/10' :
    'text-amber-400 bg-amber-400/10';

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-white/80 truncate">{policy.name}</span>
          <span className={cn('text-[10px] rounded-full px-2 py-0.5 font-medium', scopeColor)}>
            {policy.scope}
          </span>
          {policy.enabled === false && (
            <span className="text-[10px] text-white/30 italic">disabled</span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-white/30" /> : <ChevronDown className="h-3.5 w-3.5 text-white/30" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-white/5 pt-2">
          <div className="text-[10px] text-white/40">
            Target: <span className="font-mono text-white/50">{policy.targetId}</span>
          </div>
          {policy.rules.map((rule, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px]',
                rule.action === 'block' ? 'bg-red-400/[0.06] text-red-300' :
                rule.action === 'pause' ? 'bg-amber-400/[0.06] text-amber-300' :
                'bg-yellow-400/[0.06] text-yellow-300',
              )}
            >
              <span className="font-mono">{rule.resource}</span>
              <span>
                limit: {rule.limit} · {rule.action}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
