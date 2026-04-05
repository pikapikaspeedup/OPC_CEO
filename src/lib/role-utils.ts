/**
 * OPC Phase 0: Role personification utilities
 */

import { getMessage, interpolate, type Locale } from './i18n/index';
import type { DepartmentRoster } from './types';

/** Map roleId/roleKey patterns to display emoji */
export function resolveRoleAvatar(roleKey: string): string {
  const key = roleKey.toLowerCase();
  if (/\bpm\b|product[-_\s]|^product$/.test(key)) return '📋';
  if (/ops|devops|infra|monitor/.test(key)) return '⚙️';
  if (/dev|engineer|code|programmer/.test(key)) return '💻';
  if (/qa|test|quality/.test(key)) return '🧪';
  if (/design|ui|ux/.test(key)) return '🎨';
  if (/review|lead|senior|architect/.test(key)) return '👔';
  if (/research|analyst/.test(key)) return '🔍';
  if (/ops|devops|infra|monitor/.test(key)) return '⚙️';
  if (/write|content|doc/.test(key)) return '✍️';
  if (/security|sec/.test(key)) return '🔒';
  return '🤖';
}

/** Generate a deterministic display name from roleId */
export function resolveRoleDisplayName(roleId: string): string {
  return roleId
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/** Generate human-readable status text for a role */
export function resolveRoleStatusText(
  status: string,
  locale: Locale = 'zh',
  stageTitle?: string,
): string {
  if (stageTitle) {
    const withStageKey = `role.status.${status}WithStage`;
    const withStageTemplate = getMessage(locale, withStageKey);
    if (withStageTemplate !== withStageKey) {
      return interpolate(withStageTemplate, { stage: stageTitle });
    }
  }
  return getMessage(locale, `role.status.${status}`);
}

// OPC Phase 0 F1.5 — Deterministic name hashing
const NAME_POOL = ['小明','小红','小刚','小芳','阿强','阿华','志远','雨萱','浩然','子涵','思琪','梓轩','晓峰','雅婷','文博','佳琪','宇轩','诗涵','天佑','月华'];

export function hashRoleToName(roleId: string, salt?: string): string {
  const input = salt ? `${salt}::${roleId}` : roleId;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return NAME_POOL[Math.abs(hash) % NAME_POOL.length];
}

export function resolveCharacterName(
  roleId: string,
  workspaceUri?: string,
  roster?: DepartmentRoster[],
): string {
  if (roster) {
    for (const entry of roster) {
      try {
        if (new RegExp(entry.rolePattern, 'i').test(roleId)) return entry.displayName;
      } catch { /* invalid regex, skip */ }
    }
  }
  return hashRoleToName(roleId, workspaceUri);
}
