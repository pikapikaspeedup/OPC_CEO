import type { AgentRunState, RoleProgress } from './group-types';

type RunSessionHandleState = Pick<AgentRunState, 'sessionProvenance' | 'activeConversationId' | 'childConversationId' | 'roles'>;
type RunConversationIdState = Pick<AgentRunState, 'activeConversationId' | 'childConversationId' | 'roles'>;

function getLatestRoleConversationHandle(roles: RoleProgress[] | undefined, roleId: string): string | undefined {
  if (!roles?.length) {
    return undefined;
  }

  const matchingRoles = roles.filter((role) => role.roleId === roleId && role.childConversationId);
  const latest = matchingRoles[matchingRoles.length - 1];
  return latest?.childConversationId;
}

/**
 * Resolve the best available active session handle for a run.
 * Priority: sessionProvenance.handle -> activeConversationId -> role-level fallback -> childConversationId.
 */
export function resolveRunSessionHandle(
  run: RunSessionHandleState | null | undefined,
  targetRoleId?: string,
): string | undefined {
  if (!run) {
    return undefined;
  }

  if (run.sessionProvenance?.handle) {
    return run.sessionProvenance.handle;
  }

  if (run.activeConversationId) {
    return run.activeConversationId;
  }

  if (targetRoleId) {
    const roleHandle = getLatestRoleConversationHandle(run.roles, targetRoleId);
    if (roleHandle) {
      return roleHandle;
    }
  }

  return run.childConversationId || undefined;
}

/**
 * Legacy compatibility mirror for older run payload consumers.
 * New runtime code should treat sessionProvenance.handle as the authority.
 */
export function buildLegacyConversationHandleBinding(
  handle: string | undefined,
): Partial<Pick<AgentRunState, 'childConversationId' | 'activeConversationId'>> {
  if (!handle) {
    return {};
  }

  return {
    childConversationId: handle,
    activeConversationId: handle,
  };
}

export function resolvePrimaryConversationId(run: RunConversationIdState | null | undefined): string | undefined {
  if (!run) {
    return undefined;
  }

  return run.activeConversationId || run.childConversationId || undefined;
}

export function collectRunChildConversationIds(run: Pick<AgentRunState, 'childConversationId' | 'roles'> | null | undefined): string[] {
  if (!run) {
    return [];
  }

  const ids = new Set<string>();
  if (run.childConversationId) {
    ids.add(run.childConversationId);
  }
  for (const role of run.roles || []) {
    if (role.childConversationId) {
      ids.add(role.childConversationId);
    }
  }
  return Array.from(ids);
}

export function isAuthoritativeSessionHandle(
  run: RunSessionHandleState | null | undefined,
  handle: string,
): boolean {
  const activeHandle = resolveRunSessionHandle(run);
  return !activeHandle || activeHandle === handle;
}
