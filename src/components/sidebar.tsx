'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  Conversation,
  Project,
  Server,
  UserInfo,
  Workspace,
} from '@/lib/types';
import { useI18n } from '@/components/locale-provider';
import { api } from '@/lib/api';
import { type AppShellSection, getSidebarLoadPlan, getSidebarPollMs } from '@/lib/home-shell';
import { cn } from '@/lib/utils';
import { buildWorkspaceOptions, isWorkspaceHidden } from '@/lib/workspace-options';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import {
  BookOpen,
  ChevronRight,
  FolderKanban,
  FolderOpen,
  Gamepad2,
  Loader2,
  MessageSquare,
  Plus,
  Power,
  Server as ServerIcon,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type PrimarySection = AppShellSection;

interface SidebarProps {
  activeId: string | null;
  onSelect: (id: string, title: string, targetSection?: PrimarySection) => void;
  onNew: (workspace: string) => void;
  onActivateSection?: (section: PrimarySection) => void;
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
  ceoThreadCount?: number;
  ceoActiveRunCount?: number;
  ceoPendingApprovalCount?: number;
  ceoDepartmentSetupValue?: string;
  ceoDepartmentSetupComplete?: boolean;
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
          ? 'border-[var(--app-border-strong)] bg-[linear-gradient(135deg,rgba(47,109,246,0.12),rgba(255,255,255,0.96))] shadow-[0_18px_42px_rgba(28,44,73,0.08)]'
          : 'border-[var(--app-border-soft)] bg-[var(--app-surface)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised)]',
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 shrink-0 text-[var(--app-text-muted)] group-hover:text-[var(--app-text)]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn('line-clamp-2 text-sm leading-6', active ? 'font-semibold text-[var(--app-accent)]' : 'text-[var(--app-text)]')}>
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
  onActivateSection,
  open,
  onClose,
  section,
  projects = [],
  ceoThreadCount = 0,
  ceoActiveRunCount = 0,
  ceoPendingApprovalCount = 0,
  ceoDepartmentSetupValue = '0',
}: SidebarProps) {
  const { locale, t } = useI18n();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWs, setSelectedWs] = useState('');
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchTarget, setLaunchTarget] = useState('');
  const [launchStatus, setLaunchStatus] = useState<'idle' | 'launching' | 'polling' | 'ready' | 'error'>('idle');
  const [launchError, setLaunchError] = useState('');
  const [hiddenWorkspaces, setHiddenWorkspaces] = useState<string[]>([]);
  const [wsCollapsed, setWsCollapsed] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadPlan = useMemo(() => getSidebarLoadPlan(section), [section]);

  const load = useCallback(async () => {
    try {
      const [nextUser, nextConversations, nextServers, nextWorkspaces, hidden] = await Promise.all([
        api.me(),
        loadPlan.conversations ? api.conversations() : Promise.resolve([] as Conversation[]),
        loadPlan.runtimeStatus ? api.servers() : Promise.resolve([] as Server[]),
        loadPlan.runtimeStatus ? api.workspaces() : Promise.resolve({ workspaces: [], playgrounds: [] } as { workspaces: Workspace[]; playgrounds: string[] }),
        loadPlan.runtimeStatus
          ? fetch('/api/workspaces/close').then(res => res.json()).catch(() => [] as string[])
          : Promise.resolve([] as string[]),
      ]);

      setUser(nextUser);
      setConversations(nextConversations);
      setServers(nextServers);
      setWorkspaces(nextWorkspaces.workspaces || []);
      setHiddenWorkspaces(hidden || []);
    } catch {
      /* silent */
    }
  }, [loadPlan]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      void load();
    }, getSidebarPollMs(section));

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [load, section]);

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

  const sectionMeta: Record<PrimarySection, { eyebrow: string; title: string }> = {
    ceo: {
      eyebrow: 'Executive',
      title: 'CEO Office',
    },
    projects: {
      eyebrow: 'Company View',
      title: 'OPC Context',
    },
    conversations: {
      eyebrow: 'Workspace Threads',
      title: t('shell.chats'),
    },
    knowledge: {
      eyebrow: 'Artifacts',
      title: t('shell.knowledge'),
    },
    operations: {
      eyebrow: 'System Ops',
      title: 'Operations',
    },
  };

  const currentMeta = sectionMeta[section];
  const mainNavItems: Array<{ section: PrimarySection; title: string; meta: React.ReactNode; icon: React.ReactNode }> = [
    {
      section: 'ceo',
      title: 'CEO Office',
      meta: <span>{ceoThreadCount} threads · {ceoActiveRunCount} runs</span>,
      icon: <MessageSquare className="h-4 w-4" />,
    },
    {
      section: 'projects',
      title: 'OPC',
      meta: <span>{projects.length} projects</span>,
      icon: <FolderKanban className="h-4 w-4" />,
    },
    {
      section: 'knowledge',
      title: 'Knowledge',
      meta: <span>知识库工作面</span>,
      icon: <BookOpen className="h-4 w-4" />,
    },
    {
      section: 'operations',
      title: 'Ops',
      meta: <span>{ceoPendingApprovalCount} approvals</span>,
      icon: <Zap className="h-4 w-4" />,
    },
  ];

  return (
    <>
      {open ? (
        <div className="fixed inset-x-0 bottom-0 top-16 z-30 bg-[rgba(241,245,251,0.72)] md:hidden" onClick={onClose} />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-16 left-0 z-40 flex h-[calc(100dvh-4rem)] flex-col overflow-hidden border-r border-[var(--app-border-soft)] bg-[var(--agent-shell)] text-foreground transition-transform duration-300 ease-out md:static md:inset-auto md:h-full md:translate-x-0',
          'w-[88vw] max-w-[360px] md:w-[320px]',
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 agent-stage opacity-80" />
          <div className="absolute inset-0 agent-grid opacity-45" />
          <div className="absolute -left-10 top-24 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(47,109,246,0.12),transparent_70%)] blur-2xl" />
          <div className="absolute bottom-24 right-[-40px] h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(46,183,141,0.1),transparent_72%)] blur-3xl" />
        </div>

        <div className="relative shrink-0 border-b border-[var(--app-border-soft)] px-5 pb-4 pt-6">
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11 border border-[var(--app-border-soft)] shadow-[0_10px_30px_rgba(28,44,73,0.08)]">
              <AvatarFallback className="bg-[var(--app-surface)] font-semibold text-[var(--app-accent)]">
                {user?.name?.[0]?.toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold leading-none">{user?.name || t('shell.profileLoading')}</div>
              <div className="mt-1 truncate text-xs text-[var(--agent-text-soft)]">{user?.email || ''}</div>
            </div>
          </div>
        </div>

        <div className="relative shrink-0 border-b border-[var(--app-border-soft)] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                {currentMeta.eyebrow}
              </div>
              <div className="mt-2 text-lg font-semibold text-[var(--app-text)]">{currentMeta.title}</div>
            </div>
            {section === 'ceo' ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-full hover:bg-[var(--app-raised-2)]"
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
            <div className="mt-4 rounded-[22px] border border-[var(--app-border-soft)] bg-[linear-gradient(180deg,#ffffff,#f7faff)] p-4 shadow-[0_16px_36px_rgba(28,44,73,0.08)]">
              <div className="space-y-3">
                <Select value={effectiveSelectedWs} onValueChange={(value) => value && setSelectedWs(value)}>
                  <SelectTrigger className="h-11 rounded-[16px] border-[var(--app-border-soft)] bg-[var(--app-surface)] text-sm text-[var(--app-text)]">
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
                  className="h-11 w-full rounded-[16px] border-0 bg-[linear-gradient(135deg,#4f85ff,#2f6df6)] text-sm font-semibold text-white shadow-[0_20px_50px_rgba(47,109,246,0.22)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(47,109,246,0.28)]"
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

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-5 p-4">
              {section === 'ceo' ? (
                <div className="space-y-4">
                  <SectionLabel>Navigation</SectionLabel>
                  <div className="grid gap-2">
                    {mainNavItems.map(item => (
                      <RailItem
                        key={item.section}
                        icon={item.icon}
                        title={item.title}
                        meta={item.section === 'projects' ? <span>{ceoDepartmentSetupValue} departments · {projects.length} projects</span> : item.meta}
                        active={section === item.section}
                        onClick={() => {
                          onActivateSection?.(item.section);
                          onClose();
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {section === 'conversations' ? (
                sortedGroupNames.length > 0 ? (
                  <div className="space-y-4">
                    {sortedGroupNames.map(wsName => (
                      <div key={wsName} className="space-y-1.5">
                        <button
                          type="button"
                          className="group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--app-raised-2)]"
                          onClick={() => setWsCollapsed(prev => ({ ...prev, [wsName]: !prev[wsName] }))}
                        >
                          <ChevronRight className={cn('h-3 w-3 shrink-0 text-[var(--app-text-muted)] transition-transform', !wsCollapsed[wsName] && 'rotate-90')} />
                          {wsName === 'Playground'
                            ? <Gamepad2 className="h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                            : <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-muted)]" />}
                          <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--app-text-muted)] group-hover:text-[var(--app-text-soft)]">
                            {wsName}
                          </span>
                          <Badge variant="outline" className="h-5 rounded-full border-[var(--app-border-soft)] bg-[var(--app-raised)] px-1.5 text-[10px] font-mono text-[var(--app-text-muted)] opacity-80">
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
                  <div className="rounded-[20px] border border-dashed border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-8 text-center text-sm text-[var(--app-text-soft)]">
                    {t('sidebar.noConversations')}
                  </div>
                )
              ) : null}

              {section === 'projects' ? (
                <div className="space-y-2">
                  <SectionLabel>Navigation</SectionLabel>
                  <div className="grid gap-2">
                    {mainNavItems.map(item => (
                      <RailItem
                        key={item.section}
                        icon={item.icon}
                        title={item.title}
                        meta={item.meta}
                        active={section === item.section}
                        onClick={() => {
                          onActivateSection?.(item.section);
                          onClose();
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {section === 'knowledge' || section === 'operations' ? (
                <div className="space-y-2">
                  <SectionLabel>Navigation</SectionLabel>
                  <div className="grid gap-2">
                    {mainNavItems.map(item => (
                      <RailItem
                        key={item.section}
                        icon={item.icon}
                        title={item.title}
                        meta={item.meta}
                        active={section === item.section}
                        onClick={() => {
                          onActivateSection?.(item.section);
                          onClose();
                        }}
                      />
                    ))}
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

      </aside>
    </>
  );
}
