import { describe, expect, it } from 'vitest';

import {
  getDepartmentBoundWorkspaceUris,
  getDepartmentContextDocumentPaths,
  getDepartmentDefaultWorkspaceUri,
  getDepartmentWorkspaceBindings,
  mergeDepartmentConfigIntoWorkspaceMap,
  normalizeDepartmentConfig,
} from './department-config';
import type { DepartmentConfig } from './types';

describe('department-config helpers', () => {
  it('creates a primary workspace binding for legacy departments', () => {
    const normalized = normalizeDepartmentConfig({
      name: 'Engineering',
      type: 'build',
      skills: [],
      okr: null,
    }, 'file:///tmp/engineering', 'engineering');

    expect(normalized.workspaceBindings).toEqual([
      {
        workspaceUri: 'file:///tmp/engineering',
        alias: 'engineering',
        role: 'primary',
        writeAccess: true,
      },
    ]);
    expect(normalized.executionPolicy).toEqual({
      defaultWorkspaceUri: 'file:///tmp/engineering',
      contextDocumentPaths: [],
    });
  });

  it('normalizes multi-workspace bindings and a single primary workspace', () => {
    const config: DepartmentConfig = {
      name: 'AI 情报工作室',
      type: 'research',
      skills: [],
      okr: null,
      workspaceBindings: [
        { workspaceUri: 'file:///tmp/shared-docs', role: 'context', writeAccess: true },
        { workspaceUri: 'file:///tmp/primary', role: 'execution', writeAccess: true },
      ],
      executionPolicy: {
        defaultWorkspaceUri: 'file:///tmp/primary',
        contextDocumentPaths: [' docs/brief.md ', 'docs/brief.md', ' playbook/route.md '],
      },
    };

    expect(getDepartmentWorkspaceBindings(config, 'file:///tmp/primary')).toEqual([
      { workspaceUri: 'file:///tmp/primary', role: 'primary', writeAccess: true },
      { workspaceUri: 'file:///tmp/shared-docs', role: 'context', writeAccess: false },
    ]);
    expect(getDepartmentDefaultWorkspaceUri(config, 'file:///tmp/primary')).toBe('file:///tmp/primary');
    expect(getDepartmentContextDocumentPaths(config)).toEqual(['docs/brief.md', 'playbook/route.md']);
    expect(getDepartmentBoundWorkspaceUris(config, 'file:///tmp/primary')).toEqual([
      'file:///tmp/primary',
      'file:///tmp/shared-docs',
    ]);
  });

  it('merges a department config into all bound workspace keys', () => {
    const existing = new Map<string, DepartmentConfig>([
      ['file:///tmp/legacy', {
        departmentId: 'department:file:///tmp/legacy',
        name: 'Legacy',
        type: 'build',
        skills: [],
        okr: null,
      }],
    ]);

    const next = mergeDepartmentConfigIntoWorkspaceMap(existing, 'file:///tmp/primary', {
      name: 'Platform',
      type: 'build',
      skills: [],
      okr: null,
      workspaceBindings: [
        { workspaceUri: 'file:///tmp/primary', role: 'primary', writeAccess: true },
        { workspaceUri: 'file:///tmp/shared', role: 'context', writeAccess: false },
      ],
      executionPolicy: {
        defaultWorkspaceUri: 'file:///tmp/primary',
      },
    });

    expect(next.get('file:///tmp/primary')?.name).toBe('Platform');
    expect(next.get('file:///tmp/shared')?.name).toBe('Platform');
    expect(next.get('file:///tmp/legacy')?.name).toBe('Legacy');
  });
});
