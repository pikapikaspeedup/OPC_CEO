import type { BackendRunResolution } from '../backends/types';
import type { ExecutionProfile } from '../execution/contracts';
import type {
  DepartmentExecutionClass,
  DepartmentRequiredArtifact,
  DepartmentRuntimeContract,
} from '../organization/contracts';
import type { ProviderId } from '../providers/types';
import type { PromptModeResolution } from './group-types';
import {
  getCanonicalSkill,
  getCanonicalWorkflow,
  type CanonicalSkill,
  type CanonicalWorkflow,
} from './canonical-assets';
import type { GrowthProposal } from '../company-kernel/contracts';
import { listGrowthProposals } from '../company-kernel/growth-proposal-store';
import {
  getDepartmentCapabilityView,
  getDepartmentProviderCapabilityProfile,
  getDepartmentProviderExecutionSupport,
  getTemplateWorkflowRefs,
  type DepartmentCapabilityView,
} from './department-capability-registry';

export interface ProviderExecutionContext {
  promptPreamble: string;
  runtimeContract?: DepartmentRuntimeContract;
  executionProfile?: ExecutionProfile;
  resolution?: BackendRunResolution;
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
  resolutionReason: string;
  promptResolution?: PromptModeResolution;
}

export interface CapabilityAwareProviderRoutingDecision {
  requestedProvider: ProviderId;
  selectedProvider: ProviderId;
  requestedModel?: string;
  selectedModel?: string;
  requiredExecutionClass: DepartmentExecutionClass;
  routingMode: 'preferred' | 'fallback';
  reason: string;
  missingCapabilities: string[];
}

type CapabilityAwareProviderRoutingOptions = {
  workspacePath: string;
  requestedProvider: ProviderId;
  requestedModel?: string;
  explicitModel?: boolean;
  runtimeContract?: DepartmentRuntimeContract;
  executionProfile?: ExecutionProfile;
  requiredExecutionClass?: DepartmentExecutionClass;
};

const CAPABILITY_FALLBACK_ORDER: ProviderId[] = [
  'claude-api',
  'openai-api',
  'gemini-api',
  'grok-api',
  'custom',
  'antigravity',
  'claude-code',
  'codex',
  'native-codex',
];

function normalizeText(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/[\s/_-]+/g, '');
}

function workspaceUriFromPath(workspacePath: string): string {
  return workspacePath.startsWith('file://') ? workspacePath : `file://${workspacePath}`;
}

function growthProposalMatchScore(proposal: GrowthProposal, promptText?: string): number {
  const prompt = normalizeText(promptText);
  if (!prompt) return 0;
  const tokens = [
    proposal.targetName,
    proposal.title,
    proposal.summary,
    ...(proposal.metadata?.keywords && Array.isArray(proposal.metadata.keywords)
      ? proposal.metadata.keywords.map(String)
      : []),
  ]
    .flatMap((value) => String(value || '').split(/[\s/_-]+/))
    .map(normalizeText)
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) return 0;
  const uniqueTokens = Array.from(new Set(tokens)).slice(0, 16);
  return uniqueTokens.filter((token) => prompt.includes(token)).length / uniqueTokens.length;
}

function loadMatchingPublishedGrowthProposals(workspacePath: string, promptText?: string): GrowthProposal[] {
  const workspaceUri = workspaceUriFromPath(workspacePath);
  try {
    return listGrowthProposals({
      status: ['published', 'observing'],
      minScore: 50,
      limit: 50,
    })
      .filter((proposal) => !proposal.workspaceUri || proposal.workspaceUri === workspaceUri)
      .map((proposal) => ({
        proposal,
        score: growthProposalMatchScore(proposal, promptText),
      }))
      .filter((entry) => entry.score > 0 || !promptText)
      .sort((a, b) => b.score - a.score || b.proposal.score - a.proposal.score)
      .map((entry) => entry.proposal)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function loadPublishedGrowthAssets(workspacePath: string, promptText?: string): {
  workflows: CanonicalWorkflow[];
  skills: CanonicalSkill[];
  proposals: GrowthProposal[];
} {
  const proposals = loadMatchingPublishedGrowthProposals(workspacePath, promptText);
  const workflows = proposals
    .filter((proposal) => proposal.kind === 'workflow')
    .map((proposal) => getCanonicalWorkflow(`/${proposal.targetName}`))
    .filter((entry): entry is CanonicalWorkflow => Boolean(entry));
  const skills = proposals
    .filter((proposal) => proposal.kind === 'skill')
    .map((proposal) => getCanonicalSkill(proposal.targetName))
    .filter((entry): entry is CanonicalSkill => Boolean(entry));
  return {
    workflows,
    skills,
    proposals,
  };
}

function dedupeProviders(providers: Array<ProviderId | undefined>): ProviderId[] {
  const seen = new Set<ProviderId>();
  const result: ProviderId[] = [];

  for (const provider of providers) {
    if (!provider || seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    result.push(provider);
  }

  return result;
}

function inferRequiredExecutionClass(
  executionProfile: ExecutionProfile | undefined,
  runtimeContract: DepartmentRuntimeContract | undefined,
  override?: DepartmentExecutionClass,
): DepartmentExecutionClass {
  if (override) {
    return override;
  }

  if (runtimeContract?.executionClass) {
    return runtimeContract.executionClass;
  }

  if (!executionProfile) {
    return 'light';
  }

  if (executionProfile.kind === 'review-flow') {
    return 'review-loop';
  }

  if (executionProfile.kind === 'dag-orchestration') {
    return 'artifact-heavy';
  }

  return 'light';
}

function defaultModelForProvider(provider: ProviderId): string | undefined {
  switch (provider) {
    case 'native-codex':
      return 'gpt-5.4';
    case 'claude-api':
      return 'claude-sonnet-4-20250514';
    case 'openai-api':
      return 'gpt-4.1-mini';
    case 'gemini-api':
      return 'gemini-2.5-flash';
    case 'grok-api':
      return 'grok-3-mini';
    default:
      return undefined;
  }
}

function formatMissingCapabilities(missingCapabilities: string[]): string {
  return missingCapabilities.length > 0 ? missingCapabilities.join(', ') : 'none';
}

function buildCapabilityRoutingReason(
  requestedProvider: ProviderId,
  selectedProvider: ProviderId,
  requiredExecutionClass: DepartmentExecutionClass,
  missingCapabilities: string[],
): string {
  if (requestedProvider === selectedProvider) {
    const profile = getDepartmentProviderCapabilityProfile(selectedProvider);
    return `Capability-aware routing kept provider "${selectedProvider}" for ${requiredExecutionClass}; runtime family=${profile.runtimeFamily}.`;
  }

  const requestedProfile = getDepartmentProviderCapabilityProfile(requestedProvider);
  const requestedNotes = requestedProfile.notes.join(' ');
  const noteSuffix = requestedNotes ? ` ${requestedNotes}` : '';
  return `Capability-aware routing moved ${requiredExecutionClass} work from "${requestedProvider}" to "${selectedProvider}" because the requested provider is missing [${formatMissingCapabilities(missingCapabilities)}].${noteSuffix}`;
}

export function resolveCapabilityAwareProvider(
  options: CapabilityAwareProviderRoutingOptions,
): CapabilityAwareProviderRoutingDecision {
  const view = getDepartmentCapabilityView(options.workspacePath);
  const requiredExecutionClass = inferRequiredExecutionClass(
    options.executionProfile,
    options.runtimeContract,
    options.requiredExecutionClass,
  );
  const requestedSupport = getDepartmentProviderExecutionSupport(
    options.requestedProvider,
    requiredExecutionClass,
  );

  if (requestedSupport.supported || requiredExecutionClass === 'light') {
    const selectedModel = options.explicitModel
      ? options.requestedModel
      : options.requestedModel ?? defaultModelForProvider(options.requestedProvider);

    return {
      requestedProvider: options.requestedProvider,
      selectedProvider: options.requestedProvider,
      requestedModel: options.requestedModel,
      selectedModel,
      requiredExecutionClass,
      routingMode: 'preferred',
      reason: buildCapabilityRoutingReason(
        options.requestedProvider,
        options.requestedProvider,
        requiredExecutionClass,
        requestedSupport.missingCapabilities,
      ),
      missingCapabilities: requestedSupport.missingCapabilities,
    };
  }

  const departmentPreferredProviders = dedupeProviders([
    view.departmentContract.providerPolicy.defaultProvider as ProviderId | undefined,
    ...((view.departmentContract.providerPolicy.allowedProviders ?? []) as ProviderId[]),
  ]);
  const candidateProviders = dedupeProviders([
    options.requestedProvider,
    ...departmentPreferredProviders,
    ...CAPABILITY_FALLBACK_ORDER,
  ]);

  const fallbackProvider = candidateProviders.find((providerId) => {
    if (providerId === options.requestedProvider) {
      return false;
    }
    return getDepartmentProviderExecutionSupport(providerId, requiredExecutionClass).supported;
  }) || options.requestedProvider;

  const selectedModel = options.explicitModel
    ? options.requestedModel
    : fallbackProvider === options.requestedProvider
      ? options.requestedModel ?? defaultModelForProvider(fallbackProvider)
      : defaultModelForProvider(fallbackProvider) ?? options.requestedModel;

  return {
    requestedProvider: options.requestedProvider,
    selectedProvider: fallbackProvider,
    requestedModel: options.requestedModel,
    selectedModel,
    requiredExecutionClass,
    routingMode: fallbackProvider === options.requestedProvider ? 'preferred' : 'fallback',
    reason: buildCapabilityRoutingReason(
      options.requestedProvider,
      fallbackProvider,
      requiredExecutionClass,
      requestedSupport.missingCapabilities,
    ),
    missingCapabilities: requestedSupport.missingCapabilities,
  };
}

function formatWorkflowSection(workflows: CanonicalWorkflow[]): string[] {
  if (workflows.length === 0) return [];

  const lines = ['## Department Workflows', '', '优先使用下面这些 workflow / playbook：'];
  for (const workflow of workflows) {
    lines.push('', `### ${workflow.name}`, (workflow.content || '').trim());
  }
  return lines;
}

function formatSkillSection(skills: CanonicalSkill[]): string[] {
  if (skills.length === 0) return [];

  const lines = ['## Department Skills', '', '如果没有合适 workflow，再回退到这些 skill：'];
  for (const skill of skills) {
    lines.push('', `### ${skill.name}`, skill.content.trim());
  }
  return lines;
}

function formatTemplateSection(view: DepartmentCapabilityView): string[] {
  if (view.templateIds.length === 0) return [];
  return [
    '## Allowed Templates',
    ...view.templateIds.map((templateId) => `- ${templateId}`),
  ];
}

function buildSharedContext(view: DepartmentCapabilityView): string[] {
  const lines = [
    '<department-capability-pack>',
    view.identityRule.trim(),
  ];

  if (view.localRules.length > 0) {
    lines.push('', '## Department Local Rules');
    for (const rule of view.localRules) {
      lines.push('', `### ${rule.name}`, rule.content.trim());
    }
  }

  lines.push('', ...formatTemplateSection(view));
  return lines;
}

function prependContext(prompt: string, preamble: string): string {
  return preamble.trim() ? `${preamble.trim()}\n\n${prompt}` : prompt;
}

function dedupeRequiredArtifacts(artifacts: DepartmentRequiredArtifact[]): DepartmentRequiredArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = artifact.path.trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function inferExecutionClass(
  profile: ExecutionProfile,
  fallback: DepartmentExecutionClass,
): DepartmentExecutionClass {
  if (profile.kind === 'review-flow') {
    return 'review-loop';
  }
  if (profile.kind === 'dag-orchestration') {
    return fallback === 'delivery' ? 'delivery' : 'artifact-heavy';
  }
  return fallback === 'delivery' ? 'delivery' : 'light';
}

function buildRequiredArtifacts(
  profile: ExecutionProfile,
  inherited: DepartmentRequiredArtifact[] | undefined,
): DepartmentRequiredArtifact[] | undefined {
  const combined = dedupeRequiredArtifacts([...(inherited ?? [])]);
  return combined.length > 0 ? combined : undefined;
}

function buildRuntimeContract(
  view: DepartmentCapabilityView,
  profile: ExecutionProfile,
): DepartmentRuntimeContract {
  const requiredArtifacts = buildRequiredArtifacts(profile, view.runtimeContract.requiredArtifacts);
  return {
    ...view.runtimeContract,
    executionClass: inferExecutionClass(profile, view.runtimeContract.executionClass),
    ...(requiredArtifacts ? { requiredArtifacts } : {}),
  };
}

function buildResolution(
  resolutionReason: string,
  options: {
    resolvedWorkflowRef?: string;
    resolvedSkillRefs?: string[];
    promptResolution?: PromptModeResolution;
  } = {},
): BackendRunResolution {
  return {
    ...(options.resolvedWorkflowRef ? { resolvedWorkflowRef: options.resolvedWorkflowRef } : {}),
    ...(options.resolvedSkillRefs?.length ? { resolvedSkillRefs: options.resolvedSkillRefs } : {}),
    resolutionReason,
    ...(options.promptResolution ? { promptResolution: options.promptResolution } : {}),
  };
}

export function applyProviderExecutionContext(prompt: string, context: ProviderExecutionContext | undefined): string {
  if (!context) return prompt;
  return prependContext(prompt, context.promptPreamble);
}

export function buildTemplateProviderExecutionContext(
  workspacePath: string,
  templateId: string,
): ProviderExecutionContext {
  const view = getDepartmentCapabilityView(workspacePath);
  if (view.templateIds.length > 0 && !view.templateIds.includes(templateId)) {
    throw new Error(`Department "${view.config.name}" is not allowed to execute template "${templateId}"`);
  }

  const workflowRefs = getTemplateWorkflowRefs(templateId);
  const workflows = workflowRefs
    .map((ref) => getCanonicalWorkflow(ref))
    .filter((entry): entry is CanonicalWorkflow => Boolean(entry));

  const sections = [
    ...buildSharedContext(view),
    '',
    '## Execution Contract',
    `- Template 已由 CEO / DAG 明确指定：${templateId}`,
    '- 不要重新选择 workflow；只执行这个 template 内部已经引用的 workflow。',
    ...formatWorkflowSection(workflows),
    '',
    '</department-capability-pack>',
  ];

  const executionProfile: ExecutionProfile = {
    kind: 'dag-orchestration',
    templateId,
  };
  const runtimeContract = buildRuntimeContract(view, executionProfile);
  const resolutionReason = `Template "${templateId}" selected by governance; department context injected for provider execution.`;
  const resolution = buildResolution(resolutionReason);

  return {
    promptPreamble: sections.join('\n'),
    runtimeContract,
    executionProfile,
    resolution,
    resolutionReason,
  };
}

export function buildPromptModeProviderExecutionContext(
  workspacePath: string,
  input: {
    promptAssetRefs?: string[];
    skillHints?: string[];
    promptText?: string;
  },
): ProviderExecutionContext {
  const view = getDepartmentCapabilityView(workspacePath);

  const explicitWorkflows = (input.promptAssetRefs ?? [])
    .map((ref) => getCanonicalWorkflow(ref))
    .filter((entry): entry is CanonicalWorkflow => Boolean(entry));

  const explicitSkills = new Map<string, CanonicalSkill>();
  const explicitSkillWorkflows = new Map<string, CanonicalWorkflow>();
  const matchedDepartmentSkills = new Map<string, DepartmentCapabilityView['skills'][number]>();

  for (const hint of input.skillHints ?? []) {
    for (const resolvedSkill of view.skills) {
      const names = new Set([
        resolvedSkill.name,
        resolvedSkill.skillId,
        ...(resolvedSkill.skillRefs ?? []),
      ].filter(Boolean));
      if ([...names].some((name) => name.toLowerCase() === hint.toLowerCase())) {
        matchedDepartmentSkills.set(resolvedSkill.name, resolvedSkill);
        if (resolvedSkill.workflow) {
          explicitSkillWorkflows.set(resolvedSkill.workflow.name, resolvedSkill.workflow);
        }
        for (const skill of resolvedSkill.fallbackSkills) {
          explicitSkills.set(skill.name, skill);
        }
      }
    }
  }

  const normalizedPrompt = normalizeText(input.promptText);
  if (normalizedPrompt && matchedDepartmentSkills.size === 0) {
    for (const resolvedSkill of view.skills) {
      const aliases = [
        resolvedSkill.name,
        resolvedSkill.skillId,
        ...(resolvedSkill.skillRefs ?? []),
        resolvedSkill.workflow?.name,
      ]
        .map(normalizeText)
        .filter(Boolean);
      if (aliases.some((alias) => normalizedPrompt.includes(alias))) {
        matchedDepartmentSkills.set(resolvedSkill.name, resolvedSkill);
        if (resolvedSkill.workflow) {
          explicitSkillWorkflows.set(resolvedSkill.workflow.name, resolvedSkill.workflow);
        }
        for (const skill of resolvedSkill.fallbackSkills) {
          explicitSkills.set(skill.name, skill);
        }
      }
    }
  }

  const departmentWorkflows = explicitWorkflows.length > 0
    ? explicitWorkflows
    : explicitSkillWorkflows.size > 0
      ? [...explicitSkillWorkflows.values()]
      : view.workflows;

  const departmentSkills = explicitSkills.size > 0
    ? [...explicitSkills.values()]
    : view.skills.flatMap((skill) => skill.fallbackSkills);
  const growthAssets = explicitWorkflows.length > 0
    ? { workflows: [] as CanonicalWorkflow[], skills: [] as CanonicalSkill[], proposals: [] as GrowthProposal[] }
    : loadPublishedGrowthAssets(workspacePath, input.promptText);
  const effectiveWorkflows = [
    ...departmentWorkflows,
    ...growthAssets.workflows.filter((workflow) => !departmentWorkflows.some((item) => item.name === workflow.name)),
  ];
  const effectiveSkills = [
    ...departmentSkills,
    ...growthAssets.skills.filter((skill) => !departmentSkills.some((item) => item.name === skill.name)),
  ];

  const sections = [
    ...buildSharedContext(view),
    '',
    '## Prompt Mode Resolution Policy',
    '- 当前没有固定 Template，Provider 需要自行选择最佳执行方法。',
    '- 优先使用 Department Workflows。',
    '- 如果没有合适 workflow，再回退到 Department Skills。',
    '- 如果仍然没有合适资产，就按最优方法完成任务，并在结果中建议是否应沉淀新的 workflow。',
    ...formatWorkflowSection(effectiveWorkflows),
    ...formatSkillSection(effectiveSkills),
    '',
    '</department-capability-pack>',
  ];

  const promptResolution: PromptModeResolution = {
    mode: explicitWorkflows.length > 0 || effectiveWorkflows.length > 0
      ? 'workflow'
      : effectiveSkills.length > 0
        ? 'skill'
        : 'prompt',
    requestedWorkflowRefs: input.promptAssetRefs ?? [],
    requestedSkillHints: input.skillHints ?? [],
    matchedWorkflowRefs: effectiveWorkflows.map((workflow) => `/${workflow.name}`),
    matchedSkillRefs: effectiveSkills.map((skill) => skill.name),
    resolutionReason: explicitWorkflows.length > 0
      ? `Prompt Mode received explicit workflow refs (${explicitWorkflows.map((workflow) => workflow.name).join(', ')}); provider should prefer them.`
      : explicitSkillWorkflows.size > 0
        ? `Prompt Mode matched ${explicitSkillWorkflows.size} workflow(s) from department skill resolution and injected ${effectiveSkills.length} skill fallback(s).`
      : effectiveWorkflows.length > 0
        ? growthAssets.workflows.length > 0
          ? `Prompt Mode injected ${effectiveWorkflows.length} workflow(s), including ${growthAssets.workflows.length} published growth workflow(s), and ${effectiveSkills.length} skill fallback(s).`
          : `Prompt Mode injected ${effectiveWorkflows.length} department workflow(s) and ${effectiveSkills.length} skill fallback(s).`
        : effectiveSkills.length > 0
          ? growthAssets.skills.length > 0
            ? `Prompt Mode injected ${effectiveSkills.length} skill fallback(s), including ${growthAssets.skills.length} published growth skill(s); no workflow configured.`
            : `Prompt Mode injected ${effectiveSkills.length} skill fallback(s); no department workflow configured.`
          : 'Prompt Mode injected department identity/rules only; no workflow or skill asset configured.',
    workflowSuggestion: explicitWorkflows.length > 0 || effectiveWorkflows.length > 0
      ? undefined
      : {
          shouldCreateWorkflow: true,
          source: effectiveSkills.length > 0 ? 'skill' : 'prompt',
          title: `${view.config.name || 'department'}-${effectiveSkills[0]?.name || 'new-workflow'}`.slice(0, 80),
          reason: effectiveSkills.length > 0
            ? 'Prompt Mode completed without a canonical workflow and relied on skill fallback. Consider promoting this pattern into a reusable workflow.'
            : 'Prompt Mode completed without any matched workflow asset. Consider creating a canonical workflow if this task is recurring.',
          recommendedScope: 'department',
          evidence: {
            requestedWorkflowRefs: input.promptAssetRefs ?? [],
            requestedSkillHints: input.skillHints ?? [],
            matchedWorkflowRefs: effectiveWorkflows.map((workflow) => `/${workflow.name}`),
            matchedSkillRefs: effectiveSkills.map((skill) => skill.name),
          },
        },
  };

  const resolvedWorkflowRef = explicitWorkflows.length === 1
    ? `/${explicitWorkflows[0].name}`
    : explicitSkillWorkflows.size === 1
      ? `/${[...explicitSkillWorkflows.values()][0].name}`
      : effectiveWorkflows.length === 1
        ? `/${effectiveWorkflows[0].name}`
        : undefined;
  const resolvedSkillRefs = promptResolution.matchedSkillRefs.length > 0
    ? promptResolution.matchedSkillRefs
    : undefined;
  const executionProfile: ExecutionProfile = {
    kind: 'workflow-run',
    ...(resolvedWorkflowRef ? { workflowRef: resolvedWorkflowRef } : {}),
    ...(resolvedSkillRefs?.length ? { skillHints: resolvedSkillRefs } : {}),
  };
  const runtimeContract = buildRuntimeContract(view, executionProfile);
  const resolution = buildResolution(promptResolution.resolutionReason, {
    resolvedWorkflowRef,
    resolvedSkillRefs,
    promptResolution,
  });

  return {
    promptPreamble: sections.join('\n'),
    runtimeContract,
    executionProfile,
    resolution,
    resolvedWorkflowRef,
    resolvedSkillRefs,
    resolutionReason: promptResolution.resolutionReason,
    promptResolution,
  };
}
