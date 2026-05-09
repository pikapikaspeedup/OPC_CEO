import { describe, expect, it } from 'vitest';

import { buildProjectTreeSectionSeeds } from '@/lib/project-tree-sections';
import type { DepartmentConfig, Workspace } from '@/lib/types';

describe('buildProjectTreeSectionSeeds', () => {
  it('keeps workspace placeholders visible when no department config exists', () => {
    const workspaces: Workspace[] = [
      {
        uri: 'file:///workspace/alpha',
        name: 'alpha',
      },
      {
        uri: 'file:///workspace/beta',
        name: 'beta',
      },
    ];

    const sections = buildProjectTreeSectionSeeds(workspaces, new Map(), '');

    expect(sections).toEqual([
      {
        key: 'file:///workspace/alpha',
        title: 'alpha',
        subtitle: '待配置部门',
        primaryWorkspaceUri: 'file:///workspace/alpha',
        boundWorkspaceUris: ['file:///workspace/alpha'],
        hasDepartmentConfig: false,
      },
      {
        key: 'file:///workspace/beta',
        title: 'beta',
        subtitle: '待配置部门',
        primaryWorkspaceUri: 'file:///workspace/beta',
        boundWorkspaceUris: ['file:///workspace/beta'],
        hasDepartmentConfig: false,
      },
    ]);
  });

  it('deduplicates multi-workspace departments onto the primary workspace section', () => {
    const workspaces: Workspace[] = [
      {
        uri: 'file:///workspace/alpha',
        name: 'alpha',
      },
      {
        uri: 'file:///workspace/beta',
        name: 'beta',
      },
    ];
    const department: DepartmentConfig = {
      name: 'AI情报工作室',
      type: 'build',
      skills: [],
      okr: null,
      departmentId: 'dept-ai',
      workspaceBindings: [
        {
          workspaceUri: 'file:///workspace/alpha',
          workspaceName: 'alpha',
          role: 'primary',
        },
        {
          workspaceUri: 'file:///workspace/beta',
          workspaceName: 'beta',
          role: 'secondary',
        },
      ],
    };

    const sections = buildProjectTreeSectionSeeds(
      workspaces,
      new Map<string, DepartmentConfig>([
        ['file:///workspace/alpha', department],
        ['file:///workspace/beta', department],
      ]),
      '',
    );

    expect(sections).toEqual([
      {
        key: 'file:///workspace/alpha',
        title: 'AI情报工作室',
        subtitle: '2 个工作区',
        primaryWorkspaceUri: 'file:///workspace/alpha',
        boundWorkspaceUris: ['file:///workspace/alpha', 'file:///workspace/beta'],
        hasDepartmentConfig: true,
      },
    ]);
  });
});
