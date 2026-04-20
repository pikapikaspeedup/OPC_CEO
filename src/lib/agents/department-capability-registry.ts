import fs from 'fs';
import path from 'path';

import { ensureBuiltInAgentBackends, getAgentBackend } from '../backends';
import type { AgentBackendCapabilities } from '../backends/types';
import type { ProviderId } from '../providers/types';
import type { DepartmentConfig, DepartmentSkill } from '../types';
import type {
  DepartmentContract,
  DepartmentExecutionClass,
  DepartmentPermissionMode,
  DepartmentRequiredArtifact,
  DepartmentRuntimeCapabilities,
  DepartmentRuntimeContract,
  DepartmentToolset,
} from '../organization/contracts';
import { getCanonicalSkill, getCanonicalWorkflow, type CanonicalSkill, type CanonicalWorkflow } from './canonical-assets';
import { AssetLoader } from './asset-loader';
import { ARTIFACT_ROOT_DIR } from './gateway-home';

export interface DepartmentResolvedSkill extends DepartmentSkill {
  workflowRef?: string;
  skillRefs?: string[];
  workflow?: CanonicalWorkflow | null;
  fallbackSkills: CanonicalSkill[];
}

export interface DepartmentCapabilityView {
  workspacePath: string;
  config: DepartmentConfig;
  departmentContract: DepartmentContract;
  runtimeContract: DepartmentRuntimeContract;
  identityRule: string;
  localRules: Array<{ name: string; content: string }>;
  workflows: CanonicalWorkflow[];
  skills: DepartmentResolvedSkill[];
  templateIds: string[];
}

export interface DepartmentProviderCapabilityProfile {
  providerId: ProviderId;
  runtimeFamily: 'ide-backed' | 'claude-engine' | 'local-light';
  departmentMainline: 'native' | 'claude-engine' | 'not-applicable';
  runtimeCapabilities: DepartmentRuntimeCapabilities;
  supportedExecutionClasses: DepartmentExecutionClass[];
  notes: string[];
}

type DepartmentRuntimeCapabilityKey = keyof DepartmentRuntimeCapabilities & string;

type ExecutionClassRequirement = {
  executionClass: DepartmentExecutionClass;
  requiredCapabilities: DepartmentRuntimeCapabilityKey[];
  description: string;
};

export interface DepartmentProviderExecutionSupport {
  providerId: ProviderId;
  executionClass: DepartmentExecutionClass;
  supported: boolean;
  missingCapabilities: DepartmentRuntimeCapabilityKey[];
  profile: DepartmentProviderCapabilityProfile;
  requirement: ExecutionClassRequirement;
}

const CLAUDE_ENGINE_RUNTIME_CAPABILITIES: DepartmentRuntimeCapabilities = {
  supportsDepartmentRuntime: true,
  supportsToolRuntime: true,
  supportsArtifactContracts: true,
  supportsReadWriteAudit: true,
  supportsPermissionEnforcement: true,
  supportsReviewLoops: true,
};

const LOCAL_LIGHT_RUNTIME_CAPABILITIES: DepartmentRuntimeCapabilities = {
  supportsDepartmentRuntime: false,
  supportsToolRuntime: false,
  supportsArtifactContracts: false,
  supportsReadWriteAudit: false,
  supportsPermissionEnforcement: false,
  supportsReviewLoops: false,
};

const EXECUTION_CLASS_REQUIREMENTS: Record<DepartmentExecutionClass, ExecutionClassRequirement> = {
  light: {
    executionClass: 'light',
    requiredCapabilities: [],
    description: 'Light Department task; any provider may run it.',
  },
  'artifact-heavy': {
    executionClass: 'artifact-heavy',
    requiredCapabilities: [
      'supportsDepartmentRuntime',
      'supportsToolRuntime',
      'supportsArtifactContracts',
      'supportsReadWriteAudit',
    ],
    description: 'Artifact-heavy task; requires Department runtime, tool runtime, artifact contracts, and read/write audit.',
  },
  'review-loop': {
    executionClass: 'review-loop',
    requiredCapabilities: [
      'supportsDepartmentRuntime',
      'supportsToolRuntime',
      'supportsArtifactContracts',
      'supportsReadWriteAudit',
      'supportsReviewLoops',
    ],
    description: 'Review-loop task; requires Department runtime plus stable artifact and review-loop support.',
  },
  delivery: {
    executionClass: 'delivery',
    requiredCapabilities: [
      'supportsDepartmentRuntime',
      'supportsToolRuntime',
      'supportsArtifactContracts',
      'supportsReadWriteAudit',
      'supportsPermissionEnforcement',
    ],
    description: 'Delivery task; requires Department runtime, artifact contracts, read/write audit, and permission enforcement.',
  },
};

function createStaticProviderCapabilityProfile(
  providerId: ProviderId,
  options: {
    runtimeFamily: DepartmentProviderCapabilityProfile['runtimeFamily'];
    departmentMainline?: DepartmentProviderCapabilityProfile['departmentMainline'];
    runtimeCapabilities: DepartmentRuntimeCapabilities;
    supportedExecutionClasses: DepartmentExecutionClass[];
    notes?: string[];
  },
): DepartmentProviderCapabilityProfile {
  return {
    providerId,
    runtimeFamily: options.runtimeFamily,
    departmentMainline: options.departmentMainline ?? 'not-applicable',
    runtimeCapabilities: options.runtimeCapabilities,
    supportedExecutionClasses: options.supportedExecutionClasses,
    notes: options.notes ?? [],
  };
}

const STATIC_PROVIDER_CAPABILITY_PROFILES: Record<ProviderId, DepartmentProviderCapabilityProfile> = {
  antigravity: createStaticProviderCapabilityProfile('antigravity', {
    runtimeFamily: 'ide-backed',
    runtimeCapabilities: CLAUDE_ENGINE_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
    notes: ['IDE-backed runtime with full Department execution support.'],
  }),
  'claude-code': createStaticProviderCapabilityProfile('claude-code', {
    runtimeFamily: 'ide-backed',
    runtimeCapabilities: CLAUDE_ENGINE_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
    notes: ['IDE-backed runtime with strong Department execution support.'],
  }),
  'claude-api': createStaticProviderCapabilityProfile('claude-api', {
    runtimeFamily: 'claude-engine',
    departmentMainline: 'claude-engine',
    runtimeCapabilities: CLAUDE_ENGINE_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
    notes: ['API-backed provider routed through Claude Engine Department runtime.'],
  }),
  'openai-api': createStaticProviderCapabilityProfile('openai-api', {
    runtimeFamily: 'claude-engine',
    departmentMainline: 'claude-engine',
    runtimeCapabilities: CLAUDE_ENGINE_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
    notes: ['API-backed provider routed through Claude Engine Department runtime.'],
  }),
  'gemini-api': createStaticProviderCapabilityProfile('gemini-api', {
    runtimeFamily: 'claude-engine',
    departmentMainline: 'claude-engine',
    runtimeCapabilities: CLAUDE_ENGINE_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
    notes: ['API-backed provider routed through Claude Engine Department runtime.'],
  }),
  'grok-api': createStaticProviderCapabilityProfile('grok-api', {
    runtimeFamily: 'claude-engine',
    departmentMainline: 'claude-engine',
    runtimeCapabilities: CLAUDE_ENGINE_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
    notes: ['API-backed provider routed through Claude Engine Department runtime.'],
  }),
  custom: createStaticProviderCapabilityProfile('custom', {
    runtimeFamily: 'claude-engine',
    departmentMainline: 'claude-engine',
    runtimeCapabilities: CLAUDE_ENGINE_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
    notes: ['OpenAI-compatible provider routed through Claude Engine Department runtime.'],
  }),
  codex: createStaticProviderCapabilityProfile('codex', {
    runtimeFamily: 'local-light',
    runtimeCapabilities: LOCAL_LIGHT_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light'],
    notes: ['Local conversation/runtime path only; not suitable for Department review-loop, artifact-heavy, or delivery tasks.'],
  }),
  'native-codex': createStaticProviderCapabilityProfile('native-codex', {
    runtimeFamily: 'local-light',
    departmentMainline: 'native',
    runtimeCapabilities: LOCAL_LIGHT_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light'],
    notes: [
      'Department mainline is still on the lightweight native-codex backend.',
      'Local conversation/chat shell support does not qualify native-codex as a Department runtime provider.',
    ],
  }),
};

function cloneRuntimeCapabilities(
  capabilities: DepartmentRuntimeCapabilities,
): DepartmentRuntimeCapabilities {
  return { ...capabilities };
}

function cloneProviderCapabilityProfile(
  profile: DepartmentProviderCapabilityProfile,
): DepartmentProviderCapabilityProfile {
  return {
    ...profile,
    runtimeCapabilities: cloneRuntimeCapabilities(profile.runtimeCapabilities),
    supportedExecutionClasses: [...profile.supportedExecutionClasses],
    notes: [...profile.notes],
  };
}

function hasStrongDepartmentRuntimeCapabilities(
  capabilities: AgentBackendCapabilities | undefined,
): boolean {
  const runtime = capabilities?.departmentRuntime;
  if (!runtime) {
    return false;
  }

  return Boolean(
    runtime.supportsDepartmentRuntime
      && runtime.supportsToolRuntime
      && runtime.supportsArtifactContracts,
  );
}

function isNativeCodexDepartmentMainlineOnClaudeEngine(): boolean {
  try {
    ensureBuiltInAgentBackends();
    const backend = getAgentBackend('native-codex');
    const capabilities = backend.capabilities();

    if (hasStrongDepartmentRuntimeCapabilities(capabilities)) {
      return true;
    }

    return backend.constructor?.name === 'ClaudeEngineAgentBackend';
  } catch {
    return false;
  }
}

function getNativeCodexCapabilityProfile(): DepartmentProviderCapabilityProfile {
  if (!isNativeCodexDepartmentMainlineOnClaudeEngine()) {
    return cloneProviderCapabilityProfile(STATIC_PROVIDER_CAPABILITY_PROFILES['native-codex']);
  }

  return createStaticProviderCapabilityProfile('native-codex', {
    runtimeFamily: 'claude-engine',
    departmentMainline: 'claude-engine',
    runtimeCapabilities: CLAUDE_ENGINE_RUNTIME_CAPABILITIES,
    supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
    notes: [
      'native-codex Department mainline is routed through Claude Engine.',
      'Department routing treats native-codex as API-backed only after the Claude Engine backend cutover.',
    ],
  });
}

export function getExecutionClassRequirement(
  executionClass: DepartmentExecutionClass,
): ExecutionClassRequirement {
  return EXECUTION_CLASS_REQUIREMENTS[executionClass];
}

export function getDepartmentProviderCapabilityProfile(
  providerId: ProviderId,
): DepartmentProviderCapabilityProfile {
  if (providerId === 'native-codex') {
    return getNativeCodexCapabilityProfile();
  }

  return cloneProviderCapabilityProfile(STATIC_PROVIDER_CAPABILITY_PROFILES[providerId]);
}

export function getDepartmentProviderExecutionSupport(
  providerId: ProviderId,
  executionClass: DepartmentExecutionClass,
): DepartmentProviderExecutionSupport {
  const profile = getDepartmentProviderCapabilityProfile(providerId);
  const requirement = getExecutionClassRequirement(executionClass);
  const missingCapabilities = requirement.requiredCapabilities.filter(
    (capability) => !profile.runtimeCapabilities[capability],
  );

  return {
    providerId,
    executionClass,
    supported: missingCapabilities.length === 0 && profile.supportedExecutionClasses.includes(executionClass),
    missingCapabilities,
    profile,
    requirement,
  };
}

function defaultDepartmentConfig(workspacePath: string): DepartmentConfig {
  return {
    name: path.basename(workspacePath),
    type: 'build',
    skills: [],
    okr: null,
  };
}

export function readDepartmentConfig(workspacePath: string): DepartmentConfig {
  const configPath = path.join(workspacePath, '.department', 'config.json');
  if (!fs.existsSync(configPath)) {
    return defaultDepartmentConfig(workspacePath);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as DepartmentConfig;
    return {
      ...defaultDepartmentConfig(workspacePath),
      ...raw,
      skills: raw.skills ?? [],
      okr: raw.okr ?? null,
    };
  } catch {
    return defaultDepartmentConfig(workspacePath);
  }
}

export function buildDepartmentIdentityRule(config: DepartmentConfig, workspacePath: string): string {
  const deptName = config.name || path.basename(workspacePath);
  const sections = [
    '---',
    'name: department-identity',
    'description: 本部门/工作区的人设与基础属性',
    'trigger: always_on',
    '---',
    '',
    '# Department Context',
    '',
    `你是 **${deptName}**。`,
  ];

  if (config.description) {
    sections.push('', '## Department Mission', '', config.description);
  }

  if (config.skills.length > 0) {
    sections.push('', '## Core Skills');
    for (const skill of config.skills) {
      sections.push(`- ${skill.name}${skill.workflowRef ? ` -> workflow:${normalizeWorkflowRef(skill.workflowRef)}` : ''}`);
    }
  }

  if (config.templateIds?.length) {
    sections.push('', '## Allowed Templates');
    for (const templateId of config.templateIds) {
      sections.push(`- ${templateId}`);
    }
  }

  if (config.provider) {
    sections.push('', `## Preferred Provider\n- ${config.provider}`);
  }

  return sections.join('\n');
}

function readMarkdownFiles(dir: string): Array<{ name: string; content: string }> {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      name: file.replace(/\.md$/i, ''),
      content: fs.readFileSync(path.join(dir, file), 'utf-8'),
    }));
}

function dedupeRules(rules: Array<{ name: string; content: string }>): Array<{ name: string; content: string }> {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    if (seen.has(rule.name)) return false;
    seen.add(rule.name);
    return true;
  });
}

function normalizeWorkflowRef(workflowRef?: string): string | undefined {
  if (!workflowRef) return undefined;
  const trimmed = workflowRef.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return false;
    }
    seen.add(trimmed);
    return true;
  });
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry))
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function toWorkspaceUri(workspacePath: string): string {
  return workspacePath.startsWith('file://') ? workspacePath : `file://${workspacePath}`;
}

function inferDepartmentToolset(config: DepartmentConfig): DepartmentToolset {
  const normalizedType = (config.type || '').toLowerCase();
  const categories = config.skills.map((skill) => skill.category.toLowerCase());

  if (
    normalizedType.includes('research') ||
    categories.some((category) => category.includes('research') || category.includes('analysis') || category.includes('intel'))
  ) {
    return 'research';
  }

  if (
    normalizedType.includes('build') ||
    normalizedType.includes('engineering') ||
    normalizedType.includes('delivery') ||
    categories.some((category) => category.includes('build') || category.includes('coding') || category.includes('delivery'))
  ) {
    return 'coding';
  }

  if (
    normalizedType.includes('ops') ||
    normalizedType.includes('operation') ||
    normalizedType.includes('security') ||
    normalizedType.includes('compliance')
  ) {
    return 'safe';
  }

  return 'safe';
}

function inferDepartmentExecutionClass(config: DepartmentConfig): DepartmentExecutionClass {
  const normalizedType = (config.type || '').toLowerCase();
  if (normalizedType.includes('review')) {
    return 'review-loop';
  }
  if (normalizedType.includes('delivery')) {
    return 'delivery';
  }
  if ((config.templateIds?.length ?? 0) > 0) {
    return 'artifact-heavy';
  }
  return 'light';
}

function collectWorkflowRefs(skills: DepartmentResolvedSkill[]): string[] {
  return dedupeStrings(
    skills
      .map((skill) => skill.workflowRef)
      .filter((workflowRef): workflowRef is string => Boolean(workflowRef)),
  );
}

function collectDepartmentSkillRefs(skills: DepartmentResolvedSkill[]): string[] {
  return dedupeStrings(
    skills.flatMap((skill) => [
      skill.skillId,
      ...(skill.skillRefs ?? []),
      skill.name,
    ].filter((ref): ref is string => Boolean(ref))),
  );
}

export function buildDepartmentContract(
  workspacePath: string,
  config: DepartmentConfig,
  resolvedSkills: DepartmentResolvedSkill[],
): DepartmentContract {
  const responsibilities = dedupeStrings(
    config.skills.map((skill) => skill.name).filter(Boolean),
  );

  return {
    workspaceUri: toWorkspaceUri(workspacePath),
    name: config.name,
    type: config.type,
    ...(config.description ? { description: config.description } : {}),
    responsibilities: responsibilities.length > 0
      ? responsibilities
      : ['Handle the department responsibilities assigned by the current task.'],
    providerPolicy: {
      ...(config.provider ? { defaultProvider: config.provider, allowedProviders: [config.provider] } : {}),
    },
    workflowRefs: collectWorkflowRefs(resolvedSkills),
    skillRefs: collectDepartmentSkillRefs(resolvedSkills),
    memoryScopes: {
      department: true,
      organization: true,
      providerSpecific: false,
    },
    ...(config.tokenQuota
      ? {
          tokenQuota: {
            daily: config.tokenQuota.daily,
            monthly: config.tokenQuota.monthly,
            canRequestMore: config.tokenQuota.canRequestMore,
          },
        }
      : {}),
  };
}

export interface DepartmentRuntimeContractOverrides {
  executionClass?: DepartmentExecutionClass;
  toolset?: DepartmentToolset;
  permissionMode?: DepartmentPermissionMode;
  artifactRoot?: string;
  additionalWorkingDirectories?: string[];
  readRoots?: string[];
  writeRoots?: string[];
  requiredArtifacts?: DepartmentRequiredArtifact[];
  mcpServers?: string[];
  allowSubAgents?: boolean;
}

export function buildDepartmentRuntimeContract(
  workspacePath: string,
  config: DepartmentConfig,
  overrides: DepartmentRuntimeContractOverrides = {},
): DepartmentRuntimeContract {
  const artifactRoot = overrides.artifactRoot
    ? path.resolve(overrides.artifactRoot)
    : path.join(workspacePath, ARTIFACT_ROOT_DIR);
  const additionalWorkingDirectories = dedupePaths(overrides.additionalWorkingDirectories ?? []);
  const readRoots = dedupePaths([
    workspacePath,
    artifactRoot,
    ...(overrides.readRoots ?? []),
    ...additionalWorkingDirectories,
  ]);
  const writeRoots = dedupePaths([
    artifactRoot,
    workspacePath,
    ...(overrides.writeRoots ?? []),
  ]);

  return {
    workspaceRoot: path.resolve(workspacePath),
    additionalWorkingDirectories,
    readRoots,
    writeRoots,
    artifactRoot,
    executionClass: overrides.executionClass ?? inferDepartmentExecutionClass(config),
    toolset: overrides.toolset ?? inferDepartmentToolset(config),
    permissionMode: overrides.permissionMode ?? 'default',
    ...(overrides.requiredArtifacts ? { requiredArtifacts: overrides.requiredArtifacts } : {}),
    ...(overrides.mcpServers ? { mcpServers: dedupeStrings(overrides.mcpServers) } : {}),
    ...(typeof overrides.allowSubAgents === 'boolean' ? { allowSubAgents: overrides.allowSubAgents } : {}),
  };
}

function collectSkillRefs(skill: DepartmentSkill): string[] {
  const refs = new Set<string>();
  if (Array.isArray((skill as DepartmentResolvedSkill).skillRefs)) {
    for (const ref of (skill as DepartmentResolvedSkill).skillRefs || []) {
      if (ref?.trim()) refs.add(ref.trim());
    }
  }

  if (skill.skillId?.trim()) refs.add(skill.skillId.trim());
  if (skill.name?.trim()) refs.add(skill.name.trim());
  return [...refs];
}

function resolveDepartmentSkill(skill: DepartmentSkill): DepartmentResolvedSkill {
  const workflowRef = normalizeWorkflowRef((skill as DepartmentResolvedSkill).workflowRef);
  const workflow = workflowRef ? getCanonicalWorkflow(workflowRef) : null;
  const skillRefs = collectSkillRefs(skill);
  const fallbackSkillMap = new Map<string, CanonicalSkill>();
  for (const entry of skillRefs
    .map((ref) => getCanonicalSkill(ref))
    .filter((entry): entry is CanonicalSkill => Boolean(entry))) {
    fallbackSkillMap.set(entry.name, entry);
  }
  const fallbackSkills = [...fallbackSkillMap.values()];

  return {
    ...skill,
    workflowRef,
    skillRefs,
    workflow,
    fallbackSkills,
  };
}

export function getDepartmentCapabilityView(workspacePath: string): DepartmentCapabilityView {
  const config = readDepartmentConfig(workspacePath);
  const resolvedSkills = config.skills.map(resolveDepartmentSkill);

  const workflowMap = new Map<string, CanonicalWorkflow>();
  for (const skill of resolvedSkills) {
    if (skill.workflow) {
      workflowMap.set(skill.workflow.name, skill.workflow);
    }
  }

  const localRules = dedupeRules([
    ...readMarkdownFiles(path.join(workspacePath, '.department', 'rules')),
    ...readMarkdownFiles(path.join(workspacePath, '.agents', 'rules')),
  ]).filter((rule) => rule.name !== 'department-identity');

  const departmentContract = buildDepartmentContract(workspacePath, config, resolvedSkills);
  const runtimeContract = buildDepartmentRuntimeContract(workspacePath, config);

  return {
    workspacePath,
    config,
    departmentContract,
    runtimeContract,
    identityRule: buildDepartmentIdentityRule(config, workspacePath),
    localRules,
    workflows: [...workflowMap.values()],
    skills: resolvedSkills,
    templateIds: config.templateIds ?? [],
  };
}

export function getTemplateWorkflowRefs(templateId: string): string[] {
  const template = AssetLoader.getTemplate(templateId);
  if (!template) return [];

  const refs = new Set<string>();
  const stages = template.graphPipeline?.nodes
    ? template.graphPipeline.nodes
    : template.pipeline || Object.values((template as { stages?: Record<string, { roles?: Array<{ workflow?: string }> }> }).stages || {});

  for (const stage of stages) {
    for (const role of stage.roles ?? []) {
      if (role.workflow?.trim()) {
        refs.add(normalizeWorkflowRef(role.workflow)!);
      }
    }
  }

  return [...refs];
}
