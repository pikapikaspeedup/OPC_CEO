import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAgentBackends, registerAgentBackend, type AgentBackend } from '../backends';

const mockGetCanonicalWorkflow = vi.fn();
const mockGetCanonicalSkill = vi.fn();
const mockGetTemplate = vi.fn();

vi.mock('./canonical-assets', () => ({
  getCanonicalWorkflow: (...args: unknown[]) => mockGetCanonicalWorkflow(...args),
  getCanonicalSkill: (...args: unknown[]) => mockGetCanonicalSkill(...args),
}));

vi.mock('./asset-loader', () => ({
  AssetLoader: {
    getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
  },
}));

import {
  buildDepartmentIdentityRule,
  getDepartmentProviderCapabilityProfile,
  getDepartmentProviderExecutionSupport,
  getDepartmentCapabilityView,
  getTemplateWorkflowRefs,
  readDepartmentConfig,
} from './department-capability-registry';
import { ARTIFACT_ROOT_DIR } from './gateway-home';

describe('department-capability-registry', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dept-capability-'));
    clearAgentBackends();
    fs.mkdirSync(path.join(workspace, '.department'), { recursive: true });
    fs.mkdirSync(path.join(workspace, '.agents', 'rules'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, '.department', 'config.json'),
      JSON.stringify({
        name: 'AI 情报中心',
        type: 'research',
        description: '负责日报与情报整理',
        templateIds: ['morning-brief-template'],
        provider: 'native-codex',
        skills: [
          {
            skillId: 'daily_digest',
            name: '日报总结',
            category: 'research',
            workflowRef: '/ai_digest',
            skillRefs: ['browser-testing'],
          },
        ],
      }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(workspace, '.agents', 'rules', 'project-context.md'),
      '# 项目上下文\n\n旧规则也应被注入',
      'utf-8',
    );

    mockGetCanonicalWorkflow.mockReset();
    mockGetCanonicalSkill.mockReset();
    mockGetTemplate.mockReset();
  });

  afterEach(() => {
    clearAgentBackends();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('reads department config and builds identity prompt', () => {
    const config = readDepartmentConfig(workspace);
    const identity = buildDepartmentIdentityRule(config, workspace);

    expect(config.name).toBe('AI 情报中心');
    expect(identity).toContain('AI 情报中心');
    expect(identity).toContain('日报总结');
    expect(identity).toContain('morning-brief-template');
  });

  it('builds capability view from department config and canonical assets', () => {
    mockGetCanonicalWorkflow.mockReturnValue({
      name: 'ai_digest',
      description: '日报 workflow',
      content: '# ai digest',
      path: '/canonical/ai_digest.md',
      baseDir: '/canonical',
      scope: 'global',
      source: 'canonical',
    });
    mockGetCanonicalSkill.mockReturnValue({
      name: 'browser-testing',
      description: '测试 skill',
      content: '# browser testing',
      path: '/canonical/skills/browser-testing/SKILL.md',
      baseDir: '/canonical/skills/browser-testing',
      scope: 'global',
      source: 'canonical',
    });

    const view = getDepartmentCapabilityView(workspace);

    expect(view.workflows.map((entry) => entry.name)).toEqual(['ai_digest']);
    expect(view.skills[0]?.workflow?.name).toBe('ai_digest');
    expect(view.skills[0]?.fallbackSkills.map((entry) => entry.name)).toEqual(['browser-testing']);
    expect(view.localRules.map((entry) => entry.name)).toContain('project-context');
    expect(view.departmentContract.workspaceUri).toBe(`file://${workspace}`);
    expect(view.departmentContract.providerPolicy.defaultProvider).toBe('native-codex');
    expect(view.departmentContract.workflowRefs).toEqual(['/ai_digest']);
    expect(view.runtimeContract.workspaceRoot).toBe(workspace);
    expect(view.runtimeContract.artifactRoot).toBe(path.join(workspace, ARTIFACT_ROOT_DIR));
    expect(view.runtimeContract.toolset).toBe('research');
    expect(view.runtimeContract.executionClass).toBe('artifact-heavy');
    expect(view.runtimeContract.permissionMode).toBe('default');
    expect(view.runtimeContract.readRoots).toEqual(
      expect.arrayContaining([workspace, path.join(workspace, ARTIFACT_ROOT_DIR)]),
    );
    expect(view.runtimeContract.writeRoots).toEqual(
      expect.arrayContaining([workspace, path.join(workspace, ARTIFACT_ROOT_DIR)]),
    );
  });

  it('injects bound workspaces and context documents into the runtime contract', () => {
    const sharedDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'dept-capability-shared-'));
    fs.writeFileSync(
      path.join(workspace, '.department', 'config.json'),
      JSON.stringify({
        name: 'AI 情报中心',
        type: 'research',
        skills: [],
        okr: null,
        workspaceBindings: [
          { workspaceUri: `file://${workspace}`, role: 'primary', writeAccess: true },
          { workspaceUri: `file://${sharedDocs}`, role: 'context', writeAccess: false },
        ],
        executionPolicy: {
          defaultWorkspaceUri: `file://${workspace}`,
          contextDocumentPaths: ['docs/brief.md'],
        },
      }),
      'utf-8',
    );

    const view = getDepartmentCapabilityView(workspace);

    expect(view.runtimeContract.additionalWorkingDirectories).toContain(sharedDocs);
    expect(view.runtimeContract.readRoots).toEqual(
      expect.arrayContaining([sharedDocs, path.join(workspace, 'docs/brief.md')]),
    );
    expect(view.runtimeContract.writeRoots).not.toContain(sharedDocs);

    fs.rmSync(sharedDocs, { recursive: true, force: true });
  });

  it('collects workflow refs from templates', () => {
    mockGetTemplate.mockReturnValue({
      id: 'morning-brief-template',
      stages: {
        collect: {
          roles: [{ workflow: '/market-collector' }],
        },
        compose: {
          roles: [{ workflow: '/brief-composer' }],
        },
      },
    });

    expect(getTemplateWorkflowRefs('morning-brief-template')).toEqual([
      '/market-collector',
      '/brief-composer',
    ]);
  });

  it('routes native-codex through Claude Engine Department mainline after cutover', () => {
    const profile = getDepartmentProviderCapabilityProfile('native-codex');
    const support = getDepartmentProviderExecutionSupport('native-codex', 'review-loop');

    expect(profile.runtimeFamily).toBe('claude-engine');
    expect(profile.departmentMainline).toBe('claude-engine');
    expect(profile.notes.join(' ')).toContain('native-codex Department mainline is routed through Claude Engine');
    expect(profile.supportedExecutionClasses).toEqual([
      'light',
      'artifact-heavy',
      'review-loop',
      'delivery',
    ]);
    expect(support.supported).toBe(true);
    expect(support.missingCapabilities).toEqual([]);
  });

  it('upgrades native-codex capability profile after the Department backend exposes Claude Engine runtime capabilities', () => {
    const backend: AgentBackend = {
      providerId: 'native-codex',
      capabilities: () => ({
        supportsAppend: true,
        supportsCancel: true,
        emitsLiveState: false,
        emitsRawSteps: false,
        emitsStreamingText: true,
        departmentRuntime: {
          supportsDepartmentRuntime: true,
          supportsToolRuntime: true,
          supportsArtifactContracts: true,
          supportsReadWriteAudit: true,
          supportsPermissionEnforcement: true,
          supportsReviewLoops: true,
        },
      }),
      start: async () => {
        throw new Error('not used');
      },
      attach: async () => {
        throw new Error('not used');
      },
    };
    registerAgentBackend(backend);

    const profile = getDepartmentProviderCapabilityProfile('native-codex');
    const support = getDepartmentProviderExecutionSupport('native-codex', 'review-loop');

    expect(profile.runtimeFamily).toBe('claude-engine');
    expect(profile.departmentMainline).toBe('claude-engine');
    expect(profile.supportedExecutionClasses).toEqual([
      'light',
      'artifact-heavy',
      'review-loop',
      'delivery',
    ]);
    expect(support.supported).toBe(true);
    expect(support.missingCapabilities).toEqual([]);
  });
});
