'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { FolderKanban, Layers, Loader2, Save, Settings2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import TemplateBrowser from '@/components/template-browser';
import {
  WorkspaceEditorFrame,
  WorkspaceListItem,
  WorkspaceMiniMetric,
  WorkspaceSurface,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from '@/components/ui/workspace-primitives';
import type { Workspace, Project, DepartmentConfig, TemplateSummaryFE } from '@/lib/types';

interface CeoOfficeSettingsProps {
  workspaces?: Workspace[];
  projects?: Project[];
  departments?: Map<string, DepartmentConfig>;
  templates?: TemplateSummaryFE[];
  onNavigateToProject?: (projectId: string) => void;
  onRefresh?: () => void;
}

export default function CeoOfficeSettings({
  projects = [],
  templates = [],
  onNavigateToProject,
  onRefresh,
}: CeoOfficeSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [identity, setIdentity] = useState('');
  const [playbook, setPlaybook] = useState('');
  
  const [originalIdentity, setOriginalIdentity] = useState('');
  const [originalPlaybook, setOriginalPlaybook] = useState('');

  useEffect(() => {
    fetch('/api/ceo/setup')
      .then(res => res.json())
      .then(data => {
        setIdentity(data.identity || '');
        setPlaybook(data.playbook || '');
        setOriginalIdentity(data.identity || '');
        setOriginalPlaybook(data.playbook || '');
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleSave = async (type: 'identity' | 'playbook') => {
    setSaving(true);
    try {
      const payload = type === 'identity' ? { identity } : { playbook };
      await fetch('/api/ceo/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (type === 'identity') setOriginalIdentity(identity);
      if (type === 'playbook') setOriginalPlaybook(playbook);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  // Project summary stats
  const projectStats = useMemo(() => {
    const active = projects.filter(p => p.status === 'active');
    const completed = projects.filter(p => p.status === 'completed');
    const failed = projects.filter(p => p.status === 'failed');
    const paused = projects.filter(p => p.status === 'paused');
    return { active, completed, failed, paused, total: projects.length };
  }, [projects]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--app-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-transparent backdrop-blur-3xl">
      <Tabs defaultValue="projects" className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-4 shrink-0">
          <WorkspaceTabsList>
            <WorkspaceTabsTrigger value="projects" className="gap-1">
              <FolderKanban className="h-3 w-3" />
              项目摘要
            </WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="templates" className="gap-1">
              <Layers className="h-3 w-3" />
              模板
            </WorkspaceTabsTrigger>
            <WorkspaceTabsTrigger value="config" className="gap-1">
              <Settings2 className="h-3 w-3" />
              Prompt 资产
            </WorkspaceTabsTrigger>
          </WorkspaceTabsList>
        </div>

        {/* ── Projects Summary Tab ── */}
        <TabsContent value="projects" className="flex-1 min-h-0 overflow-hidden data-[state=active]:flex flex-col m-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* Stats row */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '进行中', count: projectStats.active.length, tone: 'info' as const },
                  { label: '已完成', count: projectStats.completed.length, tone: 'success' as const },
                  { label: '失败', count: projectStats.failed.length, tone: 'danger' as const },
                  { label: '暂停', count: projectStats.paused.length, tone: 'warning' as const },
                ].map(stat => (
                  <WorkspaceMiniMetric key={stat.label} label={stat.label} value={stat.count} tone={stat.tone} className="text-center" />
                ))}
              </div>

              {/* Active projects */}
              {projectStats.active.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--app-text-muted)]">进行中的项目</h3>
                  {projectStats.active.map(p => (
                    <WorkspaceListItem
                      key={p.projectId}
                      tone="info"
                      onClick={() => onNavigateToProject?.(p.projectId)}
                      title={p.name}
                      description={p.goal}
                      icon={<span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />}
                      meta={p.pipelineState?.stages ? (
                        <div className="flex w-full items-center gap-2">
                          <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--app-border-soft)]">
                            <div
                              className="h-full rounded-full bg-sky-400/60"
                              style={{
                                width: `${((p.pipelineState.stages.filter(s => s.status === 'completed' || s.status === 'skipped').length) / p.pipelineState.stages.length) * 100}%`
                              }}
                            />
                          </div>
                          <span className="shrink-0 text-[10px] tabular-nums text-[var(--app-text-muted)]">
                            {p.pipelineState.stages.filter(s => s.status === 'completed' || s.status === 'skipped').length}/{p.pipelineState.stages.length}
                          </span>
                        </div>
                      ) : null}
                    />
                  ))}
                </div>
              )}

              {/* Failed projects */}
              {projectStats.failed.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-red-600">需要关注</h3>
                  {projectStats.failed.map(p => (
                    <WorkspaceListItem
                      key={p.projectId}
                      tone="danger"
                      onClick={() => onNavigateToProject?.(p.projectId)}
                      title={p.name}
                      icon={<span className="h-2 w-2 rounded-full bg-red-400" />}
                    />
                  ))}
                </div>
              )}

              {/* Paused projects */}
              {projectStats.paused.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700">暂停中</h3>
                  {projectStats.paused.map(p => (
                    <WorkspaceListItem
                      key={p.projectId}
                      tone="warning"
                      onClick={() => onNavigateToProject?.(p.projectId)}
                      title={p.name}
                      icon={<span className="h-2 w-2 rounded-full bg-amber-400" />}
                    />
                  ))}
                </div>
              )}

              {projects.length === 0 && (
                <WorkspaceSurface className="p-6 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-accent)]">
                    <FolderKanban className="h-5 w-5" />
                  </div>
                  <p className="text-sm text-[var(--app-text)]">暂无项目</p>
                  <p className="mt-1 text-xs text-[var(--app-text-soft)]">通过 CEO 指令中心创建和派发项目。</p>
                </WorkspaceSurface>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Templates Tab ── */}
        <TabsContent value="templates" className="flex-1 min-h-0 overflow-hidden data-[state=active]:flex flex-col m-0">
          <ScrollArea className="h-full">
            <div className="p-4 max-w-full overflow-hidden">
              <TemplateBrowser
                templates={templates}
                onRefresh={onRefresh}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Config Tab (original Persona / Playbook) ── */}
        <TabsContent value="config" className="flex-1 min-h-0 overflow-hidden data-[state=active]:flex flex-col m-0">
          <Tabs defaultValue="identity" className="flex-1 flex flex-col min-h-0">
            <div className="px-4 pt-3 shrink-0 space-y-3">
              <WorkspaceTabsList>
                <WorkspaceTabsTrigger value="identity">Persona Prompt</WorkspaceTabsTrigger>
                <WorkspaceTabsTrigger value="playbook">Playbook Prompt</WorkspaceTabsTrigger>
              </WorkspaceTabsList>
            </div>

            <TabsContent value="identity" className="flex-1 min-h-0 flex flex-col p-6 pt-4 data-[state=active]:flex m-0">
              <WorkspaceEditorFrame>
                <textarea
                  className="flex-1 w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-[var(--app-text)] outline-none"
                  value={identity}
                  onChange={e => setIdentity(e.target.value)}
                  spellCheck={false}
                />
              </WorkspaceEditorFrame>
              <div className="mt-4 flex justify-end shrink-0">
                <Button 
                  size="sm" 
                  className="rounded-full bg-[var(--app-accent)] text-white shadow-[0_18px_40px_rgba(47,109,246,0.24)] hover:brightness-105"
                  onClick={() => handleSave('identity')}
                  disabled={saving || identity === originalIdentity}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Persona
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="playbook" className="flex-1 min-h-0 flex flex-col p-6 pt-4 data-[state=active]:flex m-0">
              <WorkspaceEditorFrame>
                <textarea
                  className="flex-1 w-full resize-none whitespace-pre bg-transparent p-4 font-mono text-xs leading-relaxed text-[var(--app-text)] outline-none"
                  value={playbook}
                  onChange={e => setPlaybook(e.target.value)}
                  spellCheck={false}
                />
              </WorkspaceEditorFrame>
              <div className="mt-4 flex justify-end shrink-0">
                <Button 
                  size="sm" 
                  className="rounded-full bg-[var(--app-accent)] text-white shadow-[0_18px_40px_rgba(47,109,246,0.24)] hover:brightness-105"
                  onClick={() => handleSave('playbook')}
                  disabled={saving || playbook === originalPlaybook}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Playbook
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
