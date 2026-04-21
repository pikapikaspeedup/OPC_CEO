import fs from 'fs';
import path from 'path';

import { createLogger } from '@/lib/logger';
import { GATEWAY_HOME } from '@/lib/agents/gateway-home';
import { initializeProjectRegistry } from '@/lib/agents/project-registry';
import { initializeRunRegistry } from '@/lib/agents/run-registry';
import { initializeScheduler, stopScheduler } from '@/lib/agents/scheduler';

const log = createLogger('SchedulerWorker');
const LOCK_FILE = path.join(GATEWAY_HOME, 'scheduler.lock');
let lockAcquired = false;

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireSchedulerLock(): void {
  fs.mkdirSync(GATEWAY_HOME, { recursive: true });

  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    }), { flag: 'wx' });
    lockAcquired = true;
    return;
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  try {
    const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')) as { pid?: number };
    if (existing.pid && pidExists(existing.pid)) {
      throw new Error(`Scheduler lock already held by pid ${existing.pid}`);
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Scheduler lock already held')) {
      throw error;
    }
  }

  fs.rmSync(LOCK_FILE, { force: true });
  fs.writeFileSync(LOCK_FILE, JSON.stringify({
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  }), { flag: 'wx' });
  lockAcquired = true;
}

function releaseSchedulerLock(): void {
  if (!lockAcquired) {
    return;
  }

  try {
    const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')) as { pid?: number };
    if (existing.pid === process.pid) {
      fs.rmSync(LOCK_FILE, { force: true });
    }
  } catch {
    // ignore stale lock cleanup failures
  }
  lockAcquired = false;
}

export async function startSchedulerWorker(): Promise<void> {
  acquireSchedulerLock();
  try {
    initializeRunRegistry();
    initializeProjectRegistry();

    try {
      initializeScheduler();
    } catch (error: unknown) {
      log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Scheduler initialization failed');
    }

    try {
      const { initializeFanOutController } = await import('@/lib/agents/fan-out-controller');
      initializeFanOutController();
    } catch (error: unknown) {
      log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Fan-out controller initialization skipped');
    }

    try {
      const { initApprovalTriggers } = await import('@/lib/agents/approval-triggers');
      initApprovalTriggers();
    } catch (error: unknown) {
      log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Approval triggers initialization skipped');
    }

    try {
      const { loadPersistedRequests } = await import('@/lib/approval/request-store');
      loadPersistedRequests();
    } catch (error: unknown) {
      log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Approval request restore skipped');
    }

    try {
      const { ensureCEOEventConsumer } = await import('@/lib/organization/ceo-event-consumer');
      ensureCEOEventConsumer();
    } catch (error: unknown) {
      log.warn({ err: error instanceof Error ? error.message : String(error) }, 'CEO event consumer initialization skipped');
    }
  } catch (error: unknown) {
    releaseSchedulerLock();
    throw error;
  }

  log.info('Scheduler worker started');
}

export function stopSchedulerWorker(): void {
  stopScheduler();
  releaseSchedulerLock();
}
