'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { api } from '@/lib/api';
import { mergeDepartmentConfigIntoWorkspaceMap } from '@/lib/department-config';
import { countConfiguredDepartments, countExistingDepartments } from '@/lib/home-shell';
import type { DepartmentConfig } from '@/lib/types';

export interface DepartmentConfigsState {
  departmentsMap: Map<string, DepartmentConfig>;
  setDepartmentsMap: Dispatch<SetStateAction<Map<string, DepartmentConfig>>>;
  existingDepartmentCount: number;
  configuredDepartmentCount: number;
  missingDepartmentCount: number;
  incompleteDepartmentProfileCount: number;
  isOpcUnconfigured: boolean;
}

/**
 * OPC Phase 3: load and derive department configuration state for the set of
 * workspaces shown on the home shell. Owns the department directory fetch
 * (re-runs whenever the workspace set changes) plus the derived counts that
 * drive the onboarding / CEO-office summary UI.
 *
 * Extracted from the page.tsx god component; only `.uri` of each workspace is
 * consumed, so the parameter is intentionally the minimal structural shape.
 */
export function useDepartmentConfigs(
  departmentWorkspaces: Array<{ uri: string }>,
): DepartmentConfigsState {
  const [departmentsMap, setDepartmentsMap] = useState<Map<string, DepartmentConfig>>(new Map());
  const wsKey = useMemo(() => departmentWorkspaces.map((w) => w.uri).join(','), [departmentWorkspaces]);

  useEffect(() => {
    let cancelled = false;

    api.departments()
      .then((entries) => {
        if (cancelled) return;
        let next = new Map<string, DepartmentConfig>();
        for (const entry of entries) {
          next = mergeDepartmentConfigIntoWorkspaceMap(next, entry.primaryWorkspaceUri, entry.config);
        }
        setDepartmentsMap(next);
      })
      .catch(() => {
        if (!cancelled) {
          setDepartmentsMap(new Map());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [wsKey]);

  const existingDepartmentCount = useMemo(
    () => countExistingDepartments(departmentWorkspaces, departmentsMap),
    [departmentWorkspaces, departmentsMap],
  );
  const configuredDepartmentCount = useMemo(
    () => countConfiguredDepartments(departmentWorkspaces, departmentsMap),
    [departmentWorkspaces, departmentsMap],
  );
  const missingDepartmentCount = useMemo(
    () => Math.max(departmentWorkspaces.length - existingDepartmentCount, 0),
    [departmentWorkspaces.length, existingDepartmentCount],
  );
  const incompleteDepartmentProfileCount = useMemo(
    () => Math.max(existingDepartmentCount - configuredDepartmentCount, 0),
    [configuredDepartmentCount, existingDepartmentCount],
  );
  const isOpcUnconfigured = useMemo(() => {
    if (!departmentWorkspaces.length) return false;
    return missingDepartmentCount > 0 || incompleteDepartmentProfileCount > 0;
  }, [departmentWorkspaces.length, incompleteDepartmentProfileCount, missingDepartmentCount]);

  return {
    departmentsMap,
    setDepartmentsMap,
    existingDepartmentCount,
    configuredDepartmentCount,
    missingDepartmentCount,
    incompleteDepartmentProfileCount,
    isOpcUnconfigured,
  };
}
