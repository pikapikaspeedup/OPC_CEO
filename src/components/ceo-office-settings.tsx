'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Save, Layers, BarChart3, FolderKanban, Settings } from 'lucide-react';
import { useI18n } from '@/components/locale-provider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import CEODashboard from '@/components/ceo-dashboard';
import TemplateBrowser from '@/components/template-browser';
import type { Workspace, Project, DepartmentConfig, TemplateSummaryFE } from '@/lib/types';

interface CeoOfficeSettingsProps {
  workspaces?: Workspace[];
  projects?: Project[];
  departments?: Map<string, DepartmentConfig>;
  templates?: TemplateSummaryFE[];
  onDepartmentSaved?: (uri: string, config: DepartmentConfig) => void;
  onNavigateToProject?: (projectId: string) => void;
  onOpenScheduler?: () => void;
  onOpenProfileSettings?: () => void;
  onRefresh?: () => void;
}

export default function CeoOfficeSettings({
  workspaces = [],
  projects = [],
  departments = new Map(),
  templates = [],
  onDepartmentSaved,
  onNavigateToProject,
  onOpenScheduler,
  onOpenProfileSettings,
  onRefresh,
}: CeoOfficeSettingsProps) {
  const { t } = useI18n();
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
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[rgba(9,17,27,0.4)] backdrop-blur-3xl">
      <div className="px-6 py-5 border-b border-white/5 flex items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 shadow-inner">
            <span className="text-lg">👔</span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-white/90">CEO 管理中心</h2>
            <p className="text-xs text-white/50">配置 · 模板 · 仪表盘 · 项目</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-3 shrink-0">
          <TabsList className="w-full bg-white/5 border border-white/5">
            <TabsTrigger value="dashboard" className="flex-1 text-xs gap-1">
              <BarChart3 className="h-3 w-3" />
              仪表盘
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex-1 text-xs gap-1">
              <Layers className="h-3 w-3" />
              模板
            </TabsTrigger>
            <TabsTrigger value="projects" className="flex-1 text-xs gap-1">
              <FolderKanban className="h-3 w-3" />
              项目
            </TabsTrigger>
            <TabsTrigger value="config" className="flex-1 text-xs gap-1">
              <Settings className="h-3 w-3" />
              Prompt 资产
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Dashboard Tab ── */}
        <TabsContent value="dashboard" className="flex-1 min-h-0 overflow-hidden data-[state=active]:flex flex-col m-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <CEODashboard
                workspaces={workspaces}
                projects={projects}
                departments={departments}
                onSelectDepartment={() => {}}
                onDepartmentSaved={onDepartmentSaved}
                onRefresh={onRefresh}
                onNavigateToProject={onNavigateToProject}
                onOpenScheduler={onOpenScheduler}
              />
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

        {/* ── Projects Summary Tab ── */}
        <TabsContent value="projects" className="flex-1 min-h-0 overflow-hidden data-[state=active]:flex flex-col m-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* Stats row */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '进行中', count: projectStats.active.length, color: 'text-sky-400', bg: 'bg-sky-400/10', dot: 'bg-sky-400' },
                  { label: '已完成', count: projectStats.completed.length, color: 'text-emerald-400', bg: 'bg-emerald-400/10', dot: 'bg-emerald-400' },
                  { label: '失败', count: projectStats.failed.length, color: 'text-red-400', bg: 'bg-red-400/10', dot: 'bg-red-400' },
                  { label: '暂停', count: projectStats.paused.length, color: 'text-amber-400', bg: 'bg-amber-400/10', dot: 'bg-amber-400' },
                ].map(stat => (
                  <div key={stat.label} className={cn('rounded-lg border border-white/5 p-3 text-center', stat.bg)}>
                    <div className={cn('text-lg font-bold tabular-nums', stat.color)}>{stat.count}</div>
                    <div className="text-[10px] text-white/40 mt-0.5">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Active projects */}
              {projectStats.active.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">进行中的项目</h3>
                  {projectStats.active.map(p => (
                    <button
                      key={p.projectId}
                      className="w-full text-left rounded-xl border border-sky-500/15 bg-sky-500/5 p-3 hover:bg-sky-500/10 transition-colors group"
                      onClick={() => onNavigateToProject?.(p.projectId)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-sky-400 animate-pulse shrink-0" />
                        <span className="text-sm font-medium text-white/80 truncate group-hover:text-white">{p.name}</span>
                      </div>
                      {p.goal && (
                        <p className="text-[11px] text-white/35 mt-1 line-clamp-1 pl-4">{p.goal}</p>
                      )}
                      {p.pipelineState?.stages && (
                        <div className="flex items-center gap-2 mt-2 pl-4">
                          <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-sky-400/60"
                              style={{
                                width: `${((p.pipelineState.stages.filter(s => s.status === 'completed' || s.status === 'skipped').length) / p.pipelineState.stages.length) * 100}%`
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-white/30 tabular-nums shrink-0">
                            {p.pipelineState.stages.filter(s => s.status === 'completed' || s.status === 'skipped').length}/{p.pipelineState.stages.length}
                          </span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Failed projects */}
              {projectStats.failed.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-red-400/60 uppercase tracking-wider">需要关注</h3>
                  {projectStats.failed.map(p => (
                    <button
                      key={p.projectId}
                      className="w-full text-left rounded-xl border border-red-500/15 bg-red-500/5 p-3 hover:bg-red-500/10 transition-colors group"
                      onClick={() => onNavigateToProject?.(p.projectId)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                        <span className="text-sm font-medium text-white/70 truncate group-hover:text-white">{p.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Paused projects */}
              {projectStats.paused.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-amber-400/60 uppercase tracking-wider">暂停中</h3>
                  {projectStats.paused.map(p => (
                    <button
                      key={p.projectId}
                      className="w-full text-left rounded-xl border border-amber-500/15 bg-amber-500/5 p-3 hover:bg-amber-500/10 transition-colors group"
                      onClick={() => onNavigateToProject?.(p.projectId)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                        <span className="text-sm font-medium text-white/70 truncate group-hover:text-white">{p.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {projects.length === 0 && (
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 text-center">
                  <div className="text-2xl mb-2">📋</div>
                  <p className="text-sm text-white/40">暂无项目</p>
                  <p className="text-xs text-white/25 mt-1">通过对话让 CEO 创建和派发项目</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Config Tab (original Persona / Playbook) ── */}
        <TabsContent value="config" className="flex-1 min-h-0 overflow-hidden data-[state=active]:flex flex-col m-0">
          <Tabs defaultValue="identity" className="flex-1 flex flex-col min-h-0">
            <div className="px-4 pt-3 shrink-0 space-y-3">
              <div className="rounded-2xl border border-sky-400/15 bg-sky-400/[0.06] px-4 py-3">
                <div className="text-sm font-semibold text-white">这里是 Prompt 资产，不是结构化 CEO Profile</div>
                <div className="mt-1 text-xs leading-6 text-white/60">
                  Persona / Playbook 继续保留为 prompt 文档编辑；用户偏好、关注重点、风险取向等结构化配置，已经迁到 `Settings &gt; Profile 偏好`。
                </div>
                {onOpenProfileSettings ? (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onOpenProfileSettings}
                      className="border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08] hover:text-white"
                    >
                      打开 Profile 偏好
                    </Button>
                  </div>
                ) : null}
              </div>
              <TabsList className="w-full bg-white/[0.03] border border-white/5">
                <TabsTrigger value="identity" className="flex-1 text-xs">Persona Prompt</TabsTrigger>
                <TabsTrigger value="playbook" className="flex-1 text-xs">Playbook Prompt</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="identity" className="flex-1 min-h-0 flex flex-col p-6 pt-4 data-[state=active]:flex m-0">
              <div className="flex-1 flex flex-col border border-white/10 rounded-xl overflow-hidden bg-black/40 focus-within:border-indigo-500/30 transition-colors">
                <textarea
                  className="flex-1 w-full p-4 bg-transparent text-sm text-white/80 resize-none outline-none font-mono leading-relaxed"
                  value={identity}
                  onChange={e => setIdentity(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="mt-4 flex justify-end shrink-0">
                <Button 
                  size="sm" 
                  className="bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg"
                  onClick={() => handleSave('identity')}
                  disabled={saving || identity === originalIdentity}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Persona
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="playbook" className="flex-1 min-h-0 flex flex-col p-6 pt-4 data-[state=active]:flex m-0">
              <div className="flex-1 flex flex-col border border-white/10 rounded-xl overflow-hidden bg-black/40 focus-within:border-indigo-500/30 transition-colors">
                <textarea
                  className="flex-1 w-full p-4 bg-transparent text-xs text-white/80 resize-none outline-none font-mono leading-relaxed whitespace-pre"
                  value={playbook}
                  onChange={e => setPlaybook(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="mt-4 flex justify-end shrink-0">
                <Button 
                  size="sm" 
                  className="bg-purple-500 hover:bg-purple-600 text-white shadow-lg"
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
