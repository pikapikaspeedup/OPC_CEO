'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  AgentRun,
  Conversation,
  KnowledgeItem,
  Rule,
  Server,
  Skill,
  Project,
  UserInfo,
  Workflow,
  Workspace,
} from '@/lib/types';
import { useI18n } from '@/components/locale-provider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { buildWorkspaceOptions, isWorkspaceHidden } from '@/lib/workspace-options';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import { getAgentRunTimeAgo, getAgentRunWorkspaceName, isAgentRunActive } from '@/lib/agent-run-utils';
import {
  BookOpen,
  Bot,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Gamepad2,
  Loader2,
  MessageSquare,
  Plus,
  Power,
  PowerOff,
  Puzzle,
  ScrollText,
  Server as ServerIcon,
  Sparkles,
  FolderKanban,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ModeTabs } from '@/components/ui/app-shell';

type SidebarSection = 'conversations' | 'projects' | 'agents' | 'knowledge';

interface SidebarProps {
  activeId: string | null;
  onSelect: (id: string, title: string) => void;
  onNew: (workspace: string) => void;
  open: boolean;
  onClose: () => void;
  currentModelLabel: string;
  activeRunsCount?: number;
  agentRuns?: AgentRun[];
  selectedAgentRunId?: string | null;
  onSelectAgentRun?: (runId: string) => void;
  selectedKnowledgeId?: string | null;
  onSelectKnowledge?: (id: string, title: string) => void;
  knowledgeRefreshSignal?: number;
  section: SidebarSection;
  onSectionChange?: (section: SidebarSection) => void;
  projects?: Project[];
  selectedProjectId?: string | null;
  onSelectProject?: (id: string) => void;
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

export default function Sidebar({
  activeId,
  onSelect,
  onNew,
  open,
  onClose,
  currentModelLabel,
  activeRunsCount = 0,
  agentRuns = [],
  selectedAgentRunId = null,
  onSelectAgentRun,
  selectedKnowledgeId = null,
  onSelectKnowledge,
  knowledgeRefreshSignal = 0,
  section,
  onSectionChange,
  projects = [],
  selectedProjectId = null,
  onSelectProject,
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
  const [resourcesOpen, setResourcesOpen] = useState(false);
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

  // Group conversations by workspace
  const convGroups: Record<string, typeof visibleConversations> = {};
  visibleConversations.forEach(c => {
    const wsName = getWorkspaceName(c.workspace || '');
    if (!convGroups[wsName]) convGroups[wsName] = [];
    convGroups[wsName].push(c);
  });
  const sortedGroupNames = Object.keys(convGroups).sort((a, b) => {
    if (a === 'Playground') return 1;
    if (b === 'Playground') return -1;
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return convGroups[b].length - convGroups[a].length;
  });
  const activeAgentRuns = agentRuns.filter(run => isAgentRunActive(run.status));
  const recentAgentRuns = agentRuns.filter(run => !isAgentRunActive(run.status));
  const sortedKnowledgeItems = [...knowledgeItems].sort((a, b) => {
    return new Date(b.timestamps.accessed).getTime() - new Date(a.timestamps.accessed).getTime();
  });

  const sectionTitle =
    section === 'agents'
      ? t('shell.agents')
      : section === 'knowledge'
        ? t('shell.knowledge')
        : t('shell.chats');
  const sectionCount =
    section === 'projects'
      ? projects.length
      : section === 'agents'
      ? agentRuns.length
      : section === 'knowledge'
        ? knowledgeItems.length
        : visibleConversations.length;

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onClose} />
      ) : null}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-dvh flex-col overflow-hidden border-r border-white/6 bg-[var(--agent-shell)] text-foreground transition-transform duration-300 ease-out md:static md:translate-x-0',
          'w-[85vw] max-w-[320px] md:relative md:w-[320px]',
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 agent-stage opacity-80" />
          <div className="absolute inset-0 agent-grid opacity-25" />
          <div className="absolute -left-10 top-24 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(88,243,212,0.14),transparent_70%)] blur-2xl" />
          <div className="absolute bottom-24 right-[-40px] h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(245,183,76,0.12),transparent_72%)] blur-3xl" />
        </div>

        <div className="relative flex items-center gap-3 px-4 pb-4 pt-5">
          <Avatar className="h-11 w-11 border border-white/8 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
            <AvatarFallback className="bg-white text-slate-950 font-semibold">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold leading-none">{user?.name || t('shell.profileLoading')}</div>
            <div className="mt-1 truncate text-xs text-[var(--agent-text-soft)]">{user?.email || ''}</div>
          </div>
        </div>

        <Separator className="bg-white/6" />

        <div className="relative space-y-3 px-4 py-4">
          <ModeTabs
            value={section}
            onValueChange={(value) => onSectionChange?.(value as SidebarSection)}
            fill
            className="w-full"
            tabs={[
              { value: 'conversations', label: t('shell.chats'), icon: <MessageSquare className="h-4 w-4" /> },
              { value: 'projects', label: 'Projects', icon: <FolderKanban className="h-4 w-4" /> },
              { value: 'agents', label: t('shell.agents'), icon: <Bot className="h-4 w-4" /> },
              { value: 'knowledge', label: t('shell.knowledge'), icon: <BookOpen className="h-4 w-4" /> },
            ]}
          />


          {section === 'conversations' ? (
            <div className="rounded-[24px] border border-white/6 bg-[linear-gradient(180deg,rgba(18,30,49,0.92),rgba(13,22,36,0.94))] p-4 shadow-[var(--panel-shadow)]">
              <div className="mt-4 space-y-3">
                <Select value={effectiveSelectedWs} onValueChange={(value) => value && setSelectedWs(value)}>
                  <SelectTrigger className="h-12 rounded-[18px] border-white/8 bg-white/[0.04] text-sm">
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
                  className="h-12 w-full rounded-[18px] border-0 bg-[linear-gradient(135deg,#58f3d4,#33c2ff)] text-sm font-semibold text-slate-950 shadow-[0_20px_50px_rgba(22,163,200,0.22)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(22,163,200,0.28)]"
                  onClick={handleStartConversation}
                  disabled={!effectiveSelectedWs}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('sidebar.startConversation')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <Separator className="bg-white/6" />

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-5 p-4">
              {section === 'conversations' ? (
                sortedGroupNames.length > 0 ? (
                  <div className="space-y-4">
                    {sortedGroupNames.map(wsName => (
                      <div key={wsName} className="space-y-1.5">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-white/[0.04] group"
                          onClick={() => setWsCollapsed(p => ({ ...p, [wsName]: !p[wsName] }))}
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

                        {!wsCollapsed[wsName] && (
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
                                    {conversation.steps > 0 && (
                                      <span>{conversation.steps} steps</span>
                                    )}
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
                        )}
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
                projects.length > 0 ? (
                  <div className="space-y-2">
                    {projects.map(project => (
                      <RailItem
                        key={project.projectId}
                        icon={<FolderKanban className="h-4 w-4" />}
                        title={project.name}
                        meta={(
                          <>
                            <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                              {project.status}
                            </Badge>
                            <span>{formatRelativeTime(project.createdAt, locale)}</span>
                          </>
                        )}
                        active={selectedProjectId === project.projectId}
                        onClick={() => {
                          onSelectProject?.(project.projectId);
                          onClose();
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                    No projects found
                  </div>
                )
              ) : null}

              {section === 'agents' ? (
                agentRuns.length > 0 ? (
                  <div className="space-y-5">
                    {activeAgentRuns.length > 0 ? (
                      <div className="space-y-2">
                        <SectionLabel>{t('sidebar.active')}</SectionLabel>
                        {activeAgentRuns.map(run => (
                          <RailItem
                            key={run.runId}
                            icon={<Bot className="h-4 w-4" />}
                            title={run.prompt}
                            meta={(
                              <>
                                <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                                  {getAgentRunWorkspaceName(run.workspace)}
                                </Badge>
                                <span>{getAgentRunTimeAgo(run.createdAt, locale)}</span>
                              </>
                            )}
                            active={selectedAgentRunId === run.runId}
                            onClick={() => {
                              onSelectAgentRun?.(run.runId);
                              onClose();
                            }}
                          />
                        ))}
                      </div>
                    ) : null}

                    {recentAgentRuns.length > 0 ? (
                      <div className="space-y-2">
                        <SectionLabel>{t('sidebar.recent')}</SectionLabel>
                        {recentAgentRuns.map(run => (
                          <RailItem
                            key={run.runId}
                            icon={<Sparkles className="h-4 w-4" />}
                            title={run.prompt}
                            meta={(
                              <>
                                <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-white/[0.04] px-2 text-[10px]">
                                  {getAgentRunWorkspaceName(run.workspace)}
                                </Badge>
                                <span>{getAgentRunTimeAgo(run.createdAt, locale)}</span>
                              </>
                            )}
                            active={selectedAgentRunId === run.runId}
                            onClick={() => {
                              onSelectAgentRun?.(run.runId);
                              onClose();
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                    {t('sidebar.noRunsYet')}
                  </div>
                )
              ) : null}

              {section === 'knowledge' ? (
                sortedKnowledgeItems.length > 0 ? (
                  <div className="space-y-2">
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
            </div>
          </ScrollArea>
        </div>

        <Separator className="bg-white/6" />

        <Collapsible open={resourcesOpen} onOpenChange={setResourcesOpen} className="relative shrink-0">
          <CollapsibleTrigger className="mx-3 mb-3 flex w-[calc(100%-1.5rem)] items-center gap-3 rounded-[22px] border border-white/6 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.05]">
            <div className="min-w-0 flex-1">
              <div className="app-eyebrow">{t('shell.resources')}</div>
              <div className="truncate text-xs text-[var(--agent-text-soft)]">{t('sidebar.resourcesBody')}</div>
            </div>
            <Badge variant="outline" className="h-5 rounded-full border-white/10 bg-black/10 px-1.5 text-[10px]">
              4
            </Badge>
            <ChevronRight className={cn('h-4 w-4 text-[color:var(--agent-text-muted)] transition-transform', resourcesOpen && 'rotate-90')} />
          </CollapsibleTrigger>

          <CollapsibleContent className="mx-3 mb-3 rounded-[24px] border border-white/6 bg-white/[0.02]">
            <div className="p-4">
              <Tabs defaultValue="skills" className="flex w-full flex-col">
                <TabsList className="grid h-10 w-full grid-cols-4 border-white/6 bg-white/[0.03] p-1">
                  <TabsTrigger value="skills" className="text-[10px] font-semibold data-[state=active]:bg-[var(--app-accent-soft)]">
                    {t('sidebar.skills')}
                  </TabsTrigger>
                  <TabsTrigger value="flows" className="text-[10px] font-semibold data-[state=active]:bg-[var(--app-accent-soft)]">
                    {t('sidebar.flows')}
                  </TabsTrigger>
                  <TabsTrigger value="rules" className="text-[10px] font-semibold data-[state=active]:bg-[var(--app-accent-soft)]">
                    {t('sidebar.rules')}
                  </TabsTrigger>
                  <TabsTrigger value="servers" className="text-[10px] font-semibold data-[state=active]:bg-[var(--app-accent-soft)]">
                    {t('sidebar.servers')}
                  </TabsTrigger>
                </TabsList>

                <div className="mt-3 h-[240px] overflow-hidden">
                  <ScrollArea className="h-[240px] pr-3">
                    <TabsContent value="skills" className="m-0 space-y-4">
                      {skills.length > 0 ? skills.map(skill => (
                        <div key={skill.name} className="space-y-1">
                          <div className="flex items-start gap-2">
                            <Puzzle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold">{skill.name}</div>
                              <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{skill.description}</div>
                            </div>
                          </div>
                        </div>
                      )) : <div className="py-8 text-center text-[11px] text-muted-foreground">{t('sidebar.noSkills')}</div>}
                    </TabsContent>

                    <TabsContent value="flows" className="m-0 space-y-4">
                      {workflows.length > 0 ? workflows.map(workflow => (
                        <div key={workflow.name} className="space-y-1">
                          <div className="flex items-start gap-2">
                            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold">/{workflow.name}</div>
                              <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{workflow.description}</div>
                            </div>
                          </div>
                        </div>
                      )) : <div className="py-8 text-center text-[11px] text-muted-foreground">{t('sidebar.noFlows')}</div>}
                    </TabsContent>

                    <TabsContent value="rules" className="m-0 space-y-4">
                      {rules.length > 0 ? rules.map(rule => (
                        <div key={rule.path || rule.name} className="space-y-1">
                          <div className="flex items-start gap-2">
                            <ScrollText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold">{rule.name || rule.path.split('/').pop()}</div>
                              {rule.description ? (
                                <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{rule.description}</div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )) : <div className="py-8 text-center text-[11px] text-muted-foreground">{t('sidebar.noRules')}</div>}
                    </TabsContent>

                    <TabsContent value="servers" className="m-0 space-y-2.5">
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
                              size="icon"
                              className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                              onClick={() => handleUnhideWorkspace(option.uri)}
                              title={t('sidebar.showInSidebar')}
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                          ) : option.running ? (
                            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => handleCloseWorkspace(option.uri)}
                                disabled={closingWs === option.uri}
                                title={t('sidebar.hideFromSidebar')}
                              >
                                {closingWs === option.uri ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive hover:text-destructive"
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
                              size="icon"
                              className="h-6 w-6 shrink-0 text-emerald-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-emerald-600"
                              onClick={() => handleLaunchWorkspace(option.uri)}
                              title={t('sidebar.launchWorkspace')}
                            >
                              <Power className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )) : <div className="py-8 text-center text-[11px] text-muted-foreground">{t('sidebar.noWorkspaces')}</div>}
                    </TabsContent>
                  </ScrollArea>
                </div>
              </Tabs>
            </div>
          </CollapsibleContent>
        </Collapsible>

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
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t('sidebar.openInAntigravity')}
                  </Button>
                </>
              ) : null}
              {(launchStatus === 'launching' || launchStatus === 'polling') ? (
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
