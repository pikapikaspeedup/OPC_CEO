'use client';

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import Sidebar, { type PrimarySection } from '@/components/sidebar';
import Chat from '@/components/chat';
import ChatInput from '@/components/chat-input';
import KnowledgeWorkspace from '@/components/knowledge-panel';
import LogViewerPanel from '@/components/log-viewer-panel';
import ProjectsPanel from '@/components/projects-panel';
import CeoOfficeCockpit from '@/components/ceo-office-cockpit';
import SettingsPanel, { type SettingsFocusTarget, type SettingsTabId } from '@/components/settings-panel';
import OpsDashboard from '@/components/ops-dashboard';
import OnboardingWizard from '@/components/onboarding-wizard';
import LocaleToggle from '@/components/locale-toggle';
import NotificationIndicators from '@/components/notification-indicators';
import SystemImprovementDetailDrawer from '@/components/system-improvement-detail-drawer';
import WorkspaceConceptShell from '@/components/workspace-concept-shell';
import { useI18n } from '@/components/locale-provider';
import { buildAppUrl, parseAppUrlState } from '@/lib/app-url-state';
import { api, connectWs, type AuditEvent } from '@/lib/api';
import type { AgentRun, Conversation, Project, ModelConfig, Server, Skill, StepsData, Workflow, Rule, Workspace, TemplateSummaryFE, ResumeAction, DepartmentConfig, CEOEvent } from '@/lib/types';
import ActiveTasksPanel, { ActiveTask } from '@/components/active-tasks-panel';
import { generateCEOEventsWithAudit } from '@/lib/ceo-events';
import {
  Download,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Clock,
  FolderKanban,
  Menu,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  countConfiguredDepartments,
  getAgentStateRefreshMs,
  shouldShowShellSidebar,
  type AppShellUtilityPanel,
} from '@/lib/home-shell';
import { dedupeAuditEvents } from '@/lib/ceo-office-home';
import { mergeDepartmentConfigIntoWorkspaceMap } from '@/lib/department-config';
import { buildWorkspaceOptions } from '@/lib/workspace-options';
import { isAgentRunActive, pickDefaultAgentRun } from '@/lib/agent-run-utils';
import { AppShell, StatusChip } from '@/components/ui/app-shell';
import { cn } from '@/lib/utils';

type UtilityPanel = AppShellUtilityPanel;
type ConversationScope = 'ceo' | 'conversations' | null;
type UrlNavigationMode = 'push' | 'replace';
const CEO_WORKSPACE_URI = 'file:///Users/darrel/.gemini/antigravity/ceo-workspace';

type SettingsPanelRequest = {
  tab: SettingsTabId;
  focusTarget: SettingsFocusTarget;
  nonce: number;
};

type ProjectsMetricTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const projectsMetricToneClasses: Record<ProjectsMetricTone, { icon: string; accent: string }> = {
  neutral: {
    icon: 'border-slate-200 bg-slate-50 text-slate-600',
    accent: 'text-slate-600',
  },
  info: {
    icon: 'border-sky-200 bg-sky-50 text-sky-700',
    accent: 'text-sky-700',
  },
  success: {
    icon: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    accent: 'text-emerald-700',
  },
  warning: {
    icon: 'border-amber-200 bg-amber-50 text-amber-700',
    accent: 'text-amber-700',
  },
  danger: {
    icon: 'border-red-200 bg-red-50 text-red-700',
    accent: 'text-red-700',
  },
};

function ProjectsMetricTile({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: ProjectsMetricTone;
}) {
  const classes = projectsMetricToneClasses[tone];

  return (
    <div className="min-h-[78px] rounded-[10px] border border-[#dfe5ee] bg-white px-4 py-3 shadow-[0_8px_22px_rgba(28,44,73,0.05)]">
      <div className="flex h-full items-center gap-4">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border', classes.icon)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-[var(--app-text-soft)]">{label}</div>
          <div className="mt-1 text-2xl font-semibold leading-none tabular-nums text-[var(--app-text)]">{value}</div>
          <div className={cn('mt-2 truncate text-xs font-medium', classes.accent)}>{detail}</div>
        </div>
      </div>
    </div>
  );
}

type OpsAssetRequest = {
  tab: 'workflows' | 'skills' | 'rules';
  itemName: string | null;
  nonce: number;
};

type OpsProposalRequest = {
  proposalId: string | null;
  nonce: number;
};

function isLocalProviderConversation(id: string | null | undefined): boolean {
  return !!id && (
    id.startsWith('conversation-') ||
    id.startsWith('local-codex-') ||
    id.startsWith('local-native-codex-') ||
    id.startsWith('local-claude-api-') ||
    id.startsWith('local-openai-api-') ||
    id.startsWith('local-gemini-api-') ||
    id.startsWith('local-grok-api-') ||
    id.startsWith('local-custom-') ||
    id.startsWith('codex-') ||
    id.startsWith('native-codex-') ||
    id.startsWith('claude-api-') ||
    id.startsWith('openai-api-') ||
    id.startsWith('gemini-api-') ||
    id.startsWith('grok-api-') ||
    id.startsWith('custom-')
  );
}

export default function Home() {
  const { locale, t } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const [sidebarSection, setSidebarSection] = useState<PrimarySection>('ceo');
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null);
  const [settingsPanelRequest, setSettingsPanelRequest] = useState<SettingsPanelRequest>({
    tab: 'profile',
    focusTarget: null,
    nonce: 0,
  });
  const [opsAssetRequest, setOpsAssetRequest] = useState<OpsAssetRequest>({
    tab: 'workflows',
    itemName: null,
    nonce: 0,
  });
  const [opsProposalRequest, setOpsProposalRequest] = useState<OpsProposalRequest>({
    proposalId: null,
    nonce: 0,
  });
  const [systemImprovementProposalId, setSystemImprovementProposalId] = useState<string | null>(null);
  const [systemImprovementRefreshSignal, setSystemImprovementRefreshSignal] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState('Antigravity');
  const [activeConversationScope, setActiveConversationScope] = useState<ConversationScope>(null);
  const [steps, setSteps] = useState<StepsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [currentModel, setCurrentModel] = useState('MODEL_PLACEHOLDER_M26');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [discoveredSkills, setDiscoveredSkills] = useState<Skill[]>([]);
  const [discoveredWorkflows, setDiscoveredWorkflows] = useState<Workflow[]>([]);
  const [discoveredRules, setDiscoveredRules] = useState<Rule[]>([]);
  const [connected, setConnected] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [, setCascadeStatus] = useState('idle');
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [agenticMode, setAgenticMode] = useState(true);
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [dismissedTasks, setDismissedTasks] = useState<Set<string>>(new Set());
  const [sendError, setSendError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [opsSearchQuery, setOpsSearchQuery] = useState('');
  const [projectCreateRequestToken, setProjectCreateRequestToken] = useState(0);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [selectedAgentRunId, setSelectedAgentRunId] = useState<string | null>(null);
  const [agentServers, setAgentServers] = useState<Server[]>([]);
  const [agentWorkspacesRaw, setAgentWorkspacesRaw] = useState<Workspace[]>([]);
  const [hiddenWorkspaces, setHiddenWorkspaces] = useState<string[]>([]);
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [selectedKnowledgeTitle, setSelectedKnowledgeTitle] = useState('');
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState('');
  const [knowledgeRefreshSignal, setKnowledgeRefreshSignal] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [urlStateReady, setUrlStateReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const lastStepCountRef = useRef(0);
  const apiLoadedRef = useRef(false);
  const agentStateLoadedRef = useRef(false);
  const nextUrlNavigationModeRef = useRef<UrlNavigationMode>('replace');
  const templatesLoadedRef = useRef(false);
  const chatAssetsLoadedRef = useRef(false);
  const operationsAssetsLoadedRef = useRef(false);
  const [templates, setTemplates] = useState<TemplateSummaryFE[]>([]);
  const [recentAuditEvents, setRecentAuditEvents] = useState<AuditEvent[]>([]);
  const [ceoHistory, setCeoHistory] = useState<Conversation[]>([]);

  const loadModels = useCallback(async () => {
    api.models().then(data => {
      if (data.clientModelConfigs?.length) {
        const sortedModels = [...data.clientModelConfigs].sort((a, b) => {
          if (a.isRecommended !== b.isRecommended) return a.isRecommended ? -1 : 1;
          return a.label.localeCompare(b.label);
        });
        setModels(sortedModels);

        const saved = localStorage.getItem('antigravity_selected_model');
        const defaultModel = saved || 'MODEL_AUTO';
        const exists = defaultModel === 'MODEL_AUTO' || sortedModels.some(model => model.modelOrAlias?.model === defaultModel);
        setCurrentModel(exists ? defaultModel : 'MODEL_AUTO');
      }
    }).catch(() => { });
  }, []);

  const loadTemplates = useCallback(async (force = false) => {
    if (templatesLoadedRef.current && !force) return;
    try {
      const data = await api.pipelines();
      setTemplates(data);
      templatesLoadedRef.current = true;
    } catch {
      /* silent */
    }
  }, []);

  const loadChatAssets = useCallback(async (force = false) => {
    if (chatAssetsLoadedRef.current && !force) return;
    try {
      const [nextSkills, nextWorkflows] = await Promise.all([
        api.skills(),
        api.workflows(),
      ]);
      setSkills(nextSkills);
      setWorkflows(nextWorkflows);
      chatAssetsLoadedRef.current = true;
    } catch {
      /* silent */
    }
  }, []);

  const loadOperationsAssets = useCallback(async (force = false) => {
    if (operationsAssetsLoadedRef.current && !force) return;
    try {
      const [nextSkills, nextWorkflows, nextRules, nextDiscoveredSkills, nextDiscoveredWorkflows, nextDiscoveredRules] = await Promise.all([
        api.skills(),
        api.workflows(),
        api.rules(),
        api.discoveredSkills(),
        api.discoveredWorkflows(),
        api.discoveredRules(),
      ]);
      setSkills(nextSkills);
      setWorkflows(nextWorkflows);
      setRules(nextRules);
      setDiscoveredSkills(nextDiscoveredSkills);
      setDiscoveredWorkflows(nextDiscoveredWorkflows);
      setDiscoveredRules(nextDiscoveredRules);
      chatAssetsLoadedRef.current = true;
      operationsAssetsLoadedRef.current = true;
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (sidebarSection === 'projects' || sidebarSection === 'ceo') {
      void loadTemplates();
    }
    if (sidebarSection === 'ceo' || sidebarSection === 'conversations') {
      void loadChatAssets();
    }
    if (sidebarSection === 'operations') {
      void loadOperationsAssets();
    }
  }, [loadChatAssets, loadOperationsAssets, loadTemplates, sidebarSection]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('antigravity_selected_model', currentModel);
    }
  }, [currentModel]);

  useEffect(() => {
    wsRef.current = connectWs(
      (cascadeId, data, active, status, extra) => {
        setActiveTasks(prev => {
          const existing = prev.find(task => task.cascadeId === cascadeId);
          const nextTask: ActiveTask = {
            cascadeId,
            title: existing?.title || cascadeId.slice(0, 8),
            workspace: existing?.workspace || '',
            stepCount: data.steps?.length || existing?.stepCount || 0,
            totalSteps: extra?.totalLength || existing?.totalSteps,
            lastTaskBoundary: extra?.lastTaskBoundary || existing?.lastTaskBoundary,
            isActive: active,
            cascadeStatus: status,
          };

          if (existing) {
            return prev.map(task => task.cascadeId === cascadeId ? nextTask : task);
          }

          return [...prev, nextTask];
        });

        setActiveId(currentId => {
          if (currentId === cascadeId) {
            const newLength = data.steps?.length || 0;
            const threshold = lastStepCountRef.current;
            if (newLength > 0 && (apiLoadedRef.current ? newLength > threshold : newLength >= threshold)) {
              lastStepCountRef.current = newLength;
              setSteps(data);
            }
            setIsActive(active);
            setCascadeStatus(status);
          }

          return currentId;
        });
      },
      setConnected,
    );

    return () => {
      wsRef.current?.close();
    };
  }, []);

  const loadAgentState = useCallback(async (preferredRunId?: string | null) => {
    try {
      const [fetchedProjects, runs, servers, workspaces, hidden] = await Promise.all([
        api.projects().catch(() => [] as Project[]),
        api.agentRuns(),
        api.servers(),
        api.workspaces(),
        fetch('/api/workspaces/close').then(res => res.json()).catch(() => [] as string[]),
      ]);

      setProjects(fetchedProjects);
      setAgentRuns(runs);
      setSelectedAgentRunId(prev => preferredRunId
        ? (runs.some(run => run.runId === preferredRunId) ? preferredRunId : pickDefaultAgentRun(runs, prev))
        : pickDefaultAgentRun(runs, prev));
      setAgentServers(servers);
      setAgentWorkspacesRaw(workspaces.workspaces || []);
      setHiddenWorkspaces(hidden || []);
    } catch {
      setAgentRuns([]);
      setSelectedAgentRunId(null);
      setAgentServers([]);
      setAgentWorkspacesRaw([]);
      setHiddenWorkspaces([]);
    }
    agentStateLoadedRef.current = true;
  }, []);

  const agentStatePollMs = useMemo(
    () => getAgentStateRefreshMs(sidebarSection, utilityPanel),
    [sidebarSection, utilityPanel],
  );

  useEffect(() => {
    void loadAgentState();
    const timer = setInterval(() => {
      void loadAgentState(selectedAgentRunId);
    }, agentStatePollMs);
    return () => clearInterval(timer);
  }, [agentStatePollMs, loadAgentState, selectedAgentRunId]);

  const loadSteps = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await api.conversationSteps(id);
      const apiLength = data.steps?.length || 0;
      if (apiLength >= lastStepCountRef.current) {
        lastStepCountRef.current = apiLength;
        apiLoadedRef.current = true;
        setSteps(data);
      } else {
        apiLoadedRef.current = true;
      }
    } catch {
      setSteps(prev => prev ? prev : null);
    }
    setLoading(false);
  }, []);

  const queueUrlSync = useCallback((mode: UrlNavigationMode = 'push') => {
    nextUrlNavigationModeRef.current = mode;
  }, []);

  const activateSection = useCallback((section: PrimarySection, mode: UrlNavigationMode = 'push') => {
    queueUrlSync(mode);
    setSidebarSection(section);
    setUtilityPanel(null);
    setSidebarOpen(false);
    setMainMenuOpen(false);
  }, [queueUrlSync]);

  const openSettingsPanel = useCallback((
    options?: Partial<Pick<SettingsPanelRequest, 'tab' | 'focusTarget'>>,
    mode: UrlNavigationMode = 'push',
  ) => {
    queueUrlSync(mode);
    setSettingsPanelRequest((prev) => ({
      tab: options?.tab ?? 'profile',
      focusTarget: options?.focusTarget ?? null,
      nonce: prev.nonce + 1,
    }));
    setUtilityPanel('settings');
    setSidebarOpen(false);
    setMainMenuOpen(false);
  }, [queueUrlSync]);

  const syncConversationSelection = useCallback((
    id: string | null,
    title: string | null,
    scope: ConversationScope,
  ) => {
    lastStepCountRef.current = 0;
    apiLoadedRef.current = false;
    setActiveConversationScope(scope);
    setSendError(null);
    setSteps(null);
    setIsActive(false);
    setCascadeStatus('idle');

    if (!id) {
      setActiveId(null);
      setActiveTitle(scope === 'ceo' ? 'CEO Office' : scope === 'conversations' ? t('shell.chats') : 'Antigravity');
      return;
    }

    setActiveId(id);
    setActiveTitle(title || id.slice(0, 8));
    void loadSteps(id);

    if (!isLocalProviderConversation(id) && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', cascadeId: id }));
    }

    setActiveTasks(prev => prev.map(task => task.cascadeId === id ? { ...task, title: title || id.slice(0, 8) } : task));
  }, [loadSteps, t]);

  const openOpsAsset = useCallback((tab: OpsAssetRequest['tab'], itemName: string, mode: UrlNavigationMode = 'push') => {
    activateSection('operations', mode);
    setOpsAssetRequest((prev) => ({
      tab,
      itemName,
      nonce: prev.nonce + 1,
    }));
  }, [activateSection]);

  const openOpsPanel = useCallback((
    options?: { proposalId?: string; query?: string },
    mode: UrlNavigationMode = 'push',
  ) => {
    activateSection('operations', mode);
    if (options?.proposalId) {
      setOpsProposalRequest((prev) => ({
        proposalId: options.proposalId || null,
        nonce: prev.nonce + 1,
      }));
      setOpsSearchQuery(options.query || options.proposalId);
    }
  }, [activateSection]);

  const openSystemImprovementProposal = useCallback((proposalId: string | null) => {
    if (!proposalId) return;
    setSystemImprovementProposalId(proposalId);
  }, []);

  const handleSystemImprovementDrawerOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setSystemImprovementProposalId(null);
    }
  }, []);

  const refreshSystemImprovementViews = useCallback(() => {
    setSystemImprovementRefreshSignal((value) => value + 1);
    void loadAgentState(selectedAgentRunId);
  }, [loadAgentState, selectedAgentRunId]);

  const handleSelect = useCallback((id: string, title: string, targetSection?: PrimarySection, mode: UrlNavigationMode = 'push') => {
    const nextSection = targetSection || 'conversations';
    activateSection(nextSection, mode);
    syncConversationSelection(id, title, nextSection === 'ceo' ? 'ceo' : 'conversations');
  }, [activateSection, syncConversationSelection]);

  const navigateToProject = useCallback((projectId: string | null, mode: UrlNavigationMode = 'push') => {
    activateSection('projects', mode);
    setSelectedAgentRunId(null);
    setSelectedProjectId(projectId);
  }, [activateSection]);

  const navigateToProjectRun = useCallback(async (runId: string, projectId?: string | null, mode: UrlNavigationMode = 'push') => {
    activateSection('projects', mode);
    setSelectedAgentRunId(runId);
    if (projectId) {
      setSelectedProjectId(projectId);
      return;
    }

    const cachedRun = agentRuns.find((run) => run.runId === runId);
    if (cachedRun?.projectId) {
      setSelectedProjectId(cachedRun.projectId);
      return;
    }

    try {
      const fetchedRun = await api.agentRun(runId);
      setSelectedProjectId(fetchedRun.projectId || null);
    } catch {
      setSelectedProjectId(null);
    }
  }, [activateSection, agentRuns]);

  const navigateToKnowledge = useCallback((knowledgeId: string | null, title: string | null, mode: UrlNavigationMode = 'push') => {
    activateSection('knowledge', mode);
    setSelectedKnowledgeId(knowledgeId);
    setSelectedKnowledgeTitle(title || '');
  }, [activateSection]);

  const applyUrlState = useCallback((search: string) => {
    const nextState = parseAppUrlState(search);

    nextUrlNavigationModeRef.current = 'replace';
    setSidebarSection(nextState.section);
    setUtilityPanel(nextState.utilityPanel);
    setSidebarOpen(false);
    setMainMenuOpen(false);

    if (nextState.section === 'projects') {
      setSelectedAgentRunId(null);
      setSelectedProjectId(nextState.projectId);
    }

    if (nextState.section === 'knowledge') {
      setSelectedKnowledgeId(nextState.knowledgeId);
      setSelectedKnowledgeTitle('');
    }

    if (nextState.section === 'operations') {
      setOpsProposalRequest((prev) => ({
        proposalId: nextState.opsProposalId,
        nonce: nextState.opsProposalId ? prev.nonce + 1 : prev.nonce,
      }));
      setOpsSearchQuery(nextState.opsProposalId || '');
    }

    if (nextState.section === 'ceo' || nextState.section === 'conversations') {
      syncConversationSelection(
        nextState.conversationId,
        nextState.conversationTitle,
        nextState.section === 'ceo' ? 'ceo' : 'conversations',
      );
    }

    if (nextState.utilityPanel === 'settings') {
      setSettingsPanelRequest((prev) => ({
        tab: nextState.settingsTab,
        focusTarget: nextState.settingsFocus,
        nonce: prev.nonce + 1,
      }));
    }
  }, [syncConversationSelection]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    applyUrlState(window.location.search);
    setUrlStateReady(true);
  }, [applyUrlState]);

  useEffect(() => {
    if (!urlStateReady || typeof window === 'undefined') return;

    const onPopState = () => {
      applyUrlState(window.location.search);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyUrlState, urlStateReady]);

  const handleNew = async (workspace: string) => {
    try {
      const response = await api.createConversation(workspace);
      if (response.error) {
        alert(response.error);
        return;
      }
      if (response.cascadeId) {
        handleSelect(response.cascadeId, 'New conversation');
      }
    } catch (error: unknown) {
      alert('Failed: ' + (error instanceof Error ? error.message : 'unknown'));
    }
  };

  const handleCreateCeoConversation = useCallback(async (mode: UrlNavigationMode = 'push') => {
    try {
      const response = await api.createConversation(CEO_WORKSPACE_URI);
      if (response.error) {
        alert(response.error);
        return;
      }
      if (response.cascadeId) {
        handleSelect(response.cascadeId, 'CEO Office', 'ceo', mode);
      }
    } catch (error: unknown) {
      alert('Failed: ' + (error instanceof Error ? error.message : 'unknown'));
    }
  }, [handleSelect]);

  useEffect(() => {
    if (!urlStateReady || sidebarSection !== 'ceo' || utilityPanel !== null) return;

    let cancelled = false;
    api.conversations({ workspace: CEO_WORKSPACE_URI, pageSize: 1 }).then(data => {
       if (cancelled) return;
       const isCurrentlyCeo = activeId && data.some(c => c.id === activeId && c.workspace === CEO_WORKSPACE_URI);
       if (!isCurrentlyCeo) {
         const ceoConv = data[0];
         if (ceoConv) {
           handleSelect(ceoConv.id, ceoConv.title || 'CEO Office', 'ceo', 'replace');
         } else {
           syncConversationSelection(null, null, 'ceo');
         }
       }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarSection, urlStateReady, utilityPanel]);

  useEffect(() => {
    if (sidebarSection !== 'ceo' && activeConversationScope !== 'ceo') return;

    let cancelled = false;
    const poll = () => {
      api.conversations({ workspace: CEO_WORKSPACE_URI, pageSize: 8 })
        .then((items) => {
          if (!cancelled) {
            setCeoHistory(
              [...items].sort((a, b) => b.mtime - a.mtime),
            );
          }
        })
        .catch(() => {
          if (!cancelled) setCeoHistory([]);
        });
    };

    poll();
    const interval = window.setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeConversationScope, sidebarSection]);

  const handleSend = async (text: string, attachments?: unknown) => {
    if (!activeId) return;
    setSendError(null);

    let targetModel = currentModel;
    if (targetModel === 'MODEL_AUTO') {
      const priority = ['MODEL_PLACEHOLDER_M26', 'MODEL_PLACEHOLDER_M37', 'MODEL_PLACEHOLDER_M36', 'MODEL_PLACEHOLDER_M35', 'MODEL_PLACEHOLDER_M47'];
      let found = false;
      for (const candidate of priority) {
        const config = models.find(model => model.modelOrAlias?.model === candidate);
        if (config && config.quotaInfo?.remainingFraction !== undefined && config.quotaInfo.remainingFraction > 0) {
          targetModel = candidate;
          found = true;
          break;
        }
      }

      if (!found) {
        targetModel = models.find(model => model.modelOrAlias?.model === 'MODEL_PLACEHOLDER_M47')?.modelOrAlias?.model
          || models[0]?.modelOrAlias?.model
          || 'MODEL_PLACEHOLDER_M26';
      }
    }

    try {
      await api.sendMessage(activeId, text, targetModel, agenticMode, attachments);
      if (isLocalProviderConversation(activeId)) {
        await loadSteps(activeId);
        setIsActive(false);
        setCascadeStatus('idle');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setSendError(`发送失败: ${message}`);
      setTimeout(() => setSendError(null), 6000);
    }
  };

  const handleProceed = async (uri: string) => {
    if (!activeId || !uri) return;
    try {
      await api.proceed(activeId, uri, currentModel);
    } catch {
      /* silent */
    }
  };

  const handleCancel = async () => {
    if (!activeId) return;
    try {
      await api.cancel(activeId);
      setTimeout(() => {
        void loadSteps(activeId);
      }, 500);
    } catch {
      /* silent */
    }
  };

  const handleCancelAgentRun = useCallback(async (runId: string) => {
    try {
      await api.cancelRun(runId);
      await loadAgentState(runId);
    } catch {
      /* silent */
    }
  }, [loadAgentState]);

  const handleResumeProject = useCallback(async (
    projectId: string,
    stageId: string,
    action: ResumeAction,
    branchIndex?: number,
  ) => {
    await api.resumeProject(projectId, { stageId, branchIndex, action });
    await loadAgentState();
  }, [loadAgentState]);

  const handleRevert = async (stepIndex: number) => {
    if (!activeId) return;

    let targetIndex = stepIndex;
    if (steps?.steps?.[stepIndex]?.type === 'CORTEX_STEP_TYPE_USER_INPUT') {
      targetIndex = Math.max(0, stepIndex - 1);
      while (targetIndex > 0) {
        const type = steps.steps[targetIndex]?.type || '';
        if (type !== 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE' && type !== 'CORTEX_STEP_TYPE_CHECKPOINT') break;
        targetIndex--;
      }
    }

    if (steps?.steps) {
      const truncated = steps.steps.slice(0, targetIndex + 1);
      lastStepCountRef.current = truncated.length;
      setSteps({ ...steps, steps: truncated });
    }

    try {
      await api.revert(activeId, targetIndex, currentModel);
      lastStepCountRef.current = 0;
      apiLoadedRef.current = false;
      setTimeout(() => {
        void loadSteps(activeId);
      }, 800);
    } catch {
      /* silent */
    }
  };

  const allowInlineRevert = !!activeId;

  const handleExportMarkdown = useCallback(() => {
    if (!steps?.steps?.length) return;

    let markdown = `# Conversation: ${activeTitle}\n\n`;
    steps.steps.forEach(step => {
      const type = step.type || '';
      if (type === 'CORTEX_STEP_TYPE_USER_INPUT') {
        const text = (step.userInput?.items || []).filter(item => item.text).map(item => item.text).join('').trim();
        if (text) markdown += `**User**:\n\n${text}\n\n---\n\n`;
      } else if (type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
        const text = step.plannerResponse?.modifiedResponse || step.plannerResponse?.response || '';
        if (text) markdown += `**Assistant**:\n\n${text}\n\n---\n\n`;
      } else if (type === 'CORTEX_STEP_TYPE_TASK_BOUNDARY') {
        const boundary = step.taskBoundary || {};
        markdown += `> **Task Boundary: ${boundary.taskName || 'Task'}**\n`;
        if (boundary.taskStatus) markdown += `> Status: ${boundary.taskStatus}\n`;
        if (boundary.taskSummary) markdown += `> ${boundary.taskSummary}\n\n`;
      } else if (type === 'CORTEX_STEP_TYPE_NOTIFY_USER') {
        const text = step.notifyUser?.notificationContent || '';
        if (text) markdown += `**Assistant Notification**:\n\n${text}\n\n---\n\n`;
      }
    });

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeTitle.replace(/[^a-zA-Z0-9-_\u4e00-\u9fa5]/g, '_')}_export.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [steps, activeTitle]);

  const handleKnowledgeSelect = useCallback((id: string, title: string) => {
    navigateToKnowledge(id, title);
  }, [navigateToKnowledge]);

  const handleKnowledgeBrowseSelect = useCallback((id: string, title: string, mode: UrlNavigationMode = 'replace') => {
    navigateToKnowledge(id, title, mode);
  }, [navigateToKnowledge]);

  const handleKnowledgeTitleChange = useCallback((title: string | null) => {
    setSelectedKnowledgeTitle(title || '');
  }, []);

  const handleKnowledgeDeleted = useCallback(() => {
    setSelectedKnowledgeId(null);
    setSelectedKnowledgeTitle('');
    setKnowledgeRefreshSignal(value => value + 1);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    if (activeTitle && activeTitle !== activeId.slice(0, 8)) return;

    let cancelled = false;
    api.conversations()
      .then((items) => {
        if (cancelled) return;
        const conversation = items.find(item => item.id === activeId);
        if (conversation?.title) {
          setActiveTitle(conversation.title);
        }
      })
      .catch(() => { });

    return () => {
      cancelled = true;
    };
  }, [activeId, activeTitle]);

  const currentUrlState = useMemo(() => ({
    section: sidebarSection,
    utilityPanel,
    conversationId:
      (sidebarSection === 'ceo' && activeConversationScope === 'ceo')
      || (sidebarSection === 'conversations' && activeConversationScope === 'conversations')
        ? activeId
        : null,
    conversationTitle:
      (sidebarSection === 'ceo' && activeConversationScope === 'ceo')
      || (sidebarSection === 'conversations' && activeConversationScope === 'conversations')
        ? activeTitle
        : null,
    projectId: sidebarSection === 'projects' ? selectedProjectId : null,
    knowledgeId: sidebarSection === 'knowledge' ? selectedKnowledgeId : null,
    opsProposalId: sidebarSection === 'operations' ? opsProposalRequest.proposalId : null,
    settingsTab: settingsPanelRequest.tab,
    settingsFocus: settingsPanelRequest.focusTarget,
  }), [
    activeConversationScope,
    activeId,
    activeTitle,
    selectedKnowledgeId,
    selectedProjectId,
    opsProposalRequest.proposalId,
    settingsPanelRequest.focusTarget,
    settingsPanelRequest.tab,
    sidebarSection,
    utilityPanel,
  ]);

  useEffect(() => {
    if (!urlStateReady || typeof window === 'undefined') return;

    const nextUrl = buildAppUrl(window.location.pathname, currentUrlState);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl === currentUrl) return;

    if (nextUrlNavigationModeRef.current === 'push') {
      window.history.pushState(window.history.state, '', nextUrl);
    } else {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
    nextUrlNavigationModeRef.current = 'replace';
  }, [currentUrlState, urlStateReady]);

  const isRunning = isActive;
  const workspaceOptions = buildWorkspaceOptions(agentServers, agentWorkspacesRaw, hiddenWorkspaces);
  const departmentWorkspaces = workspaceOptions
    .filter(workspace => !workspace.hidden)
    .map(workspace => ({ uri: workspace.uri, name: workspace.name, running: workspace.running }));

  const handleCreateKnowledge = useCallback(async () => {
    const defaultWorkspace = departmentWorkspaces[0];
    const created = await api.createKnowledge({
      title: '新建知识',
      content: '# 新建知识\n\n补充这条知识的摘要、关键要点和正文内容。',
      workspaceUri: defaultWorkspace?.uri,
      category: 'domain-knowledge',
      tags: defaultWorkspace?.name ? [defaultWorkspace.name] : [],
    });
    navigateToKnowledge(created.id, created.title);
    setKnowledgeRefreshSignal((value) => value + 1);
  }, [departmentWorkspaces, navigateToKnowledge]);

  // OPC Phase 3: load department configs for all workspaces
  const [departmentsMap, setDepartmentsMap] = useState<Map<string, DepartmentConfig>>(new Map());
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const wsKey = useMemo(() => departmentWorkspaces.map(w => w.uri).join(','), [departmentWorkspaces]);
  useEffect(() => {
    if (!departmentWorkspaces.length) return;
    Promise.all(
      departmentWorkspaces.map(ws =>
        api.getDepartment(ws.uri)
          .then(config => [ws.uri, config] as const)
          .catch(() => [ws.uri, null] as const),
      ),
    ).then(results => {
      const map = new Map<string, DepartmentConfig>();
      for (const [uri, config] of results) {
        if (config) map.set(uri, config);
      }
      setDepartmentsMap(map);
    });
  }, [wsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const configuredDepartmentCount = useMemo(
    () => countConfiguredDepartments(departmentWorkspaces, departmentsMap),
    [departmentWorkspaces, departmentsMap],
  );
  const isOpcUnconfigured = useMemo(() => {
    if (!departmentWorkspaces.length) return false;
    return configuredDepartmentCount < departmentWorkspaces.length;
  }, [configuredDepartmentCount, departmentWorkspaces.length]);

  const openOnboardingJourney = useCallback(() => {
    activateSection('projects');
    setOnboardingDismissed(false);
    setOnboardingOpen(true);
  }, [activateSection]);
  const headerSignalPollMs = useMemo(
    () => 60_000,
    [],
  );

  // Poll pending approval count for header badge
  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;
    const poll = async () => {
      try {
        const res = await api.listApprovals({ status: 'pending' });
        if (cancelled) return;
        setPendingApprovals(res.summary?.pending ?? 0);
        if (!eventSource && typeof EventSource !== 'undefined') {
          eventSource = new EventSource('/api/approval/events');
          eventSource.addEventListener('approval_request', () => { void poll(); });
          eventSource.addEventListener('approval_response', () => { void poll(); });
        }
      } catch {
        // web-only without backend intentionally returns 503; keep the shell usable.
      }
    };
    void poll();
    const interval = setInterval(poll, headerSignalPollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
      eventSource?.close();
    };
  }, [headerSignalPollMs]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api.auditEvents({ limit: 50 })
        .then((events) => { if (!cancelled) setRecentAuditEvents(events); })
        .catch(() => { if (!cancelled) setRecentAuditEvents([]); });
    };
    poll();
    const interval = setInterval(poll, headerSignalPollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [headerSignalPollMs]);

  // CEO events derived from projects
  const ceoEvents = useMemo(() => {
    try { return generateCEOEventsWithAudit(projects, [], recentAuditEvents); }
    catch { return [] as CEOEvent[]; }
  }, [projects, recentAuditEvents]);

  // Active runs for header ▶ indicator
  const headerActiveRuns = useMemo(
    () => agentRuns.filter(r => isAgentRunActive(r.status)),
    [agentRuns],
  );
  const activeProjectCount = useMemo(
    () => projects.filter(project => project.status === 'active').length,
    [projects],
  );
  const completedProjectCount = useMemo(
    () => projects.filter(project => project.status === 'completed').length,
    [projects],
  );
  const completedProjectThisWeekCount = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    const mondayOffset = (now.getDay() + 6) % 7;
    startOfWeek.setDate(now.getDate() - mondayOffset);
    startOfWeek.setHours(0, 0, 0, 0);
    const weekStartTime = startOfWeek.getTime();

    return projects.filter(project => {
      if (project.status !== 'completed') return false;
      const completedAt = new Date(project.updatedAt || project.createdAt).getTime();
      return Number.isFinite(completedAt) && completedAt >= weekStartTime;
    }).length;
  }, [projects]);
  const failedProjectCount = useMemo(
    () => projects.filter(project => project.status === 'failed').length,
    [projects],
  );
  const pausedProjectCount = useMemo(
    () => projects.filter(project => project.status === 'paused').length,
    [projects],
  );
  const departmentSetupValue = departmentWorkspaces.length
    ? `${configuredDepartmentCount}/${departmentWorkspaces.length}`
    : '0';
  const selectedProject = projects.find(project => project.projectId === selectedProjectId) || null;
  const showShellSidebar = useMemo(
    () => shouldShowShellSidebar(sidebarSection, utilityPanel),
    [sidebarSection, utilityPanel],
  );
  const primaryNavItems: Array<{ value: PrimarySection | 'settings'; label: string }> = [
    { value: 'ceo', label: 'CEO Office' },
    { value: 'projects', label: 'OPC' },
    { value: 'knowledge', label: t('shell.knowledge') },
    { value: 'operations', label: 'Ops' },
    { value: 'settings', label: 'Settings' },
  ];

  const currentSectionLabel = utilityPanel === 'settings'
    ? 'Settings'
    : sidebarSection === 'conversations'
      ? 'Threads'
      : primaryNavItems.find(item => item.value === sidebarSection)?.label || t('common.appName');

  const currentViewTitle = utilityPanel === 'settings'
    ? 'Settings'
    : sidebarSection === 'projects'
      ? (selectedProject?.name || 'OPC')
      : sidebarSection === 'knowledge'
        ? (selectedKnowledgeTitle || t('shell.knowledge'))
        : sidebarSection === 'ceo'
          ? 'CEO Office'
          : sidebarSection === 'conversations'
            ? (activeTitle || t('shell.chats'))
            : 'Operations';

  const visibleActiveTasks = useMemo(
    () => activeTasks
      .filter(task => !dismissedTasks.has(task.cascadeId))
      .map(task => {
        const run = agentRuns.find(r => r.childConversationId === task.cascadeId);
        return run?.supervisorReviews ? { ...task, supervisorReviews: run.supervisorReviews } : task;
      }),
    [activeTasks, agentRuns, dismissedTasks],
  );

  const ceoPriorityTasks = useMemo(
    () => visibleActiveTasks.slice(0, 4),
    [visibleActiveTasks],
  );

  const ceoRecentEvents = useMemo(
    () => dedupeAuditEvents(recentAuditEvents, 4),
    [recentAuditEvents],
  );

  const openConversationWorkbench = useCallback(() => {
    if (activeId && activeConversationScope === 'ceo') {
      handleSelect(activeId, activeTitle || 'CEO Office', 'conversations');
      return;
    }
    activateSection('conversations');
  }, [activateSection, activeConversationScope, activeId, activeTitle, handleSelect]);

  const useCeoOfficeShell = sidebarSection === 'ceo' && utilityPanel !== 'settings';
  const useWorkspaceConceptShell = utilityPanel === 'settings'
    || (utilityPanel === null && (sidebarSection === 'projects' || sidebarSection === 'knowledge' || sidebarSection === 'operations'));
  const workspaceShellUtility = (
    <div className="flex items-center gap-1.5">
      <NotificationIndicators
        events={ceoEvents}
        activeRuns={headerActiveRuns}
        projects={projects}
        pendingApprovals={pendingApprovals}
        onEventAction={(event, action) => {
          const payload = action.payload || {};
          const target = typeof payload.target === 'string' ? payload.target : undefined;
          if (target === 'scheduler') {
            activateSection('operations');
            return;
          }
          const projectId = typeof payload.projectId === 'string' ? payload.projectId : event.projectId;
          if (projectId) {
            navigateToProject(projectId);
          }
        }}
        onIntervene={async (runId, action) => {
          await api.interveneRun(runId, { action });
          loadAgentState();
        }}
        onNavigateToProject={navigateToProject}
      />

      <div className="mx-0.5 h-5 w-px bg-[#dfe5ee]" />

      <LocaleToggle className="hidden md:inline-flex" />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setLogViewerOpen(true)}
        className="text-[#566176] hover:bg-white hover:text-[#111827]"
        aria-label={t('shell.logs')}
        title={t('shell.logs')}
      >
        <Terminal className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <>
      <AppShell
        sidebar={showShellSidebar && !useCeoOfficeShell && !useWorkspaceConceptShell ? (
          <Sidebar
            activeId={activeId}
            onSelect={handleSelect}
            onNew={handleNew}
            onActivateSection={activateSection}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            selectedKnowledgeId={selectedKnowledgeId}
            onSelectKnowledge={handleKnowledgeSelect}
            knowledgeRefreshSignal={knowledgeRefreshSignal}
            section={sidebarSection}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={navigateToProject}
            onOpenOpsAsset={openOpsAsset}
            ceoThreadCount={ceoHistory.length}
            ceoActiveRunCount={headerActiveRuns.length}
            ceoPendingApprovalCount={pendingApprovals}
            ceoDepartmentSetupValue={departmentSetupValue}
            ceoDepartmentSetupComplete={!isOpcUnconfigured}
          />
        ) : null}
        header={useCeoOfficeShell || useWorkspaceConceptShell ? null : (
          <header className="relative z-20 flex h-18 shrink-0 items-center gap-3 border-b border-[var(--app-border-soft)] bg-[rgba(255,255,255,0.84)] px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-[rgba(255,255,255,0.76)] md:px-6">
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" className="shrink-0 md:hidden" onClick={() => setMainMenuOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              {showShellSidebar ? (
                <Button variant="ghost" size="icon" className="shrink-0 md:hidden" onClick={() => setSidebarOpen(true)}>
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-border-soft)] bg-[linear-gradient(180deg,#ffffff,#f4f7fc)] text-sm font-bold text-[var(--app-accent)] shadow-[0_10px_24px_rgba(28,44,73,0.08)]">
                O
              </div>
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">{currentSectionLabel}</div>
                <div className="truncate text-sm font-semibold text-[var(--app-text)]">{currentViewTitle || t('common.appName')}</div>
              </div>
            </div>

            <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
              <nav className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[var(--app-border-soft)] bg-[rgba(255,255,255,0.88)] p-1.5 shadow-[0_8px_24px_rgba(28,44,73,0.05)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {primaryNavItems.map(item => {
                  const active = item.value === 'settings'
                    ? utilityPanel === 'settings'
                    : utilityPanel === null && sidebarSection === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={cn(
                        'inline-flex shrink-0 items-center rounded-full px-4 py-2.5 text-sm font-medium transition-all',
                        active
                          ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                          : 'text-[var(--app-text-soft)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]',
                      )}
                      onClick={() => item.value === 'settings' ? openSettingsPanel() : activateSection(item.value)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <NotificationIndicators
                events={ceoEvents}
                activeRuns={headerActiveRuns}
                projects={projects}
                pendingApprovals={pendingApprovals}
                onEventAction={(event, action) => {
                  const payload = action.payload || {};
                  const target = typeof payload.target === 'string' ? payload.target : undefined;
                  if (target === 'scheduler') {
                    activateSection('operations');
                    return;
                  }
                  const projectId = typeof payload.projectId === 'string' ? payload.projectId : event.projectId;
                  if (projectId) {
                    navigateToProject(projectId);
                  }
                }}
                onIntervene={async (runId, action) => {
                  await api.interveneRun(runId, { action });
                  loadAgentState();
                }}
                onNavigateToProject={navigateToProject}
              />

              <div className="mx-0.5 h-5 w-px bg-[var(--app-border-soft)]" />

              <LocaleToggle className="hidden md:inline-flex" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLogViewerOpen(true)}
                className="text-[var(--app-text-muted)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                aria-label={t('shell.logs')}
                title={t('shell.logs')}
              >
                <Terminal className="h-4 w-4" />
              </Button>
              {sidebarSection === 'conversations' && steps?.steps?.length ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleExportMarkdown}
                  className="text-[var(--app-text-muted)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                  aria-label={t('shell.export')}
                  title={t('shell.export')}
                >
                  <Download className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </header>
        )}
      >
        {utilityPanel === 'settings' ? (
          <WorkspaceConceptShell
            activeSection="settings"
            title="Settings"
            subtitle="配置工作区"
            headerVariant="compact"
            utility={workspaceShellUtility}
            onOpenCeo={() => activateSection('ceo')}
            onOpenProjects={() => activateSection('projects')}
            onOpenKnowledge={() => activateSection('knowledge')}
            onOpenOps={() => openOpsPanel()}
            onOpenSettings={() => openSettingsPanel()}
          >
            <SettingsPanel
              requestedTab={settingsPanelRequest.tab}
              focusTarget={settingsPanelRequest.focusTarget}
              requestToken={settingsPanelRequest.nonce}
            />
          </WorkspaceConceptShell>
        ) : sidebarSection === 'projects' ? (
          <WorkspaceConceptShell
            activeSection="projects"
            title={selectedProject ? `Projects / ${selectedProject.name}` : 'Projects'}
            subtitle="项目总览"
            headerVariant="compact"
            badges={(
              <>
                {selectedProject ? <StatusChip tone="info">{selectedProject.status}</StatusChip> : null}
              </>
            )}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative hidden lg:block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#93a0b3]" />
                  <input
                    value={projectSearchQuery}
                    onChange={(event) => setProjectSearchQuery(event.target.value)}
                    aria-label="搜索项目"
                    placeholder="搜索项目 / 工作区 / 关键词"
                    className="h-10 w-[280px] rounded-[8px] border border-[#dfe5ee] bg-white pl-9 pr-3 text-sm text-[#111827] outline-none transition-colors placeholder:text-[#93a0b3] focus:border-[#9bbcff] focus:ring-4 focus:ring-[#2f6df6]/10 xl:w-[330px]"
                  />
                </div>
                <Button
                  onClick={() => setProjectCreateRequestToken(token => token + 1)}
                  className="h-10 gap-2 rounded-[8px] bg-[#2f6df6] px-4 text-white shadow-[0_10px_22px_rgba(47,109,246,0.24)] hover:bg-[#245ee8]"
                >
                  <Plus className="h-4 w-4" />
                  新建项目
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            )}
            utility={workspaceShellUtility}
            onOpenCeo={() => activateSection('ceo')}
            onOpenProjects={() => activateSection('projects')}
            onOpenKnowledge={() => activateSection('knowledge')}
            onOpenOps={() => openOpsPanel()}
            onOpenSettings={() => openSettingsPanel()}
          >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <ProjectsMetricTile
                    icon={<FolderKanban className="h-5 w-5" />}
                    label="进行中项目"
                    value={activeProjectCount}
                    detail={`${completedProjectCount} completed total`}
                    tone="info"
                  />
                  <ProjectsMetricTile
                    icon={<AlertTriangle className="h-5 w-5" />}
                    label="阻塞项目"
                    value={failedProjectCount + pausedProjectCount}
                    detail={`${failedProjectCount} failed · ${pausedProjectCount} paused`}
                    tone={failedProjectCount ? 'danger' : pausedProjectCount ? 'warning' : 'success'}
                  />
                  <ProjectsMetricTile
                    icon={<CheckCircle2 className="h-5 w-5" />}
                    label="本周完成"
                    value={completedProjectThisWeekCount}
                    detail={`${completedProjectCount} completed total`}
                    tone="success"
                  />
                  <ProjectsMetricTile
                    icon={<Clock className="h-5 w-5" />}
                    label="待评审"
                    value={pendingApprovals}
                    detail="待处理审批"
                    tone={pendingApprovals ? 'warning' : 'neutral'}
                  />
                </div>
                {isOpcUnconfigured && !onboardingDismissed && (
                  <div className="rounded-[10px] border border-amber-200 bg-[#fffaf0] px-4 py-2.5 shadow-[0_8px_18px_rgba(28,44,73,0.04)]">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-amber-100 text-amber-700">
                          <Sparkles className="h-4 w-4" />
                        </span>
                        <p className="min-w-0 truncate text-xs leading-5 text-[#6b5a24]">
                          <span className="font-semibold text-[#1f2937]">部门画像仍未完整</span>
                          <span className="mx-2 text-amber-500">/</span>
                          检测到 {Math.max(departmentWorkspaces.length - configuredDepartmentCount, 0)} 个工作区尚未配置部门信息。左侧可以新建部门，这里用于补齐已有工作区的部门画像。
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button size="sm" onClick={openOnboardingJourney} className="h-8 rounded-[8px] bg-[var(--app-accent)] px-3 text-white hover:brightness-105">
                          补齐已有工作区
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setOnboardingDismissed(true)} className="h-8 rounded-[8px] px-3 text-[var(--app-text-soft)] hover:bg-white/70 hover:text-[var(--app-text)]">
                          稍后
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {isOpcUnconfigured && onboardingDismissed ? (
                  <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-2.5 shadow-[0_8px_18px_rgba(28,44,73,0.04)]">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--app-text)]">部门初始化仍未完成</div>
                        <div className="mt-0.5 truncate text-xs leading-5 text-[var(--app-text-soft)]">
                          当前已配置 {configuredDepartmentCount} / {departmentWorkspaces.length} 个部门。左侧可新建部门，这里继续补齐已有工作区。
                        </div>
                      </div>
                      <Button variant="outline" onClick={openOnboardingJourney} className="h-8 rounded-[8px] border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 text-[var(--app-text)] hover:bg-[var(--app-raised-2)]">
                        继续补齐已有工作区
                      </Button>
                    </div>
                  </div>
                ) : null}
                <OnboardingWizard
                  workspaces={departmentWorkspaces}
                  departments={departmentsMap}
                  open={onboardingOpen}
                  onOpenChange={setOnboardingOpen}
                  onComplete={(newMap) => {
                    setDepartmentsMap(newMap);
                    setOnboardingDismissed(true);
                  }}
                />
                <ProjectsPanel
                  projects={projects}
                  agentRuns={agentRuns}
	                  workspaces={departmentWorkspaces}
	                  selectedProjectId={selectedProjectId}
	                  selectedRunId={selectedAgentRunId}
	                  departments={departmentsMap}
	                  projectSearchQuery={projectSearchQuery}
	                  onProjectSearchQueryChange={setProjectSearchQuery}
	                  createProjectRequestToken={projectCreateRequestToken}
	                  onSelectProject={navigateToProject}
                  onSelectRun={(runId, projectId) => { void navigateToProjectRun(runId, projectId); }}
                  templates={templates}
                  models={models}
                  onResume={handleResumeProject}
                  onCancelRun={handleCancelAgentRun}
                  onOpenConversation={(id, title) => handleSelect(id, title || t('shell.agents'))}
                  onOpenImprovementProposal={openSystemImprovementProposal}
                  onRefresh={() => loadAgentState(selectedAgentRunId)}
                  refreshSignal={systemImprovementRefreshSignal}
                  onDepartmentSaved={(uri, config) => {
                    setDepartmentsMap(prev => mergeDepartmentConfigIntoWorkspaceMap(prev, uri, config));
                  }}
                />
          </WorkspaceConceptShell>
        ) : sidebarSection === 'knowledge' ? (
          <WorkspaceConceptShell
            activeSection="knowledge"
            title={(
              <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span>Knowledge</span>
                <span className="text-[0.72em] font-semibold text-[#475467]">知识库</span>
              </span>
            )}
            subtitle="沉淀公司的知识资产，构建可检索、可复用、可追溯的集体记忆。"
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#93a0b3]" />
                  <input
                    value={knowledgeSearchQuery}
                    onChange={(event) => setKnowledgeSearchQuery(event.target.value)}
                    aria-label="搜索知识"
                    placeholder="搜索知识 / 标签 / 来源 / 工作区"
                    className="h-10 w-full min-w-[220px] rounded-[10px] border border-[#dfe5ee] bg-white pl-9 pr-3 text-sm text-[#111827] outline-none transition-colors placeholder:text-[#93a0b3] focus:border-[#9bbcff] focus:ring-4 focus:ring-[#2f6df6]/10 md:w-[300px] xl:w-[460px]"
                  />
                </div>
                <Button
                  onClick={() => void handleCreateKnowledge()}
                  className="h-10 gap-2 rounded-[10px] bg-[#2f6df6] px-4 text-white shadow-[0_10px_22px_rgba(47,109,246,0.24)] hover:bg-[#245ee8]"
                >
                  <Plus className="h-4 w-4" />
                  新建知识
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            )}
            utility={workspaceShellUtility}
            onOpenCeo={() => activateSection('ceo')}
            onOpenProjects={() => activateSection('projects')}
            onOpenKnowledge={() => activateSection('knowledge')}
            onOpenOps={() => openOpsPanel()}
            onOpenSettings={() => openSettingsPanel()}
          >
            <KnowledgeWorkspace
              selectedId={selectedKnowledgeId}
              searchQuery={knowledgeSearchQuery}
              projects={projects}
              workspaces={departmentWorkspaces}
              refreshSignal={knowledgeRefreshSignal}
              onSelectKnowledge={handleKnowledgeBrowseSelect}
              onTitleChange={handleKnowledgeTitleChange}
              onDeleted={handleKnowledgeDeleted}
            />
          </WorkspaceConceptShell>
        ) : sidebarSection === 'operations' ? (
          <WorkspaceConceptShell
            activeSection="operations"
            title="Ops"
            subtitle="系统运行、调度、资产、连接、配额与执行健康控制面。"
            badges={(
              <>
                <StatusChip tone="accent">运行态</StatusChip>
                <StatusChip tone="info">资产</StatusChip>
                <StatusChip tone={headerActiveRuns.length ? 'warning' : 'success'}>{headerActiveRuns.length ? '运行中' : '静默'}</StatusChip>
              </>
            )}
            actions={(
              <label className="relative flex h-11 min-w-[300px] items-center rounded-[12px] border border-[#dfe5ee] bg-white pl-10 pr-16 text-sm text-[#0f172a] shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
                <Search className="absolute left-3.5 h-4 w-4 text-[#7c8799]" />
                <input
                  value={opsSearchQuery}
                  onChange={(event) => setOpsSearchQuery(event.target.value)}
                  placeholder="筛选当前 Ops 的任务 / 状态 / 服务 / 资产 / 活动"
                  className="h-full w-full bg-transparent outline-none placeholder:text-[#94a3b8]"
                />
                <span className="pointer-events-none absolute right-3 inline-flex h-6 items-center justify-center rounded-[8px] border border-[#dfe5ee] bg-[#f8fafc] px-2 text-[11px] font-semibold text-[#64748b]">
                  本页
                </span>
              </label>
            )}
            utility={workspaceShellUtility}
            onOpenCeo={() => activateSection('ceo')}
            onOpenProjects={() => activateSection('projects')}
            onOpenKnowledge={() => activateSection('knowledge')}
            onOpenOps={() => openOpsPanel()}
            onOpenSettings={() => openSettingsPanel()}
          >
            <OpsDashboard
              searchQuery={opsSearchQuery}
              workspaces={departmentWorkspaces}
              skills={skills}
              workflows={workflows}
              rules={rules}
              discoveredSkills={discoveredSkills}
              discoveredWorkflows={discoveredWorkflows}
              discoveredRules={discoveredRules}
              requestedTab={opsAssetRequest.tab}
              requestedItemName={opsAssetRequest.itemName}
              requestToken={opsAssetRequest.nonce}
              requestedProposalId={opsProposalRequest.proposalId}
              proposalRequestToken={opsProposalRequest.nonce}
              refreshSignal={systemImprovementRefreshSignal}
              onRefreshAssets={() => {
                void loadOperationsAssets(true);
              }}
              onOpenProviderSettings={() => openSettingsPanel({ tab: 'provider', focusTarget: 'third-party-provider' })}
              onOpenApiKeys={() => openSettingsPanel({ tab: 'api-keys' })}
              onNavigateToProject={navigateToProject}
              onOpenImprovementProposal={openSystemImprovementProposal}
            />
          </WorkspaceConceptShell>
        ) : sidebarSection === 'ceo' ? (
          <div className="app-shell-stage relative flex-1 overflow-hidden">
            <CeoOfficeCockpit
              locale={locale}
              connected={connected}
              activeId={activeId}
              activeTitle={activeTitle}
              steps={steps}
              loading={loading}
              isActive={isActive}
              isRunning={isRunning}
              sendError={sendError}
              currentModel={currentModel}
              models={models}
              skills={skills}
              workflows={workflows}
              agenticMode={agenticMode}
              activeRuns={headerActiveRuns}
              pendingApprovals={pendingApprovals}
              projects={projects}
              workspaces={departmentWorkspaces}
              departments={departmentsMap}
              configuredDepartmentCount={configuredDepartmentCount}
              ceoHistory={ceoHistory}
              ceoPriorityTasks={ceoPriorityTasks}
              ceoRecentEvents={ceoRecentEvents}
              refreshSignal={systemImprovementRefreshSignal}
              onCreateCeoConversation={() => void handleCreateCeoConversation('replace')}
              onOpenConversationWorkbench={openConversationWorkbench}
              onOpenProjects={() => activateSection('projects')}
              onOpenKnowledge={() => activateSection('knowledge')}
              onNavigateToKnowledge={navigateToKnowledge}
              onOpenOps={openOpsPanel}
              onOpenImprovementProposal={openSystemImprovementProposal}
              onOpenSettings={() => openSettingsPanel()}
              onSelectConversation={(id, title, targetSection) => handleSelect(id, title, targetSection)}
              onNavigateToProject={navigateToProject}
              onSend={handleSend}
              onCancel={handleCancel}
              onProceed={handleProceed}
              onRevert={allowInlineRevert ? handleRevert : undefined}
              onModelChange={setCurrentModel}
              onAgenticModeChange={setAgenticMode}
              onDepartmentSaved={(uri, config) => {
                setDepartmentsMap(prev => mergeDepartmentConfigIntoWorkspaceMap(prev, uri, config));
              }}
              onRefreshDashboard={() => {
                void loadAgentState(selectedAgentRunId);
              }}
            />
          </div>
        ) : (
          <div className="app-shell-stage relative flex-1 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 agent-grid opacity-25" />
            <div className="relative flex h-full flex-col px-3 pb-3 pt-3 md:px-5 md:pb-5 md:pt-5">
              <div className="chat-stage-panel relative mx-auto flex h-full w-full max-w-[1240px] min-w-0 flex-col overflow-hidden rounded-[32px]">
                <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/24 to-transparent" />

                <div className="chat-stage-content relative min-h-0 flex-1">
                  <Chat
                    steps={steps}
                    loading={loading}
                    currentModel={currentModel}
                    onProceed={handleProceed}
                    onRevert={allowInlineRevert ? handleRevert : undefined}
                    isActive={isActive}
                  />
                </div>

                {activeId ? (
                  <div className="shrink-0 border-t border-[var(--app-border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(247,250,255,0.92)_18%,rgba(247,250,255,1)_100%)] px-3 pb-3 pt-3 md:px-5 md:pb-5 md:pt-4">
                    {sendError ? (
                      <div className="mb-3 flex justify-center">
                        <div className="rounded-full border border-red-400/18 bg-red-400/10 px-4 py-2 text-sm font-medium text-red-100 shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
                          {sendError}
                        </div>
                      </div>
                    ) : null}

                    <ChatInput
                      activeId={activeId}
                      onSend={handleSend}
                      onCancel={handleCancel}
                      disabled={loading}
                      isRunning={isRunning}
                      connected={connected}
                      models={models}
                      currentModel={currentModel}
                      onModelChange={setCurrentModel}
                      skills={skills}
                      workflows={workflows}
                      agenticMode={agenticMode}
                      onAgenticModeChange={setAgenticMode}
                    />
                  </div>
                ) : null}
              </div>
            </div>

          </div>
        )}
      </AppShell>

      {mainMenuOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-[rgba(241,245,251,0.82)] backdrop-blur-sm" onClick={() => setMainMenuOpen(false)} />
          <div className="absolute inset-x-3 bottom-3 top-20 overflow-hidden rounded-[28px] border border-[var(--app-border-soft)] bg-[rgba(255,255,255,0.96)] shadow-[0_28px_80px_rgba(28,44,73,0.14)]">
            <div className="flex items-center justify-between border-b border-[var(--app-border-soft)] px-5 py-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Primary Navigation</div>
                <div className="mt-1 text-lg font-semibold text-[var(--app-text)]">Switch workspace</div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setMainMenuOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-full overflow-y-auto px-4 py-4 pb-10">
              <div className="space-y-3">
                {primaryNavItems.map(item => {
                  const active = item.value === 'settings'
                    ? utilityPanel === 'settings'
                    : utilityPanel === null && sidebarSection === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-3 rounded-[22px] border px-4 py-4 text-left transition-all',
                        active
                          ? 'border-[var(--app-border-strong)] bg-[linear-gradient(135deg,rgba(47,109,246,0.12),rgba(255,255,255,0.96))]'
                          : 'border-[var(--app-border-soft)] bg-[var(--app-surface)] hover:bg-[var(--app-raised)]',
                      )}
                      onClick={() => item.value === 'settings' ? openSettingsPanel() : activateSection(item.value)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[var(--app-text)]">{item.label}</div>
                      </div>
                    </button>
                  );
                })}

              </div>
            </div>
          </div>
        </div>
      ) : null}

      <SystemImprovementDetailDrawer
        open={!!systemImprovementProposalId}
        proposalId={systemImprovementProposalId}
        onOpenChange={handleSystemImprovementDrawerOpenChange}
        onNavigateToProject={navigateToProject}
        onOpenOps={openOpsPanel}
        onRefresh={refreshSystemImprovementViews}
      />
      <LogViewerPanel open={logViewerOpen} onClose={() => setLogViewerOpen(false)} />
      <ActiveTasksPanel
        tasks={visibleActiveTasks}
        onSelect={(id, title) => handleSelect(id, title)}
        onDismiss={(id) => setDismissedTasks(prev => new Set(prev).add(id))}
        activeCascadeId={activeId}
      />
    </>
  );
}
