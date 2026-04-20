'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Conversation,
  KnowledgeItem,
  Project,
  Rule,
  Server,
  Skill,
  UserInfo,
  Workflow,
  Workspace,
} from '@/lib/types';
import { useI18n } from '@/components/locale-provider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { buildWorkspaceOptions, isWorkspaceHidden } from '@/lib/workspace-options';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import {
  BookOpen,
  Bot,
  ChevronRight,
  Eye,
  EyeOff,
  FolderKanban,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Loader2,
  MessageSquare,
  Plus,
  Power,
  PowerOff,
  Puzzle,
  ScrollText,
  Server as ServerIcon,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type PrimarySection = 'conversations' | 'projects' | 'knowledge' | 'operations' | 'ceo';

interface SidebarProps {
  activeId: string | null;
  onSelect: (id: string, title: string, targetSection?: PrimarySection) => void;
  onNew: (workspace: string) => void;
  open: boolean;
  onClose: () => void;
  selectedKnowledgeId?: string | null;
  onSelectKnowledge?: (id: string, title: string) => void;
  knowledgeRefreshSignal?: number;
  section: PrimarySection;
  projects?: Project[];
  selectedProjectId?: string | null;
  onSelectProject?: (id: string) => void;
  onOpenOpsAsset?: (type: 'workflows' | 'skills' | 'rules', name: string) => void;
}

function getWorkspaceName(uri: string) {
  if (!uri) return 'Other';
  if (uri.includes('/playground/')) return 'Playground';
  const parts = uri.replace('file://', '').split('/');
  return parts[parts.length - 1] || parts[parts.length - 2] || uri;
}

function RailItem({
  icon,
  title,
  meta,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'group w-full rounded-[20px] border px-4 py-3 text-left transition-all',
        active
          ? 'border-[var(--app-border-strong)] bg-[linear-gradient(135deg,rgba(88,243,212,0.12),rgba(12,20,34,0.9))] shadow-[0_18px_42px_rgba(0,0,0,0.24)]'
          : 'border-white/6 bg-white/[0.025] hover:border-white/10 hover:bg-white/[0.05]',
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 shrink-0 text-[var(--app-text-muted)] group-hover:text-[var(--app-text)]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn('line-clamp-2 text-sm leading-6', active ? 'font-semibold text-white' : 'text-white/88')}>
            {title}
          </div>
          {meta ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-text-soft)]">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">{children}</div>;
}

function SidebarCard({
  title,
  body,
  icon,
  meta,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="rounded-[20px] border border-white/6 bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-white/8 bg-white/[0.04] text-[var(--app-accent)]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white/90">{title}</div>
          <div className="mt-1 text-xs leading-5 text-[var(--app-text-soft)]">{body}</div>
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({
  activeId,
  onSelect,
  onNew,
  open,
  onClose,
  selectedKnowledgeId = null,
  onSelectKnowledge,
  knowledgeRefreshSignal = 0,
  section,
  projects = [],
  selectedProjectId = null,
  onSelectProject,
  onOpenOpsAsset,
}: SidebarProps) {
  const { locale, t } = useI18n();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [selectedWs, setSelectedWs] = useState('');
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchTarget, setLaunchTarget] = useState('');
  const [launchStatus, setLaunchStatus] = useState<'idle' | 'launching' | 'polling' | 'ready' | 'error'>('idle');
  const [launchError, setLaunchError] = useState('');
  const [closingWs, setClosingWs] = useState<string | null>(null);
  const [hiddenWorkspaces, setHiddenWorkspaces] = useState<string[]>([]);
  const [wsCollapsed, setWsCollapsed] = useState<Record<string, boolean>>({});
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState('');
  const [closeLoading, setCloseLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextUser, nextConversations, nextKnowledge, nextSkills, nextWorkflows, nextServers, nextWorkspaces, nextRules, hidden] = await Promise.all([
        api.me(),
        api.conversations(),
        api.knowledge(),
        api.skills(),
        api.workflows(),
        api.servers(),
        api.workspaces(),
        api.rules(),
        fetch('/api/workspaces/close').then(res => res.json()).catch(() => [] as string[]),
      ]);

      setUser(nextUser);
      setConversations(nextConversations);
      setKnowledgeItems(nextKnowledge);
      setSkills(nextSkills);
      setWorkflows(nextWorkflows);
      setServers(nextServers);
      setWorkspaces(nextWorkspaces.workspaces || []);
      setRules(nextRules || []);
      setHiddenWorkspaces(hidden || []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      void load();
    }, 8000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [load, knowledgeRefreshSignal]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const isWsRunning = useCallback((wsUri: string) => {
    if (wsUri === 'playground') return true;
    return servers.some(server => {
      const workspace = server.workspace || '';
      return workspace === wsUri || workspace.includes(wsUri) || wsUri.includes(workspace);
    });
  }, [servers]);

  const handleLaunchWorkspace = async (wsUri: string) => {
    setLaunchStatus('launching');
    setLaunchError('');
    try {
      await api.launchWorkspace(wsUri);
      setLaunchStatus('polling');
      let elapsed = 0;

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        elapsed += 2;
        if (elapsed > 30) {
          if (pollRef.current) clearInterval(pollRef.current);
          setLaunchStatus('error');
          setLaunchError(t('sidebar.launchTimeout'));
          return;
        }

        try {
          const freshServers = await api.servers();
          const found = freshServers.some(server => {
            const workspace = server.workspace || '';
            return workspace === wsUri || workspace.includes(wsUri) || wsUri.includes(workspace);
          });

          if (found) {
            if (pollRef.current) clearInterval(pollRef.current);
            setLaunchStatus('ready');
            void load();
          }
        } catch {
          /* silent */
        }
      }, 2000);
    } catch (error: unknown) {
      setLaunchStatus('error');
      setLaunchError(error instanceof Error ? error.message : t('chat.errorOccurred'));
    }
  };

  const handleCloseWorkspace = useCallback(async (wsUri: string) => {
    setClosingWs(wsUri);
    try {
      await api.closeWorkspace(wsUri);
      void load();
    } finally {
      setClosingWs(null);
    }
  }, [load]);

  const handleUnhideWorkspace = useCallback(async (wsUri: string) => {
    try {
      await fetch('/api/workspaces/close', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: wsUri }),
      });
      void load();
    } catch {
      /* silent */
    }
  }, [load]);

  const handleKillWorkspace = async (wsUri: string) => {
    setCloseLoading(true);
    try {
      await fetch('/api/workspaces/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: wsUri }),
      });
      window.setTimeout(() => {
        void load();
        setCloseLoading(false);
        setCloseDialogOpen(false);
      }, 2000);
    } catch {
      setCloseLoading(false);
    }
  };

  const wsOptions = buildWorkspaceOptions(servers, workspaces, hiddenWorkspaces);
  const visibleWsOptions = wsOptions.filter(option => !option.hidden);
  const preferredWorkspace = visibleWsOptions.find(option => option.running)?.uri || visibleWsOptions[0]?.uri || '';
  const effectiveSelectedWs = visibleWsOptions.some(option => option.uri === selectedWs) ? selectedWs : preferredWorkspace;

  const handleStartConversation = () => {
    if (!effectiveSelectedWs) return;

    if (effectiveSelectedWs === 'playground' || isWsRunning(effectiveSelectedWs)) {
      onNew(effectiveSelectedWs);
      onClose();
      return;
    }

    setLaunchTarget(effectiveSelectedWs);
    setLaunchStatus('idle');
    setLaunchError('');
    setLaunchDialogOpen(true);
  };

  const visibleConversations = conversations
    .filter(conversation => !isWorkspaceHidden(conversation.workspace || '', hiddenWorkspaces))
    .sort((a, b) => b.mtime - a.mtime);

  const convGroups: Record<string, typeof visibleConversations> = {};
  visibleConversations.forEach(conversation => {
    const wsName = getWorkspaceName(conversation.workspace || '');
    if (!convGroups[wsName]) convGroups[wsName] = [];
    convGroups[wsName].push(conversation);
  });

  const sortedGroupNames = Object.keys(convGroups).sort((a, b) => {
    if (a === 'Playground') return 1;
    if (b === 'Playground') return -1;
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return convGroups[b].length - convGroups[a].length;
  });

  const sortedKnowledgeItems = [...knowledgeItems].sort((a, b) => {
    return new Date(b.timestamps.accessed).getTime() - new Date(a.timestamps.accessed).getTime();
  });

  const selectedProject = projects.find(project => project.projectId === selectedProjectId) || null;
  const visibleWorkspaceCount = wsOptions.filter(option => !option.hidden).length;
  const runningWorkspaceCount = wsOptions.filter(option => option.running && !option.hidden).length;

  const sectionMeta: Record<PrimarySection, { eyebrow: string; title: string; description: string }> = {
    ceo: {
      eyebrow: 'Executive',
      title: 'CEO Office',
      description: '管理 CEO 会话历史和高优先级决策入口。',
    },
    projects: {
      eyebrow: 'Company View',
      title: 'OPC Context',
      description: '浏览项目结构和当前项目上下文，不在这里承载主导航。',
    },
    conversations: {
      eyebrow: 'Workspace Threads',
      title: t('shell.chats'),
      description: '选择工作区、创建对话，并按工作区浏览历史线程。',
    },
    knowledge: {
      eyebrow: 'Artifacts',
      title: t('shell.knowledge'),
      description: '浏览知识条目和沉淀结果，快速回到正在查看的条目。',
    },
    operations: {
      eyebrow: 'System Ops',
      title: 'Operations',
      description: '低频资产、工作区状态和系统入口集中到运维上下文里。',
    },
  };

  const currentMeta = sectionMeta[section];
  const ceoHistory = conversations
    .filter(conversation => conversation.workspace === 'file:///Users/darrel/.gemini/antigravity/ceo-workspace')
    .sort((a, b) => b.mtime - a.mtime);

  return (
    <>
      {open ? (
        <div className="fixed inset-x-0 bottom-0 top-16 z-30 bg-black/50 md:hidden" onClick={onClose} />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-16 left-0 z-40 flex h-[calc(100dvh-4rem)] flex-col overflow-hidden border-r border-white/6 bg-[var(--agent-shell)] text-foreground transition-transform duration-300 ease-out md:static md:inset-auto md:h-full md:translate-x-0',
          'w-[88vw] max-w-[360px] md:w-[320px]',
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 agent-stage opacity-80" />
          <div className="absolute inset-0 agent-grid opacity-25" />
          <div className="absolute -left-10 top-24 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(88,243,212,0.14),transparent_70%)] blur-2xl" />
          <div className="absolute bottom-24 right-[-40px] h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(245,183,76,0.12),transparent_72%)] blur-3xl" />
        </div>

        <div className="relative shrink-0 border-b border-white/6 px-4 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11 border border-white/8 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
              <AvatarFallback className="bg-white font-semibold text-slate-950">
                {user?.name?.[0]?.toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold leading-none">{user?.name || t('shell.profileLoading')}</div>
              <div className="mt-1 truncate text-xs text-[var(--agent-text-soft)]">{user?.email || ''}</div>
            </div>
          </div>
        </div>

        <div className="relative shrink-0 border-b border-white/6 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                {currentMeta.eyebrow}
              </div>
              <div className="mt-2 text-lg font-semibold text-white">{currentMeta.title}</div>
              <div className="mt-2 text-xs leading-5 text-[var(--app-text-soft)]">{currentMeta.description}</div>
            </div>
            {section === 'ceo' ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-full hover:bg-white/10"
                aria-label="新建 CEO 对话"
                title="新建 CEO 对话"
                onClick={() => {
                  api.createConversation('file:///Users/darrel/.gemini/antigravity/ceo-workspace')
                    .then(res => {
                      if (res.cascadeId) {
                        onSelect(res.cascadeId, 'CEO Office', 'ceo');
                        onClose();
                      }
                    })
                    .catch((error: unknown) => {
                      window.alert(error instanceof Error ? error.message : '新建 CEO 对话失败');
                    });
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}
          </div>

          {section === 'conversations' ? (
            <div className="mt-4 rounded-[22px] border border-white/6 bg-[linear-gradient(180deg,rgba(18,30,49,0.92),rgba(13,22,36,0.94))] p-4 shadow-[var(--panel-shadow)]">
              <div className="space-y-3">
                <Select value={effectiveSelectedWs} onValueChange={(value) => value && setSelectedWs(value)}>
                  <SelectTrigger className="h-11 rounded-[16px] border-white/8 bg-white/[0.04] text-sm">
                    <SelectValue placeholder={t('sidebar.selectWorkspace')} />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleWsOptions.map(option => (
                      <SelectItem key={option.uri} value={option.uri}>
                        <div className="flex items-center gap-2">
                          <div className={cn('h-2 w-2 rounded-full', option.running ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
                          {option.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="h-11 w-full rounded-[16px] border-0 bg-[linear-gradient(135deg,#58f3d4,#33c2ff)] text-sm font-semibold text-slate-950 shadow-[0_20px_50px_rgba(22,163,200,0.22)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(22,163,200,0.28)]"
                  onClick={handleStartConversation}
                  disabled={!effectiveSelectedWs}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('sidebar.startConversation')}
                </Button>
              </div>
            </div>
          ) : null}

          {section === 'projects' && selectedProject ? (
            <div className="mt-4 rounded-[20px] border border-white/6 bg-white/[0.03] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Current project</div>
              <div className="mt-2 text-sm font-semibold text-white">{selectedProject.name}</div>
              <div className="mt-1 text-xs text-[var(--app-text-soft)]">{selectedProject.goal || 'Project workbench currently in focus.'}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                  {selectedProject.status}
                </Badge>
                {selectedProject.workspace ? (
                  <span className="truncate text-[11px] text-[var(--app-text-muted)]">{getWorkspaceName(selectedProject.workspace)}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-5 p-4">
              {section === 'ceo' ? (
                <div className="space-y-4">
                  <SectionLabel>History</SectionLabel>
                  {ceoHistory.length > 0 ? (
                    <div className="space-y-2">
                      {ceoHistory.map(conversation => (
                        <RailItem
                          key={conversation.id}
                          icon={<MessageSquare className="h-4 w-4" />}
                          title={conversation.title || t('sidebar.untitled')}
                          meta={(
                            <>
                              {conversation.steps > 0 ? <span>{conversation.steps} steps</span> : null}
                              <span>{formatRelativeTime(new Date(conversation.mtime).toISOString(), locale)}</span>
                            </>
                          )}
                          active={activeId === conversation.id}
                          onClick={() => {
                            onSelect(conversation.id, conversation.title || '', 'ceo');
                            onClose();
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                      No history
                    </div>
                  )}
                </div>
              ) : null}

              {section === 'conversations' ? (
                sortedGroupNames.length > 0 ? (
                  <div className="space-y-4">
                    {sortedGroupNames.map(wsName => (
                      <div key={wsName} className="space-y-1.5">
                        <button
                          type="button"
                          className="group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-white/[0.04]"
                          onClick={() => setWsCollapsed(prev => ({ ...prev, [wsName]: !prev[wsName] }))}
                        >
                          <ChevronRight className={cn('h-3 w-3 shrink-0 text-[var(--app-text-muted)] transition-transform', !wsCollapsed[wsName] && 'rotate-90')} />
                          {wsName === 'Playground'
                            ? <Gamepad2 className="h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                            : <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-muted)]" />}
                          <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--app-text-muted)] group-hover:text-[var(--app-text-soft)]">
                            {wsName}
                          </span>
                          <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-1.5 text-[10px] font-mono opacity-60">
                            {convGroups[wsName].length}
                          </Badge>
                        </button>

                        {!wsCollapsed[wsName] ? (
                          <div className="space-y-1 pl-2">
                            {convGroups[wsName].map(conversation => (
                              <RailItem
                                key={conversation.id}
                                icon={conversation.workspace?.includes('/playground/')
                                  ? <Gamepad2 className="h-4 w-4" />
                                  : <MessageSquare className="h-4 w-4" />}
                                title={conversation.title || t('sidebar.untitled')}
                                meta={(
                                  <>
                                    {conversation.steps > 0 ? <span>{conversation.steps} steps</span> : null}
                                    <span>{formatRelativeTime(new Date(conversation.mtime).toISOString(), locale)}</span>
                                  </>
                                )}
                                active={activeId === conversation.id}
                                onClick={() => {
                                  onSelect(conversation.id, conversation.title);
                                  onClose();
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                    {t('sidebar.noConversations')}
                  </div>
                )
              ) : null}

              {section === 'projects' ? (
                <>
                  <SidebarCard
                    title="Workspace coverage"
                    body="当前左栏只提供项目上下文，不再承载主菜单或低频资源入口。"
                    icon={<FolderKanban className="h-4 w-4" />}
                    meta={(
                      <>
                        <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                          {projects.length} projects
                        </Badge>
                        <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                          {visibleWorkspaceCount} workspaces
                        </Badge>
                      </>
                    )}
                  />

                  {projects.length > 0 ? (
                    <div className="space-y-2">
                      <SectionLabel>Project Tree</SectionLabel>
                      {projects
                        .filter(project => !project.parentProjectId)
                        .map(project => {
                          const children = projects.filter(candidate => candidate.parentProjectId === project.projectId);
                          const hasChildren = children.length > 0;
                          const isParentOrChildSelected = selectedProjectId === project.projectId
                            || children.some(candidate => candidate.projectId === selectedProjectId);

                          return (
                            <div key={project.projectId}>
                              <RailItem
                                icon={<FolderKanban className="h-4 w-4" />}
                                title={project.name}
                                meta={(
                                  <>
                                    <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                                      {project.status}
                                    </Badge>
                                    {hasChildren ? <span className="text-violet-400/70">{children.length} branches</span> : null}
                                  </>
                                )}
                                active={selectedProjectId === project.projectId}
                                onClick={() => {
                                  onSelectProject?.(project.projectId);
                                  onClose();
                                }}
                              />

                              {hasChildren && isParentOrChildSelected ? (
                                <div className="ml-6 mt-1 space-y-0.5 border-l border-violet-500/20 pl-3">
                                  {children.map(child => (
                                    <RailItem
                                      key={child.projectId}
                                      icon={<GitBranch className="h-3.5 w-3.5 text-violet-400/60" />}
                                      title={<span className="text-[13px]">{child.name}</span>}
                                      meta={(
                                        <Badge variant="outline" className="h-4 rounded-full border-white/8 bg-white/[0.03] px-1.5 text-[9px]">
                                          {child.status}
                                        </Badge>
                                      )}
                                      active={selectedProjectId === child.projectId}
                                      onClick={() => {
                                        onSelectProject?.(child.projectId);
                                        onClose();
                                      }}
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                      No projects found
                    </div>
                  )}
                </>
              ) : null}

              {section === 'knowledge' ? (
                sortedKnowledgeItems.length > 0 ? (
                  <div className="space-y-2">
                    <SectionLabel>Entries</SectionLabel>
                    {sortedKnowledgeItems.map(item => (
                      <RailItem
                        key={item.id}
                        icon={<BookOpen className="h-4 w-4" />}
                        title={item.title}
                        meta={(
                          <>
                            <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                              {item.artifactFiles.length} {t('knowledge.artifacts')}
                            </Badge>
                            <span>{formatRelativeTime(item.timestamps.accessed, locale)}</span>
                          </>
                        )}
                        active={selectedKnowledgeId === item.id}
                        onClick={() => {
                          onSelectKnowledge?.(item.id, item.title);
                          onClose();
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                    {t('knowledge.noItems')}
                  </div>
                )
              ) : null}

              {section === 'operations' ? (
                <div className="space-y-5">
                  <div className="grid gap-3">
                    <SidebarCard
                      title="Automation & control"
                      body="Scheduler、策略和系统入口留在 Ops 主视图，左栏只展示概览和常用资产。"
                      icon={<Bot className="h-4 w-4" />}
                      meta={(
                        <>
                          <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                            {runningWorkspaceCount} running
                          </Badge>
                          <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                            {visibleWorkspaceCount} visible
                          </Badge>
                        </>
                      )}
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <SidebarCard
                        title={t('sidebar.skills')}
                        body={skills[0]?.name ? `最近技能：${skills[0].name}` : '无可用技能'}
                        icon={<Puzzle className="h-4 w-4" />}
                        meta={<Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">{skills.length}</Badge>}
                      />
                      <SidebarCard
                        title={t('sidebar.flows')}
                        body={workflows[0]?.name ? `最近流程：/${workflows[0].name}` : '无工作流'}
                        icon={<Zap className="h-4 w-4" />}
                        meta={<Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">{workflows.length}</Badge>}
                      />
                      <SidebarCard
                        title={t('sidebar.rules')}
                        body={rules[0]?.name ? `最近规则：${rules[0].name}` : '无规则'}
                        icon={<ScrollText className="h-4 w-4" />}
                        meta={<Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">{rules.length}</Badge>}
                      />
                      <SidebarCard
                        title={t('sidebar.servers')}
                        body={wsOptions[0]?.name ? `最近工作区：${wsOptions[0].name}` : '无工作区'}
                        icon={<ServerIcon className="h-4 w-4" />}
                        meta={<Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">{wsOptions.length}</Badge>}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <SectionLabel>Assets</SectionLabel>
                    {skills.slice(0, 4).map(skill => (
                      <RailItem
                        key={`skill-${skill.name}`}
                        icon={<Puzzle className="h-4 w-4 text-indigo-400" />}
                        title={skill.name}
                        meta={<span className="line-clamp-2">{skill.description}</span>}
                        onClick={() => {
                          onOpenOpsAsset?.('skills', skill.name);
                          onClose();
                        }}
                      />
                    ))}
                    {workflows.slice(0, 4).map(workflow => (
                      <RailItem
                        key={`workflow-${workflow.name}`}
                        icon={<Zap className="h-4 w-4 text-amber-400" />}
                        title={`/${workflow.name}`}
                        meta={<span className="line-clamp-2">{workflow.description}</span>}
                        onClick={() => {
                          onOpenOpsAsset?.('workflows', workflow.name);
                          onClose();
                        }}
                      />
                    ))}
                    {rules.slice(0, 4).map(rule => (
                      <RailItem
                        key={`rule-${rule.path || rule.name}`}
                        icon={<ScrollText className="h-4 w-4 text-emerald-400" />}
                        title={rule.name || rule.path.split('/').pop() || 'Rule'}
                        meta={rule.description ? <span className="line-clamp-2">{rule.description}</span> : undefined}
                        onClick={() => {
                          onOpenOpsAsset?.('rules', rule.name || rule.path.split('/').pop() || 'Rule');
                          onClose();
                        }}
                      />
                    ))}
                    {!skills.length && !workflows.length && !rules.length ? (
                      <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                        Assets move here from the old resources tray.
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <SectionLabel>Workspaces</SectionLabel>
                    {wsOptions.length > 0 ? wsOptions.map(option => (
                      <div key={option.uri} className={cn('group flex items-center gap-2 rounded-xl border border-white/6 bg-white/[0.03] p-2', option.hidden && 'opacity-40')}>
                        <div className={cn('h-2 w-2 shrink-0 rounded-full', option.running ? (option.hidden ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-muted-foreground/30')} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold">{option.name}</div>
                          <div className="truncate text-[10px] text-muted-foreground">{option.uri.replace('file://', '')}</div>
                        </div>
                        {option.hidden ? (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                            onClick={() => handleUnhideWorkspace(option.uri)}
                            title={t('sidebar.showInSidebar')}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        ) : option.running ? (
                          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => handleCloseWorkspace(option.uri)}
                              disabled={closingWs === option.uri}
                              title={t('sidebar.hideFromSidebar')}
                            >
                              {closingWs === option.uri ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                setCloseTarget(option.uri);
                                setCloseDialogOpen(true);
                              }}
                              title={t('sidebar.closeCompletely')}
                            >
                              <PowerOff className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 text-emerald-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-emerald-600"
                            onClick={() => handleLaunchWorkspace(option.uri)}
                            title={t('sidebar.launchWorkspace')}
                          >
                            <Power className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )) : (
                      <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                        {t('sidebar.noWorkspaces')}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>

        <Dialog
          open={launchDialogOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (pollRef.current) clearInterval(pollRef.current);
              setLaunchDialogOpen(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ServerIcon className="h-5 w-5 text-amber-500" />
                {t('sidebar.workspaceNotRunning')}
              </DialogTitle>
              <DialogDescription>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {launchTarget.replace('file://', '').split('/').pop()}
                </span>{' '}
                {t('sidebar.workspaceNotRunningBody', { workspace: launchTarget.replace('file://', '').split('/').pop() || '' })}
              </DialogDescription>
            </DialogHeader>

            <div className="py-2">
              {launchStatus === 'idle' ? <p className="text-sm text-muted-foreground">{t('sidebar.launchBody')}</p> : null}
              {launchStatus === 'launching' ? (
                <div className="flex items-center gap-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  <span>{t('sidebar.openingWorkspace')}</span>
                </div>
              ) : null}
              {launchStatus === 'polling' ? (
                <div className="flex items-center gap-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
                  <span>{t('sidebar.waitingForServer')}</span>
                </div>
              ) : null}
              {launchStatus === 'ready' ? (
                <div className="flex items-center gap-3 text-sm text-emerald-600">
                  <Power className="h-4 w-4" />
                  <span className="font-medium">{t('sidebar.serverReady')}</span>
                </div>
              ) : null}
              {launchStatus === 'error' ? <div className="text-sm text-destructive">{launchError}</div> : null}
            </div>

            <DialogFooter>
              {launchStatus === 'idle' ? (
                <>
                  <Button variant="outline" onClick={() => setLaunchDialogOpen(false)}>{t('common.cancel')}</Button>
                  <Button onClick={() => handleLaunchWorkspace(launchTarget)}>
                    {t('sidebar.openInAntigravity')}
                  </Button>
                </>
              ) : null}
              {launchStatus === 'launching' || launchStatus === 'polling' ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (pollRef.current) clearInterval(pollRef.current);
                    setLaunchDialogOpen(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              ) : null}
              {launchStatus === 'ready' ? (
                <Button
                  onClick={() => {
                    setLaunchDialogOpen(false);
                    onNew(launchTarget);
                    onClose();
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('sidebar.startConversation')}
                </Button>
              ) : null}
              {launchStatus === 'error' ? (
                <>
                  <Button variant="outline" onClick={() => setLaunchDialogOpen(false)}>{t('common.close')}</Button>
                  <Button onClick={() => handleLaunchWorkspace(launchTarget)}>{t('common.retry')}</Button>
                </>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={closeDialogOpen} onOpenChange={(nextOpen) => { if (!nextOpen) setCloseDialogOpen(false); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <PowerOff className="h-5 w-5" />
                {t('sidebar.closeWorkspaceTitle')}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2">
                  <p>{t('sidebar.closeWorkspaceBody', { workspace: closeTarget.replace('file://', '').split('/').pop() || '' })}</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">{t('sidebar.closeWorkspaceWarning')}</p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCloseDialogOpen(false)} disabled={closeLoading}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" onClick={() => handleKillWorkspace(closeTarget)} disabled={closeLoading}>
                {closeLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
                {t('sidebar.closeCompletely')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </aside>
    </>
  );
}
