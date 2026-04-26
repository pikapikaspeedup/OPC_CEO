import type { AuditEvent } from './api';
import type { DailyDigestFE } from './types';

export function pickLatestDailyDigest(
  digests: Array<DailyDigestFE | null | undefined>,
): DailyDigestFE | null {
  const available = digests.filter((digest): digest is DailyDigestFE => {
    if (!digest) return false;
    if (!digest.date || !/^\d{4}-\d{2}-\d{2}$/.test(digest.date)) return false;
    return Boolean(
      digest.summary?.trim()
      || digest.tasksCompleted.length
      || digest.tasksInProgress.length
      || digest.blockers.length,
    );
  });

  if (!available.length) return null;

  return [...available].sort((left, right) => {
    const dateDiff = right.date.localeCompare(left.date);
    if (dateDiff) return dateDiff;

    const rightActivity = right.tasksCompleted.length + right.tasksInProgress.length + right.blockers.length;
    const leftActivity = left.tasksCompleted.length + left.tasksInProgress.length + left.blockers.length;
    if (rightActivity !== leftActivity) return rightActivity - leftActivity;

    return right.departmentName.localeCompare(left.departmentName);
  })[0] || null;
}

export function dedupeAuditEvents(events: AuditEvent[], limit = 4, perKindLimit = 1): AuditEvent[] {
  const seen = new Set<string>();
  const kindCounts = new Map<string, number>();
  const result: AuditEvent[] = [];

  for (const event of events) {
    const key = `${event.kind}:${event.message}`;
    if (seen.has(key)) continue;

    const kindCount = kindCounts.get(event.kind) || 0;
    if (kindCount >= perKindLimit) continue;

    seen.add(key);
    kindCounts.set(event.kind, kindCount + 1);
    result.push(event);
    if (result.length >= limit) break;
  }

  return result;
}
