'use client';

import { useState } from 'react';
import {
  ChevronRight,
  FileCode2,
  Lock,
  Minus,
  Pencil,
  Plus,
  ShieldAlert,
  Timer,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { TemplateGroupDetailFE } from '@/lib/types';
import { EXECUTION_MODE_LABELS } from '@/components/template-constants';
import { WorkflowEditor } from '@/components/template-workflow-editor';

// ---------------------------------------------------------------------------
// GroupCard — display group detail with roles and workflow rules
// ---------------------------------------------------------------------------

export function GroupCard({ groupId, group, onChange, onDelete }: { groupId: string; group: TemplateGroupDetailFE; onChange?: (updates: Partial<TemplateGroupDetailFE>) => void; onDelete?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState(false);

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/[0.03] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <Users className="h-4 w-4 text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-white">{group.title}</span>
          <div className="text-[11px] text-[var(--app-text-muted)] font-mono">{groupId}</div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--app-text-muted)]">
          {group.executionMode && (
            <Badge variant="outline" className="text-[9px]">
              {EXECUTION_MODE_LABELS[group.executionMode] ?? group.executionMode}
            </Badge>
          )}
          <span>{group.roles.length} 角色</span>
          {onDelete && (
            <button
              className="text-red-400/40 hover:text-red-400 transition-colors"
              title="删除 Group"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-3">
          {/* Editable group properties */}
          {onChange && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  onClick={(e) => { e.stopPropagation(); setEditingGroup(!editingGroup); }}
                >
                  <Pencil className="h-3 w-3" />
                  {editingGroup ? '收起编辑' : '编辑 Group 属性'}
                </button>
              </div>

              {editingGroup && (
                <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                  {/* Title */}
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs text-[var(--app-text-soft)] shrink-0">标题</label>
                    <Input
                      value={group.title}
                      onChange={(e) => onChange({ title: e.target.value })}
                      className="h-7 text-xs bg-white/5 max-w-[200px]"
                    />
                  </div>

                  {/* Execution mode */}
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-[var(--app-text-soft)]">执行模式</label>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(EXECUTION_MODE_LABELS).map(([mode, label]) => (
                        <button
                          key={mode}
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[9px] font-medium border transition-colors',
                            group.executionMode === mode
                              ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                              : 'bg-white/5 text-white/30 border-white/8 hover:text-white/60',
                          )}
                          onClick={() => onChange({ executionMode: mode as TemplateGroupDetailFE['executionMode'] })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Review policy */}
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs text-[var(--app-text-soft)] shrink-0">评审策略 ID</label>
                    <Input
                      value={group.reviewPolicyId ?? ''}
                      onChange={(e) => onChange({ reviewPolicyId: e.target.value || undefined })}
                      className="h-7 text-xs bg-white/5 max-w-[200px]"
                      placeholder="无"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {!editingGroup && group.description && (
            <p className="text-xs text-[var(--app-text-soft)]">{group.description}</p>
          )}

          {/* Source contract */}
          {group.sourceContract?.acceptedSourceGroupIds?.length ? (
            <div className="text-[11px] text-[var(--app-text-muted)]">
              <span className="font-semibold">上游依赖:</span> {group.sourceContract.acceptedSourceGroupIds.join(', ')}
              {group.sourceContract.requireReviewOutcome && (
                <span> (需要: {group.sourceContract.requireReviewOutcome.join('/')})</span>
              )}
            </div>
          ) : null}

          {/* Review policy */}
          {group.reviewPolicyId && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--app-text-muted)]">
              <ShieldAlert className="h-3 w-3" />
              评审策略: {group.reviewPolicyId}
            </div>
          )}

          {/* Capabilities */}
          {group.capabilities && Object.entries(group.capabilities).some(([_, v]) => v) && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(group.capabilities).filter(([_, v]) => v).map(([k]) => (
                <Badge key={k} variant="secondary" className="text-[9px]">{k}</Badge>
              ))}
            </div>
          )}

          {/* Roles */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-text-muted)]">角色</div>
            {group.roles.map((role, roleIdx) => (
              <div key={role.id} className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-white">{role.id}</span>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--app-text-muted)]">
                    <span className="flex items-center gap-0.5">
                      <FileCode2 className="h-2.5 w-2.5" />
                      {role.workflow}
                    </span>
                    {onChange ? (
                      <span className="flex items-center gap-0.5">
                        <Timer className="h-2.5 w-2.5" />
                        <Input
                          type="number"
                          min={1}
                          value={Math.round(role.timeoutMs / 60000)}
                          onChange={(e) => {
                            const newRoles = [...group.roles];
                            newRoles[roleIdx] = { ...role, timeoutMs: (parseInt(e.target.value) || 1) * 60000 };
                            onChange({ roles: newRoles });
                          }}
                          className="w-12 h-5 text-[10px] bg-white/5 px-1"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span>min</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5">
                        <Timer className="h-2.5 w-2.5" />
                        {Math.round(role.timeoutMs / 60000)}min
                      </span>
                    )}
                    {onChange ? (
                      <button
                        className={cn(
                          'flex items-center gap-0.5',
                          role.autoApprove ? 'text-emerald-400' : 'text-amber-400',
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          const newRoles = [...group.roles];
                          newRoles[roleIdx] = { ...role, autoApprove: !role.autoApprove };
                          onChange({ roles: newRoles });
                        }}
                      >
                        {role.autoApprove ? <Unlock className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                        {role.autoApprove ? '自动审批' : '人工审批'}
                      </button>
                    ) : role.autoApprove ? (
                      <span className="flex items-center gap-0.5 text-emerald-400">
                        <Unlock className="h-2.5 w-2.5" /> 自动审批
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-amber-400">
                        <Lock className="h-2.5 w-2.5" /> 人工审批
                      </span>
                    )}
                  </div>
                </div>
                {role.workflowContent && role.workflowContent !== role.workflow && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] gap-1 text-indigo-400"
                    onClick={(e) => { e.stopPropagation(); setShowWorkflow(showWorkflow === role.id ? null : role.id); }}
                  >
                    <FileCode2 className="h-3 w-3" />
                    {showWorkflow === role.id ? '收起' : '规则'}
                  </Button>
                )}
                {onChange && (
                  <button
                    className="text-red-400/30 hover:text-red-400 transition-colors shrink-0"
                    title="删除角色"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange({ roles: group.roles.filter((_, ri) => ri !== roleIdx) });
                    }}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            {/* Add role button */}
            {onChange && (
              <button
                className="w-full rounded-lg border border-dashed border-white/8 hover:border-white/15 py-1.5 flex items-center justify-center gap-1.5 text-[10px] text-white/25 hover:text-white/50 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  let newRoleId = 'new-role';
                  let counter = 1;
                  while (group.roles.some(r => r.id === newRoleId)) { newRoleId = `new-role-${counter++}`; }
                  onChange({
                    roles: [
                      ...group.roles,
                      { id: newRoleId, workflow: '/default-workflow', timeoutMs: 600000, autoApprove: false },
                    ],
                  });
                }}
              >
                <Plus className="h-3 w-3" /> 添加角色
              </button>
            )}
          </div>

          {/* Workflow content editor */}
          {showWorkflow && (() => {
            const role = group.roles.find(r => r.id === showWorkflow);
            if (!role?.workflowContent || role.workflowContent === role.workflow) return null;
            return (
              <WorkflowEditor
                roleId={role.id}
                workflow={role.workflow}
                content={role.workflowContent}
                onClose={() => setShowWorkflow(null)}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}
