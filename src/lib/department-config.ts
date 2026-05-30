import type {
  DepartmentConfig,
  DepartmentExecutionPolicy,
  DepartmentRuntimePolicy,
  DepartmentWorkspaceBinding,
  DepartmentWorkspaceRole,
  Workspace,
} from './types';

type RuntimeToolset = NonNullable<DepartmentRuntimePolicy['toolset']>;
type RuntimePermissionMode = NonNullable<DepartmentRuntimePolicy['permissionMode']>;

const RUNTIME_TOOLSETS = new Set<RuntimeToolset>(['safe', 'research', 'coding', 'full']);
const RUNTIME_PERMISSION_MODES = new Set<RuntimePermissionMode>([
  'default',
  'dontAsk',
  'acceptEdits',
  'bypassPermissions',
]);

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRuntimeToolset(value: unknown): value is RuntimeToolset {
  return typeof value === 'string' && RUNTIME_TOOLSETS.has(value as RuntimeToolset);
}

function isRuntimePermissionMode(value: unknown): value is RuntimePermissionMode {
  return typeof value === 'string' && RUNTIME_PERMISSION_MODES.has(value as RuntimePermissionMode);
}

export function workspaceNameFromUri(workspaceUri: string): string {
  return workspaceUri.replace(/^file:\/\//, '').split('/').filter(Boolean).pop() || workspaceUri;
}

export function createWorkspaceBinding(
  workspaceUri: string,
  role: DepartmentWorkspaceRole = 'primary',
  alias?: string,
): DepartmentWorkspaceBinding {
  return {
    workspaceUri,
    role,
    ...(trimOrUndefined(alias) ? { alias: trimOrUndefined(alias) } : {}),
    writeAccess: role !== 'context',
  };
}

export function getDepartmentWorkspaceBindings(
  config: DepartmentConfig | null | undefined,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): DepartmentWorkspaceBinding[] {
  const bindings = new Map<string, DepartmentWorkspaceBinding>();
  const rawBindings = config?.workspaceBindings ?? [];

  for (const entry of rawBindings) {
    const workspaceUri = entry.workspaceUri?.trim();
    if (!workspaceUri) continue;
    bindings.set(workspaceUri, {
      workspaceUri,
      role: entry.role ?? 'execution',
      ...(trimOrUndefined(entry.alias) ? { alias: trimOrUndefined(entry.alias) } : {}),
      writeAccess: entry.role === 'context' ? false : entry.writeAccess !== false,
    });
  }

  if (bindings.size === 0) {
    bindings.set(fallbackWorkspaceUri, createWorkspaceBinding(fallbackWorkspaceUri, 'primary', fallbackWorkspaceName));
  } else if (!bindings.has(fallbackWorkspaceUri)) {
    bindings.set(fallbackWorkspaceUri, createWorkspaceBinding(fallbackWorkspaceUri, 'execution', fallbackWorkspaceName));
  }

  const rawDefaultUri = config?.executionPolicy?.defaultWorkspaceUri?.trim();
  const primaryWorkspaceUri = rawDefaultUri && bindings.has(rawDefaultUri)
    ? rawDefaultUri
    : Array.from(bindings.values()).find((entry) => entry.role === 'primary')?.workspaceUri
      ?? fallbackWorkspaceUri;

  const normalized = Array.from(bindings.values()).map((entry) => {
    const role: DepartmentWorkspaceRole = entry.workspaceUri === primaryWorkspaceUri
      ? 'primary'
      : (entry.role === 'primary' ? 'execution' : entry.role);

    return {
      ...entry,
      role,
      writeAccess: role === 'context' ? false : entry.writeAccess !== false,
    };
  });

  normalized.sort((left, right) => {
    const leftRank = left.role === 'primary' ? 0 : left.role === 'execution' ? 1 : 2;
    const rightRank = right.role === 'primary' ? 0 : right.role === 'execution' ? 1 : 2;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return workspaceNameFromUri(left.workspaceUri).localeCompare(workspaceNameFromUri(right.workspaceUri));
  });

  return normalized;
}

export function getDepartmentPrimaryWorkspaceBinding(
  config: DepartmentConfig | null | undefined,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): DepartmentWorkspaceBinding {
  return getDepartmentWorkspaceBindings(config, fallbackWorkspaceUri, fallbackWorkspaceName).find((entry) => entry.role === 'primary')
    ?? createWorkspaceBinding(fallbackWorkspaceUri, 'primary', fallbackWorkspaceName);
}

export function getDepartmentDefaultWorkspaceUri(
  config: DepartmentConfig | null | undefined,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): string {
  return getDepartmentPrimaryWorkspaceBinding(config, fallbackWorkspaceUri, fallbackWorkspaceName).workspaceUri;
}

export function getDepartmentContextDocumentPaths(
  config: DepartmentConfig | null | undefined,
): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of config?.executionPolicy?.contextDocumentPaths ?? []) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

export function normalizeDepartmentExecutionPolicy(
  config: DepartmentConfig | null | undefined,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): DepartmentExecutionPolicy {
  return {
    defaultWorkspaceUri: getDepartmentDefaultWorkspaceUri(config, fallbackWorkspaceUri, fallbackWorkspaceName),
    contextDocumentPaths: getDepartmentContextDocumentPaths(config),
  };
}

export function normalizeDepartmentRuntimePolicy(
  config: DepartmentConfig | null | undefined,
): DepartmentRuntimePolicy | undefined {
  const policy = config?.runtimePolicy;
  if (!policy) return undefined;

  const normalized: DepartmentRuntimePolicy = {};
  if (isRuntimeToolset(policy.toolset)) {
    normalized.toolset = policy.toolset;
  }
  if (isRuntimePermissionMode(policy.permissionMode)) {
    normalized.permissionMode = policy.permissionMode;
  }
  if (typeof policy.allowSubAgents === 'boolean') {
    normalized.allowSubAgents = policy.allowSubAgents;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeDepartmentConfig(
  config: DepartmentConfig | null | undefined,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): DepartmentConfig {
  const bindings = getDepartmentWorkspaceBindings(config, fallbackWorkspaceUri, fallbackWorkspaceName);
  const primaryBinding = bindings.find((entry) => entry.role === 'primary') ?? bindings[0];
  const name = trimOrUndefined(config?.name) || fallbackWorkspaceName || workspaceNameFromUri(primaryBinding.workspaceUri);
  const runtimePolicy = normalizeDepartmentRuntimePolicy(config);

  return {
    departmentId: trimOrUndefined(config?.departmentId) || `department:${primaryBinding.workspaceUri}`,
    name,
    type: trimOrUndefined(config?.type) || 'build',
    ...(trimOrUndefined(config?.typeIcon) ? { typeIcon: trimOrUndefined(config?.typeIcon) } : {}),
    ...(trimOrUndefined(config?.description) ? { description: trimOrUndefined(config?.description) } : {}),
    ...(config?.templateIds?.length ? { templateIds: [...config.templateIds] } : {}),
    skills: config?.skills ?? [],
    okr: config?.okr ?? null,
    ...(config?.roster?.length ? { roster: [...config.roster] } : {}),
    ...(config?.roomLayout?.length ? { roomLayout: [...config.roomLayout] } : {}),
    ...(config?.roomBg ? { roomBg: config.roomBg } : {}),
    ...(config?.provider ? { provider: config.provider } : {}),
    ...(config?.tokenQuota ? { tokenQuota: config.tokenQuota } : {}),
    workspaceBindings: bindings,
    executionPolicy: normalizeDepartmentExecutionPolicy(config, fallbackWorkspaceUri, fallbackWorkspaceName),
    ...(runtimePolicy ? { runtimePolicy } : {}),
  };
}

export function getDepartmentBoundWorkspaceUris(
  config: DepartmentConfig | null | undefined,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): string[] {
  return getDepartmentWorkspaceBindings(config, fallbackWorkspaceUri, fallbackWorkspaceName).map((entry) => entry.workspaceUri);
}

export function getDepartmentBindingForWorkspace(
  config: DepartmentConfig | null | undefined,
  workspaceUri: string,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): DepartmentWorkspaceBinding | null {
  return getDepartmentWorkspaceBindings(config, fallbackWorkspaceUri, fallbackWorkspaceName)
    .find((entry) => entry.workspaceUri === workspaceUri) || null;
}

export function getDepartmentGroupKey(
  config: DepartmentConfig | null | undefined,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): string {
  return getDepartmentPrimaryWorkspaceBinding(config, fallbackWorkspaceUri, fallbackWorkspaceName).workspaceUri;
}

export function mergeDepartmentConfigIntoWorkspaceMap(
  departments: Map<string, DepartmentConfig>,
  primaryWorkspaceUri: string,
  config: DepartmentConfig,
): Map<string, DepartmentConfig> {
  const normalized = normalizeDepartmentConfig(config, primaryWorkspaceUri);
  const next = new Map(departments);

  for (const [workspaceUri, existing] of next.entries()) {
    if (existing.departmentId && existing.departmentId === normalized.departmentId) {
      next.delete(workspaceUri);
    }
  }

  for (const workspaceUri of getDepartmentBoundWorkspaceUris(normalized, primaryWorkspaceUri)) {
    next.set(workspaceUri, normalized);
  }

  return next;
}

export function listWorkspaceChoices(
  workspaces: Workspace[],
  config: DepartmentConfig | null | undefined,
  fallbackWorkspaceUri: string,
  fallbackWorkspaceName?: string,
): Workspace[] {
  const boundUris = new Set(getDepartmentBoundWorkspaceUris(config, fallbackWorkspaceUri, fallbackWorkspaceName));
  return workspaces.filter((workspace) => !boundUris.has(workspace.uri));
}
