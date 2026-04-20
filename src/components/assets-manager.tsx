'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Workflow, Skill, Rule } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FileText, Wrench, Shield, Plus, Trash2, Edit3, Save, X, ChevronDown, ChevronRight } from 'lucide-react';

interface AssetsManagerProps {
  workflows: Workflow[];
  skills: Skill[];
  rules: Rule[];
  discoveredWorkflows?: Workflow[];
  discoveredSkills?: Skill[];
  discoveredRules?: Rule[];
  onRefresh: () => void;
  requestedTab?: AssetTab;
  requestedItemName?: string | null;
  requestToken?: number;
}

type AssetTab = 'workflows' | 'skills' | 'rules';

interface EditingState {
  type: AssetTab;
  name: string;
  content: string;
  isNew: boolean;
}

export default function AssetsManager({
  workflows,
  skills,
  rules,
  discoveredWorkflows = [],
  discoveredSkills = [],
  discoveredRules = [],
  onRefresh,
  requestedTab,
  requestedItemName = null,
  requestToken = 0,
}: AssetsManagerProps) {
  const [activeTab, setActiveTab] = useState<AssetTab>('workflows');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const tabs: { key: AssetTab; label: string; icon: typeof FileText; count: number }[] = [
    { key: 'workflows', label: 'Workflows', icon: FileText, count: workflows.length + discoveredWorkflows.length },
    { key: 'skills', label: 'Skills', icon: Wrench, count: skills.length + discoveredSkills.length },
    { key: 'rules', label: 'Rules', icon: Shield, count: rules.length + discoveredRules.length },
  ];

  const canonicalByTab = useMemo(() => ({
    workflows: workflows.filter(item => item.source !== 'discovered'),
    skills: skills.filter(item => item.source !== 'discovered'),
    rules: rules.filter(item => item.source !== 'discovered'),
  }), [rules, skills, workflows]);

  const discoveredByTab = useMemo(() => ({
    workflows: discoveredWorkflows,
    skills: discoveredSkills,
    rules: discoveredRules,
  }), [discoveredSkills, discoveredWorkflows, discoveredRules]);

  const getItemKey = (source: 'canonical' | 'discovered', item: { name: string; path?: string }) => {
    return `${source}:${item.path || item.name}`;
  };

  const toggleExpand = (key: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!requestedTab) return;
    setActiveTab(requestedTab);
    if (requestedItemName) {
      const canonicalMatches = canonicalByTab[requestedTab].filter(item => item.name === requestedItemName);
      const discoveredMatches = discoveredByTab[requestedTab].filter(item => item.name === requestedItemName);
      const nextKeys = [...canonicalMatches, ...discoveredMatches].map(item =>
        getItemKey(canonicalMatches.includes(item) ? 'canonical' : 'discovered', item),
      );

      if (nextKeys.length > 0) {
        setExpandedItems((prev) => {
          const next = new Set(prev);
          nextKeys.forEach(key => next.add(key));
          return next;
        });
      }
    }
  }, [canonicalByTab, discoveredByTab, requestedItemName, requestedTab, requestToken]);

  const handleEdit = async (type: AssetTab, name: string) => {
    setError(null);
    try {
      let content = '';
      if (type === 'workflows') {
        const detail = await api.workflowDetail(name);
        content = detail.content || '';
      } else if (type === 'skills') {
        const detail = await api.skillDetail(name);
        content = (detail as Record<string, unknown>).content as string || '';
      } else {
        const detail = await api.ruleDetail(name);
        content = detail.content || '';
      }
      setEditing({ type, name, content, isNew: false });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载资产详情失败');
    }
  };

  const handleImport = async (type: AssetTab, name: string, content?: string) => {
    if (typeof content !== 'string' || !content.trim()) {
      setError('发现结果缺少可导入内容');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (type === 'workflows') {
        await api.updateWorkflow(name, content);
      } else if (type === 'skills') {
        await api.updateSkill(name, content);
      } else {
        await api.updateRule(name, content);
      }
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '导入失败');
    } finally {
      setSaving(false);
    }
  };

  const handleLocate = (type: AssetTab, item: { name: string; path?: string }) => {
    const canonicalMatch = canonicalByTab[type].find(entry => entry.name === item.name);
    const canonicalKey = canonicalMatch ? getItemKey('canonical', canonicalMatch) : null;
    const discoveredKey = getItemKey('discovered', item);
    setActiveTab(type);
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (canonicalKey) next.add(canonicalKey);
      next.add(discoveredKey);
      return next;
    });
  };

  const handleCreate = (type: AssetTab) => {
    setError(null);
    setEditing({ type, name: '', content: '', isNew: true });
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError('名称不能为空');
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(editing.name)) {
      setError('名称只能包含字母、数字、连字符和下划线');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing.type === 'workflows') {
        await api.updateWorkflow(editing.name, editing.content);
      } else if (editing.type === 'skills') {
        await api.updateSkill(editing.name, editing.content);
      } else {
        await api.updateRule(editing.name, editing.content);
      }
      setEditing(null);
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (type: AssetTab, name: string) => {
    if (!confirm(`确定删除 ${name}？`)) return;
    setError(null);
    try {
      if (type === 'workflows') {
        await api.deleteWorkflow(name);
      } else if (type === 'skills') {
        await api.deleteSkill(name);
      } else {
        await api.deleteRule(name);
      }
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const getItems = () => {
    switch (activeTab) {
      case 'workflows': return canonicalByTab.workflows;
      case 'skills': return canonicalByTab.skills;
      case 'rules': return canonicalByTab.rules;
    }
  };

  const items = getItems();
  const discoveredItems = discoveredByTab[activeTab];
  const canonicalItems = canonicalByTab[activeTab];
  const canonicalNames = new Set(canonicalItems.map(item => item.name));
  const canonicalByName = new Map(canonicalItems.map(item => [item.name, item] as const));

  const renderAssetItem = (item: Workflow | Skill | Rule, source: 'canonical' | 'discovered', onPrimaryAction?: () => void) => {
    const key = getItemKey(source, item);
    const isExpanded = expandedItems.has(key);
    const isExecutable = source === 'canonical';
    const hasCanonicalPeer = source === 'discovered' && canonicalNames.has(item.name);

    return (
      <div key={key} className="group">
        <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] transition-colors">
          <button
            onClick={() => toggleExpand(key)}
            className="text-white/30 hover:text-white/60"
          >
            {isExpanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />
            }
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-white/70 truncate">{item.name}</div>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                isExecutable ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300',
              )}>
                {isExecutable ? '可执行' : '仅发现'}
              </span>
              {source === 'discovered' && (
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  hasCanonicalPeer ? 'bg-sky-500/15 text-sky-300' : 'bg-white/10 text-white/45',
                )}>
                  {hasCanonicalPeer ? '已存在 canonical' : '未导入'}
                </span>
              )}
              {item.source && (
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  item.source === 'canonical'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-white/10 text-white/50',
                )}>
                  {item.source}
                </span>
              )}
              {'scope' in item && item.scope && (
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  item.scope === 'global' ? 'bg-amber-500/15 text-amber-400' : 'bg-sky-500/15 text-sky-400',
                )}>
                  {item.scope}
                </span>
              )}
            </div>
            {item.description && (
              <div className="text-xs text-white/30 truncate mt-0.5">{item.description}</div>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {source === 'canonical' ? (
              <>
                <button
                  onClick={() => handleEdit(activeTab, item.name)}
                  className="rounded-md p-1.5 text-white/30 hover:text-blue-300 hover:bg-blue-500/10"
                  title="编辑"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(activeTab, item.name)}
                  className="rounded-md p-1.5 text-white/30 hover:text-red-300 hover:bg-red-500/10"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleImport(activeTab, item.name, 'content' in item ? item.content : undefined)}
                  className="rounded-md px-2 py-1.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/10"
                  title="导入到 canonical"
                >
                  导入
                </button>
                <button
                  onClick={() => handleLocate(activeTab, item)}
                  className="rounded-md px-2 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/10"
                  title={hasCanonicalPeer ? '定位到 canonical 条目' : '定位到发现结果'}
                >
                  定位
                </button>
              </>
            )}
          </div>
        </div>
        {isExpanded && 'content' in item && item.content && (
          <div className="px-12 pb-3">
            <pre className="rounded-lg bg-black/30 border border-white/8 p-3 text-xs text-white/50 font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {item.content}
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderSection = (
    title: string,
    subtitle: string,
    source: 'canonical' | 'discovered',
    sectionItems: (Workflow | Skill | Rule)[],
  ) => {
    const isCanonical = source === 'canonical';
    return (
      <div className="rounded-2xl border border-white/8 bg-black/15">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">{title}</div>
            <div className="mt-1 text-[11px] text-white/35">{subtitle}</div>
          </div>
          <span className={cn(
            'rounded-full px-2.5 py-0.5 text-[10px] font-medium',
            isCanonical ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300',
          )}>
            {isCanonical ? '可执行' : '仅发现'}
          </span>
        </div>
        <div className="divide-y divide-white/5">
          {sectionItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-white/25">
              {isCanonical ? '暂无可执行条目' : '暂无发现结果'}
            </div>
          ) : (
            sectionItems.map((item) => renderAssetItem(item, source))
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
        <h3 className="text-sm font-semibold text-white/80">Assets 管理</h3>
        <button
          onClick={() => handleCreate(activeTab)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新建
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/8">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setEditing(null); }}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors border-b-2',
              activeTab === tab.key
                ? 'border-blue-400 text-blue-300 bg-blue-500/5'
                : 'border-transparent text-white/40 hover:text-white/60',
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-500/15 border border-red-500/20 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Editor */}
      {editing && (
        <div className="border-b border-white/8 bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="名称（字母数字下划线）"
              disabled={!editing.isNew}
              className={cn(
                'flex-1 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-blue-400/50 focus:outline-none',
                !editing.isNew && 'opacity-60 cursor-not-allowed',
              )}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/50 hover:bg-white/15"
            >
              <X className="w-3.5 h-3.5" />
              取消
            </button>
          </div>
          <textarea
            value={editing.content}
            onChange={e => setEditing({ ...editing, content: e.target.value })}
            placeholder="内容（Markdown 格式）..."
            rows={12}
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white/80 font-mono placeholder:text-white/20 focus:border-blue-400/50 focus:outline-none resize-y"
          />
        </div>
      )}

      {/* Item List */}
      <div className="space-y-4 p-4 max-h-[400px] overflow-y-auto">
        {renderSection(
          'Canonical',
          'Gateway 统一真相源，能直接被执行',
          'canonical',
          items,
        )}
        {renderSection(
          'Discovered',
          '来自 IDE 发现结果，仅供对照与导入',
          'discovered',
          discoveredItems,
        )}
      </div>
    </div>
  );
}
