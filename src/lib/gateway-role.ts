export type GatewayServerRole = 'all' | 'web' | 'api' | 'control-plane' | 'runtime' | 'scheduler';

type EnvLike = Record<string, string | undefined>;

function normalizeFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (typeof value !== 'string') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  return defaultValue;
}

function trimUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed ? trimmed : null;
}

export function getGatewayServerRole(env: EnvLike = process.env): GatewayServerRole {
  const value = env.AG_ROLE?.trim().toLowerCase();
  if (value === 'web' || value === 'api' || value === 'control-plane' || value === 'runtime' || value === 'scheduler' || value === 'all') {
    return value;
  }
  return 'all';
}

export function getControlPlaneBaseUrl(env: EnvLike = process.env): string | null {
  return trimUrl(env.AG_CONTROL_PLANE_URL);
}

export function getRuntimeBaseUrl(env: EnvLike = process.env): string | null {
  return trimUrl(env.AG_RUNTIME_URL);
}

export function shouldProxyToControlPlane(env: EnvLike = process.env): boolean {
  return getGatewayServerRole(env) === 'web' && !!getControlPlaneBaseUrl(env);
}

export function shouldProxyToRuntime(env: EnvLike = process.env): boolean {
  const role = getGatewayServerRole(env);
  return (role === 'web' || role === 'control-plane') && !!getRuntimeBaseUrl(env);
}

export function hasCompleteWebApiBackend(env: EnvLike = process.env): boolean {
  if (getGatewayServerRole(env) !== 'web') {
    return true;
  }
  return !!getControlPlaneBaseUrl(env) && !!getRuntimeBaseUrl(env);
}

export function shouldBlockUnconfiguredWebApi(env: EnvLike = process.env): boolean {
  return getGatewayServerRole(env) === 'web' && !hasCompleteWebApiBackend(env);
}

export function shouldStartSchedulerServices(env: EnvLike = process.env): boolean {
  const role = getGatewayServerRole(env);
  if (role === 'scheduler') {
    return normalizeFlag(env.AG_ENABLE_SCHEDULER, true);
  }
  if (role === 'api') {
    return normalizeFlag(env.AG_ENABLE_SCHEDULER, true);
  }
  if (role === 'all') {
    return normalizeFlag(env.AG_ENABLE_SCHEDULER, true);
  }
  return false;
}

export function shouldStartSchedulerCompanionServices(env: EnvLike = process.env): boolean {
  const role = getGatewayServerRole(env);
  const legacyDefault = role === 'scheduler' || role === 'all';
  return normalizeFlag(env.AG_ENABLE_SCHEDULER_COMPANIONS, legacyDefault);
}

export function shouldStartImporters(env: EnvLike = process.env): boolean {
  const role = getGatewayServerRole(env);
  if (role === 'runtime') {
    return normalizeFlag(env.AG_ENABLE_IMPORTERS, true);
  }
  if (role === 'api') {
    return normalizeFlag(env.AG_ENABLE_IMPORTERS, false);
  }
  if (role === 'all') {
    return normalizeFlag(env.AG_ENABLE_IMPORTERS, true);
  }
  return false;
}

export function shouldLaunchBridgeWorker(env: EnvLike = process.env): boolean {
  if (normalizeFlag(env.AG_DISABLE_BRIDGE_WORKER, false)) {
    return false;
  }
  return shouldStartImporters(env);
}

export function isWebLikeRole(env: EnvLike = process.env): boolean {
  const role = getGatewayServerRole(env);
  return role === 'web' || role === 'all';
}

export function isStandaloneRole(env: EnvLike = process.env): boolean {
  return getGatewayServerRole(env) !== 'all';
}
