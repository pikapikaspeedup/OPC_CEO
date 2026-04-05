'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// ---------------------------------------------------------------------------
// WorkflowEditor — editable workflow markdown content
// ---------------------------------------------------------------------------

export function WorkflowEditor({
  roleId,
  workflow,
  content,
  onClose,
}: {
  roleId: string;
  workflow: string;
  content: string;
  onClose: () => void;
}) {
  const [editedContent, setEditedContent] = useState(content);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const hasChanges = editedContent !== content;

  // Extract workflow name from path (e.g. "/dev-worker" → "dev-worker")
  const workflowName = workflow.startsWith('/') ? workflow.slice(1) : workflow;

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.updateWorkflow(workflowName, editedContent);
      setSaveMsg('保存成功');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch {
      setSaveMsg('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-indigo-400">Workflow 规则: {roleId}</span>
        <div className="flex items-center gap-2">
          {saveMsg && (
            <span className={cn('text-[10px]', saveMsg === '保存成功' ? 'text-emerald-400' : 'text-red-400')}>
              {saveMsg}
            </span>
          )}
          {hasChanges && (
            <Button
              variant="outline"
              size="sm"
              className="h-5 text-[10px] gap-1 px-2"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
              保存
            </Button>
          )}
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <Textarea
        value={editedContent}
        onChange={(e) => setEditedContent(e.target.value)}
        className="text-[11px] font-mono leading-relaxed bg-white/[0.03] min-h-[200px] max-h-[400px]"
      />
      <div className="text-[9px] text-[var(--app-text-muted)]">
        文件路径: workflows/{workflowName}.md
      </div>
    </div>
  );
}
