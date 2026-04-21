import { describe, expect, it } from 'vitest';

import {
  getControlPlaneBaseUrl,
  getGatewayServerRole,
  getRuntimeBaseUrl,
  isStandaloneRole,
  isWebLikeRole,
  shouldLaunchBridgeWorker,
  shouldProxyToControlPlane,
  shouldProxyToRuntime,
  shouldStartImporters,
  shouldStartSchedulerServices,
} from './gateway-role';

describe('gateway-role helpers', () => {
  it('defaults to legacy all-in-one mode when AG_ROLE is missing', () => {
    expect(getGatewayServerRole({})).toBe('all');
    expect(isWebLikeRole({})).toBe(true);
    expect(isStandaloneRole({})).toBe(false);
  });

  it('normalizes control-plane and runtime base urls', () => {
    expect(getControlPlaneBaseUrl({ AG_CONTROL_PLANE_URL: ' http://127.0.0.1:3101/ ' })).toBe('http://127.0.0.1:3101');
    expect(getRuntimeBaseUrl({ AG_RUNTIME_URL: 'http://127.0.0.1:3102///' })).toBe('http://127.0.0.1:3102');
  });

  it('only proxies to control-plane from web mode', () => {
    expect(shouldProxyToControlPlane({
      AG_ROLE: 'web',
      AG_CONTROL_PLANE_URL: 'http://127.0.0.1:3101',
    })).toBe(true);
    expect(shouldProxyToControlPlane({
      AG_ROLE: 'control-plane',
      AG_CONTROL_PLANE_URL: 'http://127.0.0.1:3101',
    })).toBe(false);
  });

  it('only proxies to runtime from web/control-plane roles', () => {
    expect(shouldProxyToRuntime({
      AG_ROLE: 'web',
      AG_RUNTIME_URL: 'http://127.0.0.1:3102',
    })).toBe(true);
    expect(shouldProxyToRuntime({
      AG_ROLE: 'control-plane',
      AG_RUNTIME_URL: 'http://127.0.0.1:3102',
    })).toBe(true);
    expect(shouldProxyToRuntime({
      AG_ROLE: 'runtime',
      AG_RUNTIME_URL: 'http://127.0.0.1:3102',
    })).toBe(false);
  });

  it('starts scheduler services in scheduler/all roles unless disabled', () => {
    expect(shouldStartSchedulerServices({ AG_ROLE: 'scheduler' })).toBe(true);
    expect(shouldStartSchedulerServices({ AG_ROLE: 'all' })).toBe(true);
    expect(shouldStartSchedulerServices({
      AG_ROLE: 'scheduler',
      AG_ENABLE_SCHEDULER: '0',
    })).toBe(false);
    expect(shouldStartSchedulerServices({ AG_ROLE: 'web' })).toBe(false);
  });

  it('starts importers and bridge worker only in runtime/all roles', () => {
    expect(shouldStartImporters({ AG_ROLE: 'runtime' })).toBe(true);
    expect(shouldLaunchBridgeWorker({ AG_ROLE: 'runtime' })).toBe(true);
    expect(shouldLaunchBridgeWorker({
      AG_ROLE: 'runtime',
      AG_DISABLE_BRIDGE_WORKER: '1',
    })).toBe(false);
    expect(shouldStartImporters({ AG_ROLE: 'web' })).toBe(false);
  });
});
