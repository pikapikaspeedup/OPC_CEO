import type {
  Conversation, UserInfo, Server, Skill, Workflow, Rule,
  McpConfig, StepsData, ModelsResponse, WorkspacesResponse, AnalyticsData,
  KnowledgeItem, KnowledgeDetail, AgentRun, Project,
  ResumeProjectOptions, ResumeProjectResponse, TemplateSummaryFE,
  GenerationResultFE, ConfirmResultFE,
  SubgraphSummaryFE, ResourcePolicyFE, PolicyEvalResultFE,
  JournalEntryFE, CheckpointFE,
  DepartmentConfig,
  DailyDigestFE,
  Deliverable,
  TemplateDetailFE,
  ApprovalRequestFE,
  ApprovalSummaryFE,
  EvolutionProposalFE,
  KnowledgePromotionLevelFE,
  BudgetGateDecisionFE,
  BudgetLedgerDecisionFE,
  BudgetLedgerEntryFE,
  BudgetScopeFE,
  CircuitBreakerFE,
  CircuitBreakerStatusFE,
  CompanyLoopDigestFE,
  CompanyLoopPolicyFE,
  CompanyLoopRunFE,
  CompanyLoopRunKindFE,
  CompanyLoopRunStatusFE,
  CompanyOperatingDayFE,
  GrowthObservationFE,
  GrowthProposalFE,
  GrowthProposalKindFE,
  GrowthProposalRiskFE,
  GrowthProposalStatusFE,
  MemoryCandidateFE,
  MemoryCandidateKindFE,
  MemoryCandidateStatusFE,
  OperatingAgendaItemFE,
  OperatingAgendaPriorityFE,
  OperatingAgendaStatusFE,
  OperatingBudgetPolicyFE,
  OperatingSignalFE,
  OperatingSignalKindFE,
  OperatingSignalSourceFE,
  OperatingSignalStatusFE,
  PaginatedResponse,
  PaginationQueryFE,
  RunCapsuleFE,
  SystemImprovementProposalFE,
  SystemImprovementProposalStatusFE,
  SystemImprovementRiskFE,
  SystemImprovementLaunchResultFE,
  SystemImprovementSeverityFE,
  SystemImprovementSignalFE,
  SystemImprovementSignalSourceFE,
} from './types';

// V4.3 Operations & Observability types
export type HealthStatus = 'running' | 'waiting' | 'blocked' | 'stale' | 'failed' | 'completed';
export type OrchestrationState = 'na' | 'waiting' | 'eligible' | 'completed';

export interface StageDiagnosticsFE {
  stageId: string;
  stageTitle?: string;
  stageType: 'normal' | 'fan-out' | 'join';
  status: string;
  pendingReason?: string;
  waitingOnStageIds?: string[];
  staleSince?: string;
  orchestrationState?: OrchestrationState;
  recommendedActions: string[];
  contractIssues?: string[];
}

export interface BranchDiagnosticsFE {
  parentStageId: string;
  branchIndex: number;
  subProjectId?: string;
  runId?: string;
  status: string;
  health: HealthStatus;
  staleSince?: string;
  failureReason?: string;
  recommendedActions: string[];
}

export interface ProjectDiagnosticsResponse {
  projectId: string;
  projectStatus: string;
  health: HealthStatus;
  activeStageIds: string[];
  canReconcile: boolean;
  summary: string;
  recommendedActions: string[];
  stages: StageDiagnosticsFE[];
  branches: BranchDiagnosticsFE[];
}

export interface GraphNode {
  stageId: string;
  stageTitle?: string;
  stageType: string;
  status: string;
  active: boolean;
  branchCompleted?: number;
  branchTotal?: number;
  /** V5.2: control-flow node kind */
  nodeKind?: 'stage' | 'fan-out' | 'join' | 'gate' | 'switch' | 'loop-start' | 'loop-end' | 'subgraph-ref';
}

export interface GraphEdge {
  from: string;
  to: string;
  /** V5.2: edge label for switch branches or gate outcomes */
  label?: string;
}

export interface ProjectGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ReconcileAction {
  kind: 'dispatch-stage' | 'fan-out' | 'complete-join' | 'sync-status' | 'noop';
  stageId?: string;
  branchIndex?: number;
  detail: string;
}

export interface ReconcileResponse {
  projectId: string;
  dryRun: boolean;
  actions: ReconcileAction[];
}

export interface AuditEvent {
  timestamp: string;
  kind: string;
  projectId?: string;
  stageId?: string;
  branchIndex?: number;
  jobId?: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface SchedulerJobResponse {
  jobId: string;
  name?: string;
  type?: string;
  timeZone?: string;
  action?: { kind: string; [key: string]: unknown };
  executionProfile?: import('./types').ExecutionProfileFE;
  executionProfileSummary?: import('./types').ExecutionProfileSummaryFE;
  enabled?: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string;
  lastRunResult?: string;
  lastRunError?: string;
  createdBy?: 'ceo-command' | 'ceo-workflow' | 'mcp' | 'web' | 'api';
  intentSummary?: string;
  /** OPC: associated department workspace URI */
  departmentWorkspaceUri?: string;
  /** OPC: action to create Ad-hoc project */
  opcAction?: {
    type: 'create_project';
    projectType: 'adhoc';
    goal: string;
    skillHint?: string;
    templateId?: string;
  };
}

export interface ContractLintError {
  severity: 'error';
  stageId: string;
  field: string;
  message: string;
  relatedStageId?: string;
}

export interface ContractLintWarning {
  severity: 'warning';
  stageId: string;
  message: string;
}

export interface LintResponse {
  valid: boolean;
  dagErrors: string[];
  contractErrors: ContractLintError[];
  contractWarnings: ContractLintWarning[];
}

export interface ValidateResponse extends LintResponse {
  format: 'pipeline' | 'graphPipeline';
}

export interface ConvertResponse {
  pipeline?: unknown[];
  graphPipeline?: unknown;
}

export interface CEOSuggestion {
  type:
    | 'use_template'
    | 'create_template'
    | 'reassign_department'
    | 'auto_generate_and_dispatch'
    | 'suggest_add_template'
    | 'schedule_template'
    | 'clarify_department'
    | 'clarify_project'
    | 'clarify_template';
  label: string;
  description: string;
  payload?: Record<string, string>;
}

export interface CEOCommandResult {
  success: boolean;
  action:
    | 'create_project'
    | 'create_scheduler_job'
    | 'dispatch_prompt'
    | 'report_to_human'
    | 'info'
    | 'cancel'
    | 'pause'
    | 'resume'
    | 'retry'
    | 'skip'
    | 'multi_create'
    | 'needs_decision';
  message: string;
  projectId?: string;
  projectIds?: string[];
  runId?: string;
  runIds?: string[];
  jobId?: string;
  nextRunAt?: string | null;
  suggestions?: CEOSuggestion[];
}

const API = (
  process.env.NEXT_PUBLIC_API_BASE_URL
  || process.env.AG_PUBLIC_API_BASE_URL
  || (typeof window !== 'undefined' ? window.location.origin : '')
);

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${url}`, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    const contentType = res.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        const payload = await res.json() as { error?: string; message?: string };
        message = payload.error || payload.message || message;
      } else {
        const text = await res.text();
        if (text.trim()) {
          message = text.trim();
        }
      }
    } catch {
      // fall back to status text
    }
    throw new Error(message);
  }
  return res.json();
}

function appendPaginationParams(
  searchParams: URLSearchParams,
  pagination?: PaginationQueryFE,
): void {
  if (pagination?.page) {
    searchParams.set('page', String(pagination.page));
  }
  if (pagination?.pageSize) {
    searchParams.set('pageSize', String(pagination.pageSize));
  }
}

async function fetchPaginatedJson<T>(url: string, init?: RequestInit): Promise<PaginatedResponse<T>> {
  return fetchJson<PaginatedResponse<T>>(url, init);
}

async function fetchAllPaginated<T>(
  buildUrl: (page: number) => string,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  for (;;) {
    const response = await fetchPaginatedJson<T>(buildUrl(page));
    items.push(...(response.items || []));
    if (!response.hasMore) {
      break;
    }
    page += 1;
  }

  return items;
}

export const api = {
  me: () => fetchJson<UserInfo>('/api/me'),
  models: () => fetchJson<ModelsResponse>('/api/models'),
  aiConfig: () => fetchJson<{ defaultProvider: string; layers?: Record<string, { provider?: string }> }>('/api/ai-config'),
  servers: () => fetchJson<Server[]>('/api/servers'),
  workspaces: () => fetchJson<WorkspacesResponse>('/api/workspaces'),
  conversations: async (params?: { workspace?: string } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.workspace) search.set('workspace', params.workspace);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 200,
    });
    const qs = search.toString();
    const result = await fetchPaginatedJson<Conversation>(`/api/conversations${qs ? `?${qs}` : ''}`);
    return result.items ?? [];
  },
  conversationSteps: (id: string) => fetchJson<StepsData>(`/api/conversations/${id}/steps`),
  skills: () => fetchJson<Skill[]>('/api/skills'),
  discoveredSkills: () => fetchJson<Skill[]>('/api/skills/discovered'),
  workflows: () => fetchJson<Workflow[]>('/api/workflows'),
  discoveredWorkflows: () => fetchJson<Workflow[]>('/api/workflows/discovered'),
  rules: () => fetchJson<Rule[]>('/api/rules'),
  discoveredRules: () => fetchJson<Rule[]>('/api/rules/discovered'),

  // Workflow CRUD
  workflowDetail: (name: string) =>
    fetchJson<{ name: string; content: string }>(`/api/workflows/${encodeURIComponent(name)}`),
  deleteWorkflow: (name: string) =>
    fetchJson<{ success: boolean; name: string }>(`/api/workflows/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Skill CRUD
  skillDetail: (name: string) =>
    fetchJson<Record<string, unknown>>(`/api/skills/${encodeURIComponent(name)}`),
  updateSkill: (name: string, content: string) =>
    fetchJson<{ success: boolean; name: string }>(`/api/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  deleteSkill: (name: string) =>
    fetchJson<{ success: boolean; name: string }>(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Rule CRUD
  ruleDetail: (name: string) =>
    fetchJson<{ name: string; content: string }>(`/api/rules/${encodeURIComponent(name)}`),
  updateRule: (name: string, content: string) =>
    fetchJson<{ success: boolean; name: string }>(`/api/rules/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  deleteRule: (name: string) =>
    fetchJson<{ success: boolean; name: string }>(`/api/rules/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  mcp: () => fetchJson<McpConfig>('/api/mcp'),
  analytics: () => fetchJson<AnalyticsData>('/api/analytics'),
  conversationFiles: (id: string, q: string) => fetchJson<{ files: unknown[] }>(`/api/conversations/${id}/files?q=${encodeURIComponent(q)}`),

  createConversation: (workspace: string) =>
    fetchJson<{ cascadeId?: string; error?: string }>('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    }),

  sendMessage: (id: string, text: string, model?: string, agenticMode: boolean = true, attachments?: unknown) =>
    fetchJson<{ ok: boolean }>(`/api/conversations/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model, agenticMode, attachments }),
    }),

  proceed: (id: string, artifactUri: string, model?: string) =>
    fetchJson<{ ok: boolean }>(`/api/conversations/${id}/proceed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifactUri, model }),
    }),

  cancel: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/conversations/${id}/cancel`, {
      method: 'POST',
    }),

  revert: (id: string, stepIndex: number, model?: string) =>
    fetchJson<{ ok: boolean }>(`/api/conversations/${id}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepIndex, model }),
    }),

  getRevertPreview: (id: string, stepIndex: number, model?: string) =>
    fetchJson<unknown>(`/api/conversations/${id}/revert-preview?stepIndex=${stepIndex}${model ? `&model=${encodeURIComponent(model)}` : ''}`),

  launchWorkspace: (workspace: string) =>
    fetchJson<{ ok: boolean; error?: string }>('/api/workspaces/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    }),

  importWorkspace: (workspace: string) =>
    fetchJson<{ ok: boolean; workspace: { name: string; uri: string } }>('/api/workspaces/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    }),

  closeWorkspace: (workspace: string) =>
    fetchJson<{ ok: boolean; error?: string }>('/api/workspaces/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    }),

  killWorkspace: (workspace: string) =>
    fetchJson<{ ok: boolean; error?: string }>('/api/workspaces/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    }),

  // OPC: Department config
  getDepartment: (workspaceUri: string) =>
    fetchJson<DepartmentConfig>(`/api/departments?workspace=${encodeURIComponent(workspaceUri)}`),
  updateDepartment: (workspaceUri: string, config: DepartmentConfig) =>
    fetchJson<{ ok: boolean; syncPending?: boolean }>(`/api/departments?workspace=${encodeURIComponent(workspaceUri)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),
  syncDepartment: (workspaceUri: string, target: string = 'all') =>
    fetchJson<{ ok: boolean }>(`/api/departments/sync?workspace=${encodeURIComponent(workspaceUri)}&target=${encodeURIComponent(target)}`, {
      method: 'POST',
    }),
  getDepartmentMemory: (workspaceUri: string, scope: 'department' | 'organization' = 'department') =>
    fetchJson<{ scope: string; workspace?: string; memory?: Record<string, string>; content?: string }>(
      `/api/departments/memory?workspace=${encodeURIComponent(workspaceUri)}&scope=${scope}`,
    ),
  addDepartmentMemory: (workspaceUri: string, category: string, content: string, source?: string) =>
    fetchJson<{ ok: boolean }>(`/api/departments/memory?workspace=${encodeURIComponent(workspaceUri)}&category=${category}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, source: source || 'manual' }),
    }),
  getDepartmentQuota: (workspaceUri: string) =>
    fetchJson<{ workspace: string; quota: { daily: number; monthly: number; used: { daily: number; monthly: number }; canRequestMore: boolean } }>(
      `/api/departments/quota?workspace=${encodeURIComponent(workspaceUri)}`,
    ),
  tunnelStatus: () =>
    fetchJson<{ running: boolean; starting: boolean; url: string | null; error: string | null; configured: boolean; config: unknown }>(
      '/api/tunnel',
    ),
  tunnelStart: () =>
    fetchJson<{ success: boolean; url?: string; error?: string }>(
      '/api/tunnel/start',
      { method: 'POST' },
    ),
  tunnelStop: () =>
    fetchJson<{ success: boolean }>(
      '/api/tunnel/stop',
      { method: 'POST' },
    ),

  tunnelSaveConfig: (config: { tunnelName: string; url: string; credentialsPath?: string; autoStart?: boolean }) =>
    fetchJson<{ success: boolean; config: typeof config }>(
      '/api/tunnel/config',
      { method: 'POST', body: JSON.stringify(config) },
    ),

  // OPC: Codex integration
  codexExec: (params: { prompt: string; cwd?: string; model?: string; sandbox?: string; timeoutMs?: number }) =>
    fetchJson<{ output: string }>(
      '/api/codex',
      { method: 'POST', body: JSON.stringify(params) },
    ),
  codexCreateSession: (params: { prompt: string; cwd?: string; model?: string; sandbox?: string; approvalPolicy?: string }) =>
    fetchJson<{ threadId: string; content: string }>(
      '/api/codex/sessions',
      { method: 'POST', body: JSON.stringify(params) },
    ),
  codexReply: (threadId: string, prompt: string) =>
    fetchJson<{ threadId: string; content: string }>(
      `/api/codex/sessions/${encodeURIComponent(threadId)}`,
      { method: 'POST', body: JSON.stringify({ prompt }) },
    ),

  // OPC: Daily digest
  getDailyDigest: (workspaceUri: string, date?: string, period?: 'day' | 'week' | 'month') => {
    const params = new URLSearchParams({ workspace: workspaceUri });
    if (date) params.set('date', date);
    if (period) params.set('period', period);
    return fetchJson<DailyDigestFE>(`/api/departments/digest?${params}`);
  },

  // OPC: Deliverables
  getDeliverables: async (projectId: string, pagination?: PaginationQueryFE) => {
    const search = new URLSearchParams();
    appendPaginationParams(search, {
      page: pagination?.page,
      pageSize: pagination?.pageSize ?? 200,
    });
    const qs = search.toString();
    const result = await fetchPaginatedJson<Deliverable>(
      `/api/projects/${encodeURIComponent(projectId)}/deliverables${qs ? `?${qs}` : ''}`,
    );
    return result.items ?? [];
  },
  createDeliverable: (projectId: string, data: { stageId: string; type: string; title: string; artifactPath?: string }) =>
    fetchJson<Deliverable>(`/api/projects/${encodeURIComponent(projectId)}/deliverables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // Knowledge Items
  knowledge: (params?: {
    workspace?: string;
    category?: string;
    status?: string;
    scope?: 'department' | 'organization';
    tag?: string;
    q?: string;
    sort?: 'recent' | 'created' | 'updated' | 'alpha' | 'reuse';
    limit?: number;
  }) => {
    const search = new URLSearchParams();
    if (params?.workspace) search.set('workspace', params.workspace);
    if (params?.category) search.set('category', params.category);
    if (params?.status) search.set('status', params.status);
    if (params?.scope) search.set('scope', params.scope);
    if (params?.tag) search.set('tag', params.tag);
    if (params?.q) search.set('q', params.q);
    if (params?.sort) search.set('sort', params.sort);
    if (typeof params?.limit === 'number') search.set('limit', String(params.limit));
    const qs = search.toString();
    return fetchJson<KnowledgeItem[]>(`/api/knowledge${qs ? `?${qs}` : ''}`);
  },
  knowledgeDetail: (id: string) => fetchJson<KnowledgeDetail>(`/api/knowledge/${encodeURIComponent(id)}`),
  createKnowledge: (data: {
    title?: string;
    summary?: string;
    content?: string;
    workspaceUri?: string;
    category?: string;
    tags?: string[];
  }) =>
    fetchJson<KnowledgeDetail>(`/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  updateKnowledge: (id: string, data: { title?: string; summary?: string }) =>
    fetchJson<{ ok: boolean }>(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteKnowledge: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateKnowledgeArtifact: (id: string, path: string, content: string) =>
    fetchJson<{ ok: boolean }>(`/api/knowledge/${encodeURIComponent(id)}/artifacts/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  generateKnowledgeSummary: (id: string) =>
    fetchJson<{ ok: boolean; summary: string; provider: string; model?: string; source: string; scene: string }>(
      `/api/knowledge/${encodeURIComponent(id)}/summary`,
      { method: 'POST' },
    ),

  // Company Kernel
  companyRunCapsules: (params?: {
    workspaceUri?: string;
    projectId?: string;
    status?: string;
    providerId?: string;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.workspaceUri) search.set('workspaceUri', params.workspaceUri);
    if (params?.projectId) search.set('projectId', params.projectId);
    if (params?.status) search.set('status', params.status);
    if (params?.providerId) search.set('providerId', params.providerId);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<RunCapsuleFE>(`/api/company/run-capsules${qs ? `?${qs}` : ''}`);
  },
  companyRunCapsule: (runId: string) =>
    fetchJson<RunCapsuleFE>(`/api/company/run-capsules/${encodeURIComponent(runId)}`),
  companyMemoryCandidates: (params?: {
    workspaceUri?: string;
    sourceRunId?: string;
    sourceCapsuleId?: string;
    kind?: MemoryCandidateKindFE;
    status?: MemoryCandidateStatusFE;
    minScore?: number;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.workspaceUri) search.set('workspaceUri', params.workspaceUri);
    if (params?.sourceRunId) search.set('sourceRunId', params.sourceRunId);
    if (params?.sourceCapsuleId) search.set('sourceCapsuleId', params.sourceCapsuleId);
    if (params?.kind) search.set('kind', params.kind);
    if (params?.status) search.set('status', params.status);
    if (typeof params?.minScore === 'number') search.set('minScore', String(params.minScore));
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<MemoryCandidateFE>(`/api/company/memory-candidates${qs ? `?${qs}` : ''}`);
  },
  companyMemoryCandidate: (id: string) =>
    fetchJson<MemoryCandidateFE>(`/api/company/memory-candidates/${encodeURIComponent(id)}`),
  promoteCompanyMemoryCandidate: (id: string, payload?: {
    title?: string;
    content?: string;
    category?: MemoryCandidateKindFE;
    level?: KnowledgePromotionLevelFE;
  }) =>
    fetchJson<{ knowledge: unknown }>(`/api/company/memory-candidates/${encodeURIComponent(id)}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
  rejectCompanyMemoryCandidate: (id: string, reason: string) =>
    fetchJson<{ candidate: MemoryCandidateFE }>(`/api/company/memory-candidates/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
  companySignals: (params?: {
    workspaceUri?: string;
    source?: OperatingSignalSourceFE;
    kind?: OperatingSignalKindFE;
    status?: OperatingSignalStatusFE;
    minScore?: number;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.workspaceUri) search.set('workspaceUri', params.workspaceUri);
    if (params?.source) search.set('source', params.source);
    if (params?.kind) search.set('kind', params.kind);
    if (params?.status) search.set('status', params.status);
    if (typeof params?.minScore === 'number') search.set('minScore', String(params.minScore));
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<OperatingSignalFE>(`/api/company/signals${qs ? `?${qs}` : ''}`);
  },
  companySignal: (id: string) =>
    fetchJson<OperatingSignalFE>(`/api/company/signals/${encodeURIComponent(id)}`),
  dismissCompanySignal: (id: string) =>
    fetchJson<{ signal: OperatingSignalFE }>(`/api/company/signals/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
    }),
  companyAgenda: (params?: {
    workspaceUri?: string;
    status?: OperatingAgendaStatusFE;
    priority?: OperatingAgendaPriorityFE;
    minScore?: number;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.workspaceUri) search.set('workspaceUri', params.workspaceUri);
    if (params?.status) search.set('status', params.status);
    if (params?.priority) search.set('priority', params.priority);
    if (typeof params?.minScore === 'number') search.set('minScore', String(params.minScore));
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<OperatingAgendaItemFE>(`/api/company/agenda${qs ? `?${qs}` : ''}`);
  },
  companyAgendaItem: (id: string) =>
    fetchJson<OperatingAgendaItemFE>(`/api/company/agenda/${encodeURIComponent(id)}`),
  dismissCompanyAgendaItem: (id: string) =>
    fetchJson<{ item: OperatingAgendaItemFE }>(`/api/company/agenda/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
    }),
  snoozeCompanyAgendaItem: (id: string, payload?: { snoozedUntil?: string; minutes?: number }) =>
    fetchJson<{ item: OperatingAgendaItemFE }>(`/api/company/agenda/${encodeURIComponent(id)}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
  dispatchCheckCompanyAgendaItem: (id: string, payload?: {
    scope?: BudgetScopeFE;
    scopeId?: string;
    schedulerJobId?: string;
    proposalId?: string;
  }) =>
    fetchJson<{ decision: BudgetGateDecisionFE }>(`/api/company/agenda/${encodeURIComponent(id)}/dispatch-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
  dispatchCompanyAgendaItem: (id: string, payload?: {
    scope?: BudgetScopeFE;
    scopeId?: string;
    schedulerJobId?: string;
    proposalId?: string;
    prompt?: string;
    model?: string;
  }) =>
    fetchJson<{
      decision: BudgetGateDecisionFE;
      ledger: BudgetLedgerEntryFE;
      item: OperatingAgendaItemFE | null;
      run: AgentRun;
    }>(`/api/company/agenda/${encodeURIComponent(id)}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
  companyOperatingDay: (params?: { date?: string; timezone?: string; workspaceUri?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.date) search.set('date', params.date);
    if (params?.timezone) search.set('timezone', params.timezone);
    if (params?.workspaceUri) search.set('workspaceUri', params.workspaceUri);
    if (typeof params?.limit === 'number') search.set('limit', String(params.limit));
    const qs = search.toString();
    return fetchJson<CompanyOperatingDayFE>(`/api/company/operating-day${qs ? `?${qs}` : ''}`);
  },
  companyBudgetPolicies: (params?: {
    scope?: BudgetScopeFE;
    scopeId?: string;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.scope) search.set('scope', params.scope);
    if (params?.scopeId) search.set('scopeId', params.scopeId);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<OperatingBudgetPolicyFE>(`/api/company/budget/policies${qs ? `?${qs}` : ''}`);
  },
  updateCompanyBudgetPolicy: (id: string, payload: Partial<OperatingBudgetPolicyFE>) =>
    fetchJson<{ policy: OperatingBudgetPolicyFE }>(`/api/company/budget/policies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  companyBudgetLedger: (params?: {
    scope?: BudgetScopeFE;
    scopeId?: string;
    policyId?: string;
    decision?: BudgetLedgerDecisionFE;
    agendaItemId?: string;
    runId?: string;
    schedulerJobId?: string;
    proposalId?: string;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.scope) search.set('scope', params.scope);
    if (params?.scopeId) search.set('scopeId', params.scopeId);
    if (params?.policyId) search.set('policyId', params.policyId);
    if (params?.decision) search.set('decision', params.decision);
    if (params?.agendaItemId) search.set('agendaItemId', params.agendaItemId);
    if (params?.runId) search.set('runId', params.runId);
    if (params?.schedulerJobId) search.set('schedulerJobId', params.schedulerJobId);
    if (params?.proposalId) search.set('proposalId', params.proposalId);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<BudgetLedgerEntryFE>(`/api/company/budget/ledger${qs ? `?${qs}` : ''}`);
  },
  companyCircuitBreakers: (params?: {
    scope?: BudgetScopeFE | 'provider' | 'workflow';
    scopeId?: string;
    status?: CircuitBreakerStatusFE;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.scope) search.set('scope', params.scope);
    if (params?.scopeId) search.set('scopeId', params.scopeId);
    if (params?.status) search.set('status', params.status);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<CircuitBreakerFE>(`/api/company/circuit-breakers${qs ? `?${qs}` : ''}`);
  },
  resetCompanyCircuitBreaker: (id: string) =>
    fetchJson<{ breaker: CircuitBreakerFE }>(`/api/company/circuit-breakers/${encodeURIComponent(id)}/reset`, {
      method: 'POST',
    }),
  companyGrowthProposals: (params?: {
    workspaceUri?: string;
    kind?: GrowthProposalKindFE;
    status?: GrowthProposalStatusFE;
    risk?: GrowthProposalRiskFE;
    minScore?: number;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.workspaceUri) search.set('workspaceUri', params.workspaceUri);
    if (params?.kind) search.set('kind', params.kind);
    if (params?.status) search.set('status', params.status);
    if (params?.risk) search.set('risk', params.risk);
    if (typeof params?.minScore === 'number') search.set('minScore', String(params.minScore));
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<GrowthProposalFE>(`/api/company/growth/proposals${qs ? `?${qs}` : ''}`);
  },
  generateCompanyGrowthProposals: (payload?: { workspaceUri?: string; limit?: number }) =>
    fetchJson<{ proposals: GrowthProposalFE[]; decision?: BudgetGateDecisionFE; ledger?: BudgetLedgerEntryFE }>('/api/company/growth/proposals/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
  companyGrowthProposal: (id: string) =>
    fetchJson<GrowthProposalFE>(`/api/company/growth/proposals/${encodeURIComponent(id)}`),
  evaluateCompanyGrowthProposal: (id: string) =>
    fetchJson<{ proposal: GrowthProposalFE; decision?: BudgetGateDecisionFE; ledger?: BudgetLedgerEntryFE }>(`/api/company/growth/proposals/${encodeURIComponent(id)}/evaluate`, {
      method: 'POST',
    }),
  approveCompanyGrowthProposal: (id: string) =>
    fetchJson<{ proposal: GrowthProposalFE }>(`/api/company/growth/proposals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    }),
  rejectCompanyGrowthProposal: (id: string, reason?: string) =>
    fetchJson<{ proposal: GrowthProposalFE }>(`/api/company/growth/proposals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
  dryRunCompanyGrowthProposal: (id: string) =>
    fetchJson<{ proposal: GrowthProposalFE; dryRun?: { status?: string; reasons?: string[] } }>(`/api/company/growth/proposals/${encodeURIComponent(id)}/dry-run`, {
      method: 'POST',
    }),
  publishCompanyGrowthProposal: (id: string) =>
    fetchJson<{ proposal: GrowthProposalFE }>(`/api/company/growth/proposals/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
    }),
  companyGrowthObservations: (params?: { proposalId?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.proposalId) search.set('proposalId', params.proposalId);
    if (typeof params?.limit === 'number') search.set('limit', String(params.limit));
    const qs = search.toString();
    return fetchJson<{ observations: GrowthObservationFE[] }>(`/api/company/growth/observations${qs ? `?${qs}` : ''}`);
  },
  observeCompanyGrowthProposal: (proposalId: string) =>
    fetchJson<{ observation: GrowthObservationFE }>('/api/company/growth/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId }),
    }),
  companyLoopPolicies: (params?: {
    scope?: CompanyLoopPolicyFE['scope'];
    scopeId?: string;
    enabled?: boolean;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.scope) search.set('scope', params.scope);
    if (params?.scopeId) search.set('scopeId', params.scopeId);
    if (typeof params?.enabled === 'boolean') search.set('enabled', String(params.enabled));
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<CompanyLoopPolicyFE>(`/api/company/loops/policies${qs ? `?${qs}` : ''}`);
  },
  updateCompanyLoopPolicy: (id: string, payload: Partial<CompanyLoopPolicyFE>) =>
    fetchJson<{ policy: CompanyLoopPolicyFE }>(`/api/company/loops/policies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  companyLoopRuns: (params?: {
    policyId?: string;
    kind?: CompanyLoopRunKindFE;
    status?: CompanyLoopRunStatusFE;
    date?: string;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.policyId) search.set('policyId', params.policyId);
    if (params?.kind) search.set('kind', params.kind);
    if (params?.status) search.set('status', params.status);
    if (params?.date) search.set('date', params.date);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<CompanyLoopRunFE>(`/api/company/loops/runs${qs ? `?${qs}` : ''}`);
  },
  companyLoopRun: (id: string) =>
    fetchJson<CompanyLoopRunFE>(`/api/company/loops/runs/${encodeURIComponent(id)}`),
  runCompanyLoopNow: (payload?: { policyId?: string; kind?: CompanyLoopRunKindFE; date?: string; timezone?: string }) =>
    fetchJson<{
      run: CompanyLoopRunFE;
      digestId?: string;
      selectedAgenda: OperatingAgendaItemFE[];
      skipped: Array<{ item: OperatingAgendaItemFE; reason: string }>;
      budgetLedger: BudgetLedgerEntryFE[];
      generatedProposals: GrowthProposalFE[];
    }>('/api/company/loops/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
  retryCompanyLoopRun: (id: string) =>
    fetchJson<{ run: CompanyLoopRunFE }>(`/api/company/loops/runs/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    }),
  companyLoopDigests: (params?: { loopRunId?: string; date?: string } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.loopRunId) search.set('loopRunId', params.loopRunId);
    if (params?.date) search.set('date', params.date);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<CompanyLoopDigestFE>(`/api/company/loops/digests${qs ? `?${qs}` : ''}`);
  },
  companyLoopDigest: (id: string) =>
    fetchJson<CompanyLoopDigestFE>(`/api/company/loops/digests/${encodeURIComponent(id)}`),
  systemImprovementSignals: (params?: {
    source?: SystemImprovementSignalSourceFE;
    severity?: SystemImprovementSeverityFE;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.source) search.set('source', params.source);
    if (params?.severity) search.set('severity', params.severity);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<SystemImprovementSignalFE>(`/api/company/self-improvement/signals${qs ? `?${qs}` : ''}`);
  },
  createSystemImprovementSignal: (payload: Partial<SystemImprovementSignalFE> & { title: string; summary: string; source: SystemImprovementSignalSourceFE }) =>
    fetchJson<{ signal: SystemImprovementSignalFE }>('/api/company/self-improvement/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  systemImprovementProposals: (params?: {
    status?: SystemImprovementProposalStatusFE;
    risk?: SystemImprovementRiskFE;
  } & PaginationQueryFE) => {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.risk) search.set('risk', params.risk);
    appendPaginationParams(search, {
      page: params?.page,
      pageSize: params?.pageSize ?? 20,
    });
    const qs = search.toString();
    return fetchPaginatedJson<SystemImprovementProposalFE>(`/api/company/self-improvement/proposals${qs ? `?${qs}` : ''}`);
  },
  generateSystemImprovementProposal: (payload: { signalIds: string[]; title?: string; summary?: string; affectedFiles?: string[] }) =>
    fetchJson<{ proposal: SystemImprovementProposalFE }>('/api/company/self-improvement/proposals/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  systemImprovementProposal: (id: string) =>
    fetchJson<SystemImprovementProposalFE>(`/api/company/self-improvement/proposals/${encodeURIComponent(id)}`),
  evaluateSystemImprovementProposal: (id: string) =>
    fetchJson<{ proposal: SystemImprovementProposalFE }>(`/api/company/self-improvement/proposals/${encodeURIComponent(id)}/evaluate`, {
      method: 'POST',
    }),
  approveSystemImprovementProposal: (id: string) =>
    fetchJson<{ proposal: SystemImprovementProposalFE; launch: SystemImprovementLaunchResultFE | null }>(`/api/company/self-improvement/proposals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    }),
  rejectSystemImprovementProposal: (id: string, reason?: string) =>
    fetchJson<{ proposal: SystemImprovementProposalFE }>(`/api/company/self-improvement/proposals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
  attachSystemImprovementTestEvidence: (id: string, payload: { command: string; status: 'passed' | 'failed'; outputSummary: string }) =>
    fetchJson<{ proposal: SystemImprovementProposalFE }>(`/api/company/self-improvement/proposals/${encodeURIComponent(id)}/attach-test-evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  observeSystemImprovementProposal: (id: string, payload: { summary: string; linkedRunIds?: string[]; metadata?: Record<string, unknown> }) =>
    fetchJson<{ proposal: SystemImprovementProposalFE }>(`/api/company/self-improvement/proposals/${encodeURIComponent(id)}/observe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  // CEO / Management
  ceoProfile: () => fetchJson<import('./types').CEOProfileFE>('/api/ceo/profile'),
  updateCeoProfile: (patch: Partial<import('./types').CEOProfileFE>) =>
    fetchJson<import('./types').CEOProfileFE>('/api/ceo/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  appendCeoFeedback: (payload: { content: string; type?: 'correction' | 'approval' | 'rejection' | 'preference' }) =>
    fetchJson<import('./types').CEOProfileFE>('/api/ceo/profile/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  ceoRoutine: () => fetchJson<import('./types').CEORoutineSummaryFE>('/api/ceo/routine'),
  ceoEvents: (limit = 20) =>
    fetchJson<{ events: import('./types').CEOEvent[] }>(`/api/ceo/events?limit=${limit}`),
  managementOverview: (workspaceUri?: string) =>
    fetchJson<import('./types').ManagementOverviewFE | import('./types').DepartmentManagementOverviewFE>(
      `/api/management/overview${workspaceUri ? `?workspace=${encodeURIComponent(workspaceUri)}` : ''}`,
    ),

  // Agent Runs & Projects
  projects: async (pagination?: PaginationQueryFE) => {
    const params = new URLSearchParams();
    appendPaginationParams(params, {
      page: pagination?.page,
      pageSize: pagination?.pageSize ?? 200,
    });
    const qs = params.toString();
    const result = await fetchPaginatedJson<Project>(`/api/projects${qs ? `?${qs}` : ''}`);
    return result.items ?? [];
  },
  agentRuns: async (status?: string, pagination?: PaginationQueryFE) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    appendPaginationParams(params, {
      page: pagination?.page,
      pageSize: pagination?.pageSize ?? 100,
    });
    const qs = params.toString();
    const result = await fetchPaginatedJson<AgentRun>(`/api/agent-runs${qs ? `?${qs}` : ''}`);
    return result.items ?? [];
  },
  agentRunsByFilter: async (
    filter: { stageId?: string; status?: string; reviewOutcome?: string; schedulerJobId?: string; projectId?: string; executorKind?: string },
    pagination?: PaginationQueryFE,
  ) => {
    const params = new URLSearchParams();
    if (filter.stageId) params.set('stageId', filter.stageId);
    if (filter.status) params.set('status', filter.status);
    if (filter.reviewOutcome) params.set('reviewOutcome', filter.reviewOutcome);
    if (filter.schedulerJobId) params.set('schedulerJobId', filter.schedulerJobId);
    if (filter.projectId) params.set('projectId', filter.projectId);
    if (filter.executorKind) params.set('executorKind', filter.executorKind);
    appendPaginationParams(params, {
      page: pagination?.page,
      pageSize: pagination?.pageSize ?? 100,
    });
    const result = await fetchPaginatedJson<AgentRun>(`/api/agent-runs?${params.toString()}`);
    return result.items ?? [];
  },
  agentRunsByFilterAll: async (
    filter: { stageId?: string; status?: string; reviewOutcome?: string; schedulerJobId?: string; projectId?: string; executorKind?: string },
    pagination?: Omit<PaginationQueryFE, 'page'>,
  ) => {
    const pageSize = pagination?.pageSize ?? 100;
    return fetchAllPaginated<AgentRun>((page) => {
      const params = new URLSearchParams();
      if (filter.stageId) params.set('stageId', filter.stageId);
      if (filter.status) params.set('status', filter.status);
      if (filter.reviewOutcome) params.set('reviewOutcome', filter.reviewOutcome);
      if (filter.schedulerJobId) params.set('schedulerJobId', filter.schedulerJobId);
      if (filter.projectId) params.set('projectId', filter.projectId);
      if (filter.executorKind) params.set('executorKind', filter.executorKind);
      appendPaginationParams(params, { page, pageSize });
      return `/api/agent-runs?${params.toString()}`;
    });
  },
  agentRun: (id: string) => fetchJson<AgentRun>(`/api/agent-runs/${id}`),
  agentRunConversation: (id: string) => fetchJson<import('./types').RunConversationFE>(`/api/agent-runs/${id}/conversation`),
  dispatchRun: (input: {
    templateId?: string;
    stageId?: string;
    projectId?: string;
    workspace: string;
    prompt?: string;
    model?: string;
    pipelineStageId?: string;
    taskEnvelope?: import('./types').TaskEnvelopeFE;
    sourceRunIds?: string[];
    conversationMode?: 'shared' | 'isolated';
    executionTarget?: import('./types').ExecutionTargetFE;
    triggerContext?: import('./types').TriggerContextFE;
  }) =>
    fetchJson<{ runId: string; status: string }>('/api/agent-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  createPromptRun: (input: {
    workspace: string;
    prompt: string;
    projectId?: string;
    model?: string;
    parentConversationId?: string;
    conversationMode?: 'shared' | 'isolated';
    promptAssetRefs?: string[];
    skillHints?: string[];
    triggerContext?: import('./types').TriggerContextFE;
  }) =>
    fetchJson<{ runId: string; status: string }>('/api/agent-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace: input.workspace,
        prompt: input.prompt,
        projectId: input.projectId,
        model: input.model,
        parentConversationId: input.parentConversationId,
        conversationMode: input.conversationMode,
        triggerContext: input.triggerContext,
        executionTarget: {
          kind: 'prompt',
          ...(input.promptAssetRefs?.length ? { promptAssetRefs: input.promptAssetRefs } : {}),
          ...(input.skillHints?.length ? { skillHints: input.skillHints } : {}),
        },
      }),
    }),
  cancelRun: (id: string) =>
    fetchJson<{ status: string }>(`/api/agent-runs/${id}`, { method: 'DELETE' }),
  interveneRun: (id: string, data: { action: 'nudge' | 'retry' | 'restart_role' | 'cancel' | 'evaluate', prompt?: string, roleId?: string }) =>
    fetchJson<{ status: string; action: string; runId: string }>(`/api/agent-runs/${id}/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // Pipeline templates
  pipelines: () => fetchJson<TemplateSummaryFE[]>('/api/pipelines'),

  pipelineDetail: (id: string) =>
    fetchJson<TemplateDetailFE>(`/api/pipelines/${encodeURIComponent(id)}`),

  updatePipeline: (id: string, data: Record<string, unknown>) =>
    fetchJson<{ success: boolean; templateId: string }>(`/api/pipelines/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deletePipeline: (id: string) =>
    fetchJson<{ success: boolean; templateId: string }>(`/api/pipelines/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  clonePipeline: (id: string, newId: string, newTitle?: string) =>
    fetchJson<{ success: boolean; templateId: string }>(`/api/pipelines/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newId, newTitle }),
    }),

  updateWorkflow: (name: string, content: string) =>
    fetchJson<{ success: boolean; name: string }>(`/api/workflows/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),

  lintTemplate: (templateId: string) =>
    fetchJson<LintResponse>('/api/pipelines/lint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId }),
    }),

  validateTemplate: (input: { templateId?: string; template?: unknown }) =>
    fetchJson<ValidateResponse>('/api/pipelines/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  convertTemplate: (input: { direction: 'pipeline-to-graph' | 'graph-to-pipeline'; pipeline?: unknown[]; graphPipeline?: unknown }) =>
    fetchJson<ConvertResponse>('/api/pipelines/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  // Project Management
  createProject: (data: { name: string; goal: string; templateId?: string; workspace: string; projectType?: 'coordinated' | 'adhoc' | 'strategic'; skillHint?: string; governance?: Project['governance'] }) =>
    fetchJson<Project>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  updateProject: (id: string, data: Partial<Project>) =>
    fetchJson<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteProject: (id: string) =>
    fetchJson<{ success: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  // Resume a failed pipeline stage
  resumeProject: (projectId: string, options: ResumeProjectOptions) =>
    fetchJson<ResumeProjectResponse>(`/api/projects/${projectId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }),

  // Operations & Observability (V4.3)
  projectDiagnostics: (projectId: string) =>
    fetchJson<ProjectDiagnosticsResponse>(`/api/projects/${projectId}/diagnostics`),

  projectGraph: (projectId: string) =>
    fetchJson<ProjectGraphResponse>(`/api/projects/${projectId}/graph`),

  // V5.2: Gate approval
  gateApprove: (projectId: string, nodeId: string, input: { action: 'approve' | 'reject'; reason?: string; approvedBy?: string }) =>
    fetchJson<{ nodeId: string; action: string; timestamp: string }>(`/api/projects/${encodeURIComponent(projectId)}/gate/${encodeURIComponent(nodeId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  reconcileProject: (projectId: string, dryRun: boolean = true) =>
    fetchJson<ReconcileResponse>(`/api/projects/${projectId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    }),

  auditEvents: async (params?: { kind?: string; projectId?: string; since?: string; until?: string; limit?: number; page?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.kind) searchParams.set('kind', params.kind);
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    if (params?.since) searchParams.set('since', params.since);
    if (params?.until) searchParams.set('until', params.until);
    appendPaginationParams(searchParams, {
      page: params?.page,
      pageSize: params?.limit ?? 100,
    });
    const result = await fetchPaginatedJson<AuditEvent>(`/api/operations/audit?${searchParams.toString()}`);
    return result.items ?? [];
  },

  schedulerJobs: async (pagination?: PaginationQueryFE) => {
    const searchParams = new URLSearchParams();
    appendPaginationParams(searchParams, {
      page: pagination?.page,
      pageSize: pagination?.pageSize ?? 100,
    });
    const qs = searchParams.toString();
    const result = await fetchPaginatedJson<SchedulerJobResponse>(`/api/scheduler/jobs${qs ? `?${qs}` : ''}`);
    return result.items ?? [];
  },

  createSchedulerJob: (data: {
    name: string;
    type: 'cron' | 'interval' | 'once';
    cronExpression?: string;
    timeZone?: string;
    intervalMs?: number;
    scheduledAt?: string;
    action: { kind: string; [key: string]: unknown };
    enabled?: boolean;
    departmentWorkspaceUri?: string;
    opcAction?: { type: 'create_project'; projectType: 'adhoc'; goal: string; skillHint?: string; templateId?: string };
  }) =>
    fetchJson<SchedulerJobResponse>('/api/scheduler/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  updateSchedulerJob: (id: string, data: Partial<{
    name: string;
    type: 'cron' | 'interval' | 'once';
    cronExpression?: string;
    timeZone?: string;
    intervalMs?: number;
    scheduledAt?: string;
    action: { kind: string; [key: string]: unknown };
    enabled: boolean;
    departmentWorkspaceUri?: string;
    opcAction?: { type: 'create_project'; projectType: 'adhoc'; goal: string; skillHint?: string; templateId?: string };
  }>) =>
    fetchJson<SchedulerJobResponse>(`/api/scheduler/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteSchedulerJob: (id: string) =>
    fetchJson<{ success: boolean }>(`/api/scheduler/jobs/${id}`, { method: 'DELETE' }),

  triggerSchedulerJob: (id: string) =>
    fetchJson<{ jobId: string; status: string; triggeredAt: string; message?: string }>(`/api/scheduler/jobs/${id}/trigger`, { method: 'POST' }),

  // AI Pipeline Generation (V5.3)
  generatePipeline: (input: { goal: string; constraints?: string; referenceTemplateId?: string; model?: string }) =>
    fetchJson<GenerationResultFE>('/api/pipelines/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  getDraft: (draftId: string) =>
    fetchJson<GenerationResultFE>(`/api/pipelines/generate/${encodeURIComponent(draftId)}`),

  confirmDraft: (draftId: string, modifications?: Record<string, unknown>) =>
    fetchJson<ConfirmResultFE>(`/api/pipelines/generate/${encodeURIComponent(draftId)}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modifications }),
    }),

  // Subgraphs & Resource Policies (V5.4)
  listSubgraphs: () =>
    fetchJson<SubgraphSummaryFE[]>('/api/pipelines/subgraphs'),

  listPolicies: (scope?: string, targetId?: string) => {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (targetId) params.set('targetId', targetId);
    const qs = params.toString();
    return fetchJson<ResourcePolicyFE[]>(`/api/pipelines/policies${qs ? `?${qs}` : ''}`);
  },

  createPolicy: (policy: Omit<ResourcePolicyFE, 'id'> & { id?: string }) =>
    fetchJson<ResourcePolicyFE>('/api/pipelines/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policy),
    }),

  checkPolicy: (context: { workspaceUri?: string; templateId?: string; projectId?: string }, usage: Record<string, number>) =>
    fetchJson<PolicyEvalResultFE>('/api/pipelines/policies/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, usage }),
    }),

  // V5.2: Execution Journal
  queryJournal: async (projectId: string, params?: { nodeId?: string; type?: string; limit?: number; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.nodeId) sp.set('nodeId', params.nodeId);
    if (params?.type) sp.set('type', params.type);
    appendPaginationParams(sp, {
      page: params?.page,
      pageSize: params?.limit ?? 100,
    });
    const qs = sp.toString();
    const result = await fetchPaginatedJson<JournalEntryFE>(
      `/api/projects/${encodeURIComponent(projectId)}/journal${qs ? `?${qs}` : ''}`,
    );
    return {
      entries: result.items ?? [],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
    };
  },

  // V5.2: Checkpoint management
  listCheckpoints: async (projectId: string, pagination?: PaginationQueryFE) => {
    const sp = new URLSearchParams();
    appendPaginationParams(sp, {
      page: pagination?.page,
      pageSize: pagination?.pageSize ?? 100,
    });
    const qs = sp.toString();
    const result = await fetchPaginatedJson<CheckpointFE>(
      `/api/projects/${encodeURIComponent(projectId)}/checkpoints${qs ? `?${qs}` : ''}`,
    );
    return {
      checkpoints: result.items ?? [],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
    };
  },

  createCheckpoint: (projectId: string, nodeId?: string) =>
    fetchJson<CheckpointFE>(`/api/projects/${encodeURIComponent(projectId)}/checkpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    }),

  restoreCheckpoint: (projectId: string, checkpointId: string) =>
    fetchJson<{ restored: boolean; checkpointId: string; activeStageIds: string[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
      { method: 'POST' },
    ),

  replayProject: (projectId: string, checkpointId?: string) =>
    fetchJson<{ replayed: boolean; checkpointId: string; restoredStageCount: number; activeStageIds: string[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpointId }),
      },
    ),

  ceoCommand: (command: string, options?: { model?: string }) =>
    fetchJson<CEOCommandResult>('/api/ceo/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, ...(options?.model ? { model: options.model } : {}) }),
    }),

  // CEO Approval Framework
  listApprovals: (params?: { status?: string; workspace?: string; type?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.workspace) sp.set('workspace', params.workspace);
    if (params?.type) sp.set('type', params.type);
    sp.set('summary', 'true');
    const qs = sp.toString();
    return fetchJson<{ requests: ApprovalRequestFE[]; summary: ApprovalSummaryFE }>(`/api/approval?${qs}`);
  },

  respondApproval: (id: string, action: 'approved' | 'rejected' | 'feedback', message?: string) =>
    fetchJson<{ request: ApprovalRequestFE }>(`/api/approval/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, message: message || '', channel: 'web' }),
    }).then((response) => response.request),

  evolutionProposals: (params?: { workspaceUri?: string; kind?: 'workflow' | 'skill'; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.workspaceUri) sp.set('workspace', params.workspaceUri);
    if (params?.kind) sp.set('kind', params.kind);
    if (params?.status) sp.set('status', params.status);
    return fetchJson<{ proposals: EvolutionProposalFE[] }>(`/api/evolution/proposals?${sp.toString()}`);
  },

  generateEvolutionProposals: (payload?: { workspaceUri?: string; limit?: number }) =>
    fetchJson<{ proposals: EvolutionProposalFE[] }>('/api/evolution/proposals/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),

  evaluateEvolutionProposal: (id: string) =>
    fetchJson<EvolutionProposalFE>(`/api/evolution/proposals/${encodeURIComponent(id)}/evaluate`, {
      method: 'POST',
    }),

  publishEvolutionProposal: (id: string, message?: string) =>
    fetchJson<{ proposal: EvolutionProposalFE | null; approvalRequestId?: string }>(
      `/api/evolution/proposals/${encodeURIComponent(id)}/publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(message ? { message } : {}) }),
      },
    ),

  observeEvolutionProposal: (id: string) =>
    fetchJson<EvolutionProposalFE>(`/api/evolution/proposals/${encodeURIComponent(id)}/observe`, {
      method: 'POST',
    }),
};

// WebSocket connection for live step updates
export interface WsExtra {
  totalLength?: number;
  stepCount?: number;
  lastTaskBoundary?: {
    mode?: string;
    taskName?: string;
    taskStatus?: string;
    taskSummary?: string;
  };
}

export function connectWs(
  onSteps: (cascadeId: string, data: StepsData, isActive: boolean, cascadeStatus: string, extra?: WsExtra) => void,
  onStatus: (connected: boolean) => void,
): WebSocket | null {
  if (typeof window === 'undefined') return null;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const cascadeStatus = msg.cascadeStatus || '';
      const extra: WsExtra = {
        totalLength: msg.totalLength,
        stepCount: msg.stepCount,
        lastTaskBoundary: msg.lastTaskBoundary,
      };
      if (msg.type === 'steps' && msg.cascadeId && msg.data) {
        onSteps(msg.cascadeId, { ...msg.data, cascadeStatus }, !!msg.isActive, cascadeStatus, extra);
      } else if (msg.type === 'status' && msg.cascadeId) {
        // Status-only update (no new steps, just isActive change)
        onSteps(msg.cascadeId, { steps: [], cascadeStatus }, !!msg.isActive, cascadeStatus, extra);
      }
    } catch { /* ignore */ }
  };

  ws.onopen = () => onStatus(true);
  ws.onclose = () => {
    console.warn('[WS] Connection closed, reconnecting in 3s...');
    onStatus(false);
    // auto-reconnect
    setTimeout(() => connectWs(onSteps, onStatus), 3000);
  };

  return ws;
}
