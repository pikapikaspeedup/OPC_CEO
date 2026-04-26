import { describe, expect, it } from 'vitest';

import {
  getControlPlaneBaseUrl,
  getGatewayServerRole,
  getRuntimeBaseUrl,
  hasCompleteWebApiBackend,
  isStandaloneRole,
  isWebLikeRole,
  shouldBlockUnconfiguredWebApi,
  shouldLaunchBridgeWorker,
  shouldProxyToControlPlane,
  shouldProxyToRuntime,
  shouldStartSchedulerCompanionServices,
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
    expect(shouldProxyToRuntime({
      AG_ROLE: 'api',
      AG_RUNTIME_URL: 'http://127.0.0.1:3102',
    })).toBe(false);
  });

  it('blocks web role api routes unless both backend urls are configured', () => {
    expect(hasCompleteWebApiBackend({ AG_ROLE: 'web' })).toBe(false);
    expect(shouldBlockUnconfiguredWebApi({ AG_ROLE: 'web' })).toBe(true);
    expect(shouldBlockUnconfiguredWebApi({
      AG_ROLE: 'web',
      AG_CONTROL_PLANE_URL: 'http://127.0.0.1:3101',
    })).toBe(true);
    expect(shouldBlockUnconfiguredWebApi({
      AG_ROLE: 'web',
      AG_CONTROL_PLANE_URL: 'http://127.0.0.1:3101',
      AG_RUNTIME_URL: 'http://127.0.0.1:3102',
    })).toBe(false);
    expect(shouldBlockUnconfiguredWebApi({ AG_ROLE: 'all' })).toBe(false);
  });

  it('starts scheduler services in scheduler/all roles unless disabled', () => {
    expect(shouldStartSchedulerServices({ AG_ROLE: 'scheduler' })).toBe(true);
    expect(shouldStartSchedulerServices({ AG_ROLE: 'all' })).toBe(true);
    expect(shouldStartSchedulerServices({ AG_ROLE: 'api' })).toBe(true);
    expect(shouldStartSchedulerServices({
      AG_ROLE: 'api',
      AG_ENABLE_SCHEDULER: '0',
    })).toBe(false);
    expect(shouldStartSchedulerServices({
      AG_ROLE: 'scheduler',
      AG_ENABLE_SCHEDULER: '0',
    })).toBe(false);
    expect(shouldStartSchedulerServices({ AG_ROLE: 'web' })).toBe(false);
  });

  it('keeps scheduler companion services out of api role by default', () => {
    expect(shouldStartSchedulerCompanionServices({ AG_ROLE: 'api' })).toBe(false);
    expect(shouldStartSchedulerCompanionServices({
      AG_ROLE: 'api',
      AG_ENABLE_SCHEDULER_COMPANIONS: '1',
    })).toBe(true);
    expect(shouldStartSchedulerCompanionServices({ AG_ROLE: 'scheduler' })).toBe(true);
    expect(shouldStartSchedulerCompanionServices({ AG_ROLE: 'all' })).toBe(true);
    expect(shouldStartSchedulerCompanionServices({
      AG_ROLE: 'scheduler',
      AG_ENABLE_SCHEDULER_COMPANIONS: '0',
    })).toBe(false);
    expect(shouldStartSchedulerCompanionServices({ AG_ROLE: 'web' })).toBe(false);
  });

  it('starts importers and bridge worker only in runtime/all roles', () => {
    expect(shouldStartImporters({ AG_ROLE: 'runtime' })).toBe(true);
    expect(shouldLaunchBridgeWorker({ AG_ROLE: 'runtime' })).toBe(true);
    expect(shouldStartImporters({ AG_ROLE: 'api' })).toBe(false);
    expect(shouldLaunchBridgeWorker({ AG_ROLE: 'api' })).toBe(false);
    expect(shouldLaunchBridgeWorker({
      AG_ROLE: 'api',
      AG_ENABLE_IMPORTERS: '1',
    })).toBe(true);
    expect(shouldLaunchBridgeWorker({
      AG_ROLE: 'runtime',
      AG_DISABLE_BRIDGE_WORKER: '1',
    })).toBe(false);
    expect(shouldStartImporters({ AG_ROLE: 'web' })).toBe(false);
  });
});
