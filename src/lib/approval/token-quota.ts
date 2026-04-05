/**
 * Token Quota Management
 *
 * Department-level token budget tracking and enforcement.
 * Reads quota limits from DepartmentConfig (.department/config.json).
 * Tracks usage in-memory and auto-generates approval requests on threshold breach.
 *
 * Input:  workspace path (identifies department)
 * Output: quota status (allowed, remaining, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import type { TokenQuota, TokenUsageEvent } from './types';
import type { DepartmentConfig } from '../types';

const log = createLogger('TokenQuota');

// ---------------------------------------------------------------------------
// In-memory usage tracking
// ---------------------------------------------------------------------------

const dailyUsage = new Map<string, number>();
const monthlyUsage = new Map<string, number>();

// ---------------------------------------------------------------------------
// Config reading
// ---------------------------------------------------------------------------

/**
 * Read DepartmentConfig.tokenQuota from .department/config.json.
 * Returns null if not configured.
 */
function readDepartmentQuota(workspace: string): DepartmentConfig['tokenQuota'] | null {
  try {
    const configPath = path.join(workspace.replace(/^file:\/\//, ''), '.department', 'config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as DepartmentConfig;
    return config.tokenQuota ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Quota Operations
// ---------------------------------------------------------------------------

/**
 * Check if a department has available token quota.
 *
 * @param workspace — Department workspace path.
 * @returns Whether the department can proceed and remaining tokens.
 */
export function checkTokenQuota(workspace: string): { allowed: boolean; remaining: number } {
  const quota = readDepartmentQuota(workspace);

  // No quota configured → unlimited
  if (!quota || (quota.daily <= 0 && quota.monthly <= 0)) {
    return { allowed: true, remaining: Infinity };
  }

  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  const usedDaily = dailyUsage.get(`${workspace}:${today}`) || 0;
  const usedMonthly = monthlyUsage.get(`${workspace}:${month}`) || 0;

  // Check daily limit
  if (quota.daily > 0 && usedDaily >= quota.daily) {
    log.warn({ workspace: workspace.slice(-30), usedDaily, limit: quota.daily }, 'Daily token quota exceeded');
    return { allowed: false, remaining: 0 };
  }

  // Check monthly limit
  if (quota.monthly > 0 && usedMonthly >= quota.monthly) {
    log.warn({ workspace: workspace.slice(-30), usedMonthly, limit: quota.monthly }, 'Monthly token quota exceeded');
    return { allowed: false, remaining: 0 };
  }

  const remainingDaily = quota.daily > 0 ? quota.daily - usedDaily : Infinity;
  const remainingMonthly = quota.monthly > 0 ? quota.monthly - usedMonthly : Infinity;
  const remaining = Math.min(remainingDaily, remainingMonthly);

  return { allowed: true, remaining };
}

/**
 * Record token usage for a department.
 *
 * @param workspace — Department workspace path.
 * @param tokens — Number of tokens used.
 */
export function recordTokenUsage(workspace: string, tokens: number): void {
  const dailyKey = `${workspace}:${new Date().toISOString().slice(0, 10)}`;
  const monthlyKey = `${workspace}:${new Date().toISOString().slice(0, 7)}`;

  dailyUsage.set(dailyKey, (dailyUsage.get(dailyKey) || 0) + tokens);
  monthlyUsage.set(monthlyKey, (monthlyUsage.get(monthlyKey) || 0) + tokens);

  log.debug({ workspace: workspace.slice(-30), tokens, dailyTotal: dailyUsage.get(dailyKey) }, 'Token usage recorded');
}

/**
 * Check if a department should auto-request more quota.
 *
 * Triggered when usage exceeds the configured threshold (default 80%).
 *
 * @param workspace — Department workspace path.
 * @param threshold — Fraction (0-1) at which to trigger. Default 0.8.
 * @returns Whether an automatic quota request should be generated.
 */
export function shouldAutoRequestQuota(workspace: string, threshold: number = 0.8): boolean {
  const quota = readDepartmentQuota(workspace);
  if (!quota || (quota.daily <= 0 && quota.monthly <= 0)) return false;

  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  const usedDaily = dailyUsage.get(`${workspace}:${today}`) || 0;
  const usedMonthly = monthlyUsage.get(`${workspace}:${month}`) || 0;

  if (quota.daily > 0 && usedDaily >= quota.daily * threshold) return true;
  if (quota.monthly > 0 && usedMonthly >= quota.monthly * threshold) return true;

  return false;
}

/**
 * Get quota summary for a department.
 *
 * @param workspace — Department workspace path.
 * @returns Current quota status.
 */
export function getQuotaSummary(workspace: string): TokenQuota {
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  const quota = readDepartmentQuota(workspace);

  return {
    daily: quota?.daily ?? 0,
    monthly: quota?.monthly ?? 0,
    used: {
      daily: dailyUsage.get(`${workspace}:${today}`) || 0,
      monthly: monthlyUsage.get(`${workspace}:${month}`) || 0,
    },
    canRequestMore: quota?.canRequestMore ?? true,
  };
}

/**
 * Reset daily usage counters.
 * Called by a scheduler at midnight.
 */
export function resetDailyUsage(): void {
  const today = new Date().toISOString().slice(0, 10);
  for (const key of dailyUsage.keys()) {
    if (!key.endsWith(today)) {
      dailyUsage.delete(key);
    }
  }
  log.debug('Daily usage counters reset');
}
