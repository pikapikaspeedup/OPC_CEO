import { createLogger } from "../logger";

const log = createLogger("ScopeGovernor");

export interface WriteScopeEntry {
  path: string;
  operation: "create" | "modify" | "delete";
}

export interface ScopeConflict {
  path: string;
  packages: string[]; // taskIds that conflict
  operation: string;
}

/**
 * 检测多个 Work Package 的 writeScope 是否存在冲突
 * @param packages - 每个 WP 的 { taskId, writeScope: WriteScopeEntry[] }
 * @returns 冲突列表。空数组 = 无冲突
 */
export function checkWriteScopeConflicts(
  packages: { taskId: string; writeScope: WriteScopeEntry[] }[]
): ScopeConflict[] {
  const conflicts: ScopeConflict[] = [];
  const pathMap = new Map<string, { taskId: string; operation: string }[]>();

  for (const pkg of packages) {
    for (const entry of pkg.writeScope) {
      const key = entry.path;
      if (!pathMap.has(key)) pathMap.set(key, []);
      pathMap.get(key)!.push({ taskId: pkg.taskId, operation: entry.operation });
    }
  }

  for (const [path, entries] of pathMap) {
    if (entries.length > 1) {
      conflicts.push({
        path,
        packages: entries.map(e => e.taskId),
        operation: entries.map(e => e.operation).join("/"),
      });
    }
  }

  if (conflicts.length > 0) {
    log.warn({ conflictCount: conflicts.length, paths: conflicts.map(c => c.path) }, "WriteScope conflicts detected");
  } else {
    log.info({ packageCount: packages.length }, "No writeScope conflicts");
  }

  return conflicts;
}

/**
 * 检测多个 delivery packet 的实际变更文件是否有交叉
 * @param deliveries - 每个 delivery 的 { taskId, changedFiles: string[] }
 * @returns 冲突列表
 */
export function checkDeliveryConflicts(
  deliveries: { taskId: string; changedFiles: string[] }[]
): ScopeConflict[] {
  const conflicts: ScopeConflict[] = [];
  const fileMap = new Map<string, string[]>();

  for (const d of deliveries) {
    for (const file of d.changedFiles) {
      if (!fileMap.has(file)) fileMap.set(file, []);
      fileMap.get(file)!.push(d.taskId);
    }
  }

  for (const [file, taskIds] of fileMap) {
    if (taskIds.length > 1) {
      conflicts.push({ path: file, packages: taskIds, operation: "modify" });
    }
  }

  return conflicts;
}
