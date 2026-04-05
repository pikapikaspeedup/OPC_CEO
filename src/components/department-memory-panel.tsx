'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import type { Workspace } from '@/lib/types';

// ─── Types ─────────────────────────────────────────────────────────────────

type MemoryCategory = 'knowledge' | 'decisions' | 'patterns';

interface DepartmentMemoryPanelProps {
  workspaces: Workspace[];
  /** Pre-selected workspace URI */
  selectedWorkspace?: string;
}

const CATEGORY_META: Record<MemoryCategory, { icon: string; label: string; desc: string }> = {
  knowledge: { icon: '📚', label: '知识', desc: '项目经验、代码位置、技术栈' },
  decisions: { icon: '🎯', label: '决策', desc: '技术选型、架构决策、方案选择' },
  patterns: { icon: '🔄', label: '模式', desc: '代码模式、最佳实践、常见问题' },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function DepartmentMemoryPanel({
  workspaces,
  selectedWorkspace,
}: DepartmentMemoryPanelProps) {
  const [activeWorkspace, setActiveWorkspace] = useState<string>(selectedWorkspace || workspaces[0]?.uri || '');
  const [memory, setMemory] = useState<Record<MemoryCategory, string>>({ knowledge: '', decisions: '', patterns: '' });
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<MemoryCategory>('knowledge');
  const [addContent, setAddContent] = useState('');
  const [adding, setAdding] = useState(false);

  const loadMemory = useCallback(async (workspace: string) => {
    if (!workspace) return;
    setLoading(true);
    try {
      const result = await api.getDepartmentMemory(workspace);
      if (result.memory) {
        setMemory(result.memory as Record<MemoryCategory, string>);
      }
    } catch {
      setMemory({ knowledge: '', decisions: '', patterns: '' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeWorkspace) {
      void loadMemory(activeWorkspace);
    }
  }, [activeWorkspace, loadMemory]);

  const handleAdd = async () => {
    if (!addContent.trim() || !activeWorkspace) return;
    setAdding(true);
    try {
      await api.addDepartmentMemory(activeWorkspace, activeCategory, addContent.trim());
      setAddContent('');
      await loadMemory(activeWorkspace);
    } catch {
      // silently fail
    } finally {
      setAdding(false);
    }
  };

  const workspaceName = (uri: string) => {
    const ws = workspaces.find(w => w.uri === uri);
    return ws?.name || uri.split('/').pop() || uri;
  };

  const totalEntries = Object.values(memory).reduce((sum, content) => {
    if (!content) return sum;
    return sum + (content.match(/^### /gm)?.length || 0);
  }, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <span>🧠</span> 部门记忆
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Agent 执行任务后自动沉淀的知识、决策和模式
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{totalEntries} 条记录</span>
        </div>
      </div>

      {/* Workspace selector (if multiple) */}
      {workspaces.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {workspaces.map(ws => (
            <button
              key={ws.uri}
              type="button"
              onClick={() => setActiveWorkspace(ws.uri)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-all cursor-pointer ${
                activeWorkspace === ws.uri
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40'
              }`}
            >
              {workspaceName(ws.uri)}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          加载中…
        </div>
      ) : (
        <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as MemoryCategory)}>
          <TabsList className="w-full">
            {(Object.entries(CATEGORY_META) as [MemoryCategory, typeof CATEGORY_META[MemoryCategory]][]).map(([key, meta]) => {
              const count = memory[key] ? (memory[key].match(/^### /gm)?.length || 0) : 0;
              return (
                <TabsTrigger key={key} value={key} className="text-xs gap-1.5">
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                  {count > 0 && (
                    <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {(Object.entries(CATEGORY_META) as [MemoryCategory, typeof CATEGORY_META[MemoryCategory]][]).map(([key, meta]) => (
            <TabsContent key={key} value={key} className="space-y-3 pt-3">
              <p className="text-xs text-muted-foreground">{meta.desc}</p>

              {/* Memory entries */}
              <ScrollArea className="max-h-[400px]">
                {memory[key] ? (
                  <div className="space-y-3">
                    {memory[key].split(/\n---\n/).filter(Boolean).map((entry, i) => {
                      const lines = entry.trim().split('\n');
                      const headerLine = lines.find(l => l.startsWith('### '));
                      const header = headerLine?.replace('### ', '') || '';
                      const body = lines.filter(l => !l.startsWith('### ')).join('\n').trim();

                      if (!body) return null;

                      return (
                        <div key={i} className="rounded-lg border border-border/60 p-3 bg-muted/20 space-y-1.5">
                          {header && (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="font-mono">{header}</span>
                            </div>
                          )}
                          <div className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
                            {body}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    暂无{meta.label}记录。Agent 完成任务后会自动沉淀。
                  </div>
                )}
              </ScrollArea>

              {/* Add entry */}
              <div className="space-y-2 border-t border-border/40 pt-3">
                <label className="text-xs font-medium text-muted-foreground">手动添加</label>
                <textarea
                  value={addContent}
                  onChange={(e) => setAddContent(e.target.value)}
                  placeholder={`添加${meta.label}记录…`}
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                />
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={adding || !addContent.trim()}
                  className="text-xs h-8"
                >
                  {adding ? '添加中…' : '添加'}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
