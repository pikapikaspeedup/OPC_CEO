import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendRunConfig } from '../backends/types';

const mockGetDepartmentCapabilityView = vi.fn();
const mockGetTemplateWorkflowRefs = vi.fn();
const mockGetCanonicalWorkflow = vi.fn();
const mockGetDepartmentProviderCapabilityProfile = vi.fn();
const mockGetDepartmentProviderExecutionSupport = vi.fn();

vi.mock('./department-capability-registry', () => ({
  getDepartmentCapabilityView: (...args: unknown[]) => mockGetDepartmentCapabilityView(...args),
  getTemplateWorkflowRefs: (...args: unknown[]) => mockGetTemplateWorkflowRefs(...args),
  getDepartmentProviderCapabilityProfile: (...args: unknown[]) => mockGetDepartmentProviderCapabilityProfile(...args),
  getDepartmentProviderExecutionSupport: (...args: unknown[]) => mockGetDepartmentProviderExecutionSupport(...args),
}));

vi.mock('./canonical-assets', () => ({
  getCanonicalWorkflow: (...args: unknown[]) => mockGetCanonicalWorkflow(...args),
}));

import {
  applyProviderExecutionContext,
  buildPromptModeProviderExecutionContext,
  resolveCapabilityAwareProvider,
  buildTemplateProviderExecutionContext,
} from './department-execution-resolver';

function makeCapabilityView(overrides: Record<string, unknown> = {}) {
  const base = {
    workspacePath: '/tmp/ws',
    config: { name: '情报部', type: 'research', skills: [], templateIds: [] },
    departmentContract: {
      workspaceUri: 'file:///tmp/ws',
      name: '情报部',
      type: 'research',
      responsibilities: ['日报总结'],
      providerPolicy: {},
      workflowRefs: [],
      skillRefs: [],
      memoryScopes: {
        department: true,
        organization: true,
        providerSpecific: false,
      },
    },
    runtimeContract: {
      workspaceRoot: '/tmp/ws',
      additionalWorkingDirectories: [],
      readRoots: ['/tmp/ws', '/tmp/ws/demolong'],
      writeRoots: ['/tmp/ws/demolong', '/tmp/ws'],
      artifactRoot: '/tmp/ws/demolong',
      executionClass: 'light' as const,
      toolset: 'research' as const,
      permissionMode: 'default' as const,
    },
    identityRule: '# identity',
    localRules: [],
    workflows: [],
    skills: [],
    templateIds: [],
  };

  return {
    ...base,
    ...overrides,
    config: {
      ...base.config,
      ...((overrides as { config?: Record<string, unknown> }).config ?? {}),
    },
    departmentContract: {
      ...base.departmentContract,
      ...((overrides as { departmentContract?: Record<string, unknown> }).departmentContract ?? {}),
    },
    runtimeContract: {
      ...base.runtimeContract,
      ...((overrides as { runtimeContract?: Record<string, unknown> }).runtimeContract ?? {}),
    },
  };
}

describe('department-execution-resolver', () => {
  beforeEach(() => {
    mockGetDepartmentCapabilityView.mockReset();
    mockGetTemplateWorkflowRefs.mockReset();
    mockGetCanonicalWorkflow.mockReset();
    mockGetDepartmentProviderCapabilityProfile.mockReset();
    mockGetDepartmentProviderExecutionSupport.mockReset();
    mockGetDepartmentCapabilityView.mockReturnValue(makeCapabilityView());
    mockGetDepartmentProviderCapabilityProfile.mockImplementation((providerId: string) => ({
      providerId,
      runtimeFamily: providerId === 'native-codex' ? 'local-light' : 'claude-engine',
      departmentMainline: providerId === 'native-codex' ? 'native' : 'claude-engine',
      runtimeCapabilities: {
        supportsDepartmentRuntime: providerId !== 'native-codex',
        supportsToolRuntime: providerId !== 'native-codex',
        supportsArtifactContracts: providerId !== 'native-codex',
        supportsReadWriteAudit: providerId !== 'native-codex',
        supportsPermissionEnforcement: providerId !== 'native-codex',
        supportsReviewLoops: providerId !== 'native-codex',
      },
      supportedExecutionClasses: providerId === 'native-codex'
        ? ['light']
        : ['light', 'artifact-heavy', 'review-loop', 'delivery'],
      notes: providerId === 'native-codex'
        ? ['Local conversation/chat shell support does not qualify native-codex as Department runtime.']
        : ['Claude Engine runtime provider.'],
    }));
    mockGetDepartmentProviderExecutionSupport.mockImplementation((providerId: string, executionClass: string) => {
      const supported = providerId !== 'native-codex' || executionClass === 'light';
      return {
        providerId,
        executionClass,
        supported,
        missingCapabilities: supported
          ? []
          : ['supportsDepartmentRuntime', 'supportsToolRuntime', 'supportsArtifactContracts'],
        profile: mockGetDepartmentProviderCapabilityProfile(providerId),
        requirement: {
          executionClass,
          requiredCapabilities: [],
          description: `${executionClass} requirement`,
        },
      };
    });
  });

  it('rejects template execution when template is not allowed for the department', () => {
    mockGetDepartmentCapabilityView.mockReturnValue(makeCapabilityView({
      config: {
        name: '研发部',
        type: 'build',
        skills: [],
        templateIds: ['coding-basic-template'],
      },
      templateIds: ['coding-basic-template'],
    }));

    expect(() => buildTemplateProviderExecutionContext('/tmp/ws', 'morning-brief-template')).toThrow(
      'is not allowed',
    );
  });

  it('builds template runtime contract and execution metadata for template mode', () => {
    mockGetDepartmentCapabilityView.mockReturnValue(makeCapabilityView({
      config: { templateIds: ['morning-brief-template'] },
      templateIds: ['morning-brief-template'],
      runtimeContract: {
        executionClass: 'artifact-heavy',
        toolset: 'coding',
      },
    }));
    mockGetTemplateWorkflowRefs.mockReturnValue(['/market-collector']);
    mockGetCanonicalWorkflow.mockReturnValue({
      name: 'market-collector',
      description: '收集器',
      content: '# MARKET COLLECTOR',
      path: '/tmp/market-collector.md',
      baseDir: '/tmp',
      scope: 'global',
      source: 'canonical',
    });

    const context = buildTemplateProviderExecutionContext('/tmp/ws', 'morning-brief-template');

    expect(context.executionProfile).toEqual({
      kind: 'dag-orchestration',
      templateId: 'morning-brief-template',
    });
    expect(context.runtimeContract?.executionClass).toBe('artifact-heavy');
    expect(context.runtimeContract?.toolset).toBe('coding');
    expect(context.runtimeContract?.requiredArtifacts).toBeUndefined();
    expect(context.resolution).toEqual({
      resolutionReason: 'Template "morning-brief-template" selected by governance; department context injected for provider execution.',
    });
  });

  it('injects explicit prompt workflow refs for prompt mode', () => {
    mockGetDepartmentCapabilityView.mockReturnValue(makeCapabilityView());
    mockGetCanonicalWorkflow.mockReturnValue({
      name: 'ai_digest',
      description: '日报',
      content: '# AI DIGEST',
      path: '/tmp/ai_digest.md',
      baseDir: '/tmp',
      scope: 'global',
      source: 'canonical',
    });

    const context = buildPromptModeProviderExecutionContext('/tmp/ws', {
      promptAssetRefs: ['/ai_digest'],
    });

    expect(context.resolvedWorkflowRef).toBe('/ai_digest');
    expect(context.resolvedSkillRefs).toBeUndefined();
    expect(context.promptPreamble).toContain('AI DIGEST');
    expect(context.resolutionReason).toContain('explicit workflow refs');
    expect(context.promptResolution?.mode).toBe('workflow');
    expect(context.promptResolution?.workflowSuggestion).toBeUndefined();
    expect(context.executionProfile).toEqual({
      kind: 'workflow-run',
      workflowRef: '/ai_digest',
    });
    expect(context.resolution).toMatchObject({
      resolvedWorkflowRef: '/ai_digest',
      resolutionReason: context.resolutionReason,
    });
    expect(context.runtimeContract?.executionClass).toBe('light');
    expect(context.runtimeContract?.toolset).toBe('research');
    expect(context.runtimeContract?.requiredArtifacts).toBeUndefined();

    const backendConfig: BackendRunConfig = {
      runId: 'run-1',
      workspacePath: '/tmp/ws',
      prompt: '总结日报',
      runtimeContract: context.runtimeContract,
      executionProfile: context.executionProfile,
      resolution: context.resolution,
      toolset: context.runtimeContract?.toolset,
      permissionMode: context.runtimeContract?.permissionMode,
      additionalWorkingDirectories: context.runtimeContract?.additionalWorkingDirectories,
      readRoots: context.runtimeContract?.readRoots,
      allowedWriteRoots: context.runtimeContract?.writeRoots,
      requiredArtifacts: context.runtimeContract?.requiredArtifacts,
    };

    expect(backendConfig.executionProfile?.kind).toBe('workflow-run');
    expect(backendConfig.resolution?.resolvedWorkflowRef).toBe('/ai_digest');
    expect(backendConfig.allowedWriteRoots).toEqual(
      expect.arrayContaining(['/tmp/ws', '/tmp/ws/demolong']),
    );
  });

  it('falls back to department skills when no workflow is configured', () => {
    mockGetDepartmentCapabilityView.mockReturnValue(makeCapabilityView({
      skills: [{
        skillId: 'browser-testing',
        name: '浏览器测试',
        category: 'research',
        skillRefs: ['browser-testing'],
        fallbackSkills: [{
          name: 'browser-testing',
          description: '测试',
          content: '# SKILL CONTENT',
          path: '/tmp/skills/browser-testing/SKILL.md',
          baseDir: '/tmp/skills/browser-testing',
          scope: 'global',
          source: 'canonical',
        }],
      }],
    }));

    const context = buildPromptModeProviderExecutionContext('/tmp/ws', {});

    expect(context.resolvedWorkflowRef).toBeUndefined();
    expect(context.resolvedSkillRefs).toEqual(['browser-testing']);
    expect(context.promptPreamble).toContain('SKILL CONTENT');
    expect(context.resolutionReason).toContain('skill fallback');
    expect(context.promptResolution?.mode).toBe('skill');
    expect(context.promptResolution?.workflowSuggestion?.shouldCreateWorkflow).toBe(true);
    expect(context.executionProfile).toEqual({
      kind: 'workflow-run',
      skillHints: ['browser-testing'],
    });
  });

  it('prefers the workflow bound to a matched department skill', () => {
    mockGetDepartmentCapabilityView.mockReturnValue(makeCapabilityView({
      config: { name: 'AI 情报工作室', type: 'research', skills: [], templateIds: [] },
      departmentContract: { name: 'AI 情报工作室' },
      workflows: [
        {
          name: 'ai_digest',
          description: '日报',
          content: '# AI DIGEST',
          path: '/tmp/ai_digest.md',
          baseDir: '/tmp',
          scope: 'global',
          source: 'canonical',
        },
        {
          name: 'ai_bigevent',
          description: '大事件',
          content: '# AI BIG EVENT',
          path: '/tmp/ai_bigevent.md',
          baseDir: '/tmp',
          scope: 'global',
          source: 'canonical',
        },
      ],
      skills: [
        {
          skillId: 'reporting',
          name: '日报总结',
          category: 'research',
          workflowRef: '/ai_digest',
          workflow: {
            name: 'ai_digest',
            description: '日报',
            content: '# AI DIGEST',
            path: '/tmp/ai_digest.md',
            baseDir: '/tmp',
            scope: 'global',
            source: 'canonical',
          },
          skillRefs: ['reporting'],
          fallbackSkills: [],
        },
        {
          skillId: 'ai-bigevent',
          name: 'AI 大事件',
          category: 'research',
          workflowRef: '/ai_bigevent',
          workflow: {
            name: 'ai_bigevent',
            description: '大事件',
            content: '# AI BIG EVENT',
            path: '/tmp/ai_bigevent.md',
            baseDir: '/tmp',
            scope: 'global',
            source: 'canonical',
          },
          skillRefs: ['baogaoai-ai-bigevent-generator'],
          fallbackSkills: [{
            name: 'baogaoai-ai-bigevent-generator',
            description: '大事件 skill',
            content: '# BIG EVENT SKILL',
            path: '/tmp/skills/baogaoai-ai-bigevent-generator/SKILL.md',
            baseDir: '/tmp/skills/baogaoai-ai-bigevent-generator',
            scope: 'global',
            source: 'canonical',
          }],
        },
      ],
    }));

    const context = buildPromptModeProviderExecutionContext('/tmp/ws', {
      promptText: 'AI情报工作室提炼今天的 AI 大事件并上报',
    });

    expect(context.resolvedWorkflowRef).toBe('/ai_bigevent');
    expect(context.resolvedSkillRefs).toEqual(['baogaoai-ai-bigevent-generator']);
    expect(context.promptResolution?.mode).toBe('workflow');
    expect(context.promptResolution?.matchedWorkflowRefs).toEqual(['/ai_bigevent']);
    expect(context.promptResolution?.matchedSkillRefs).toEqual(['baogaoai-ai-bigevent-generator']);
  });

  it('prepends department context without mutating the base prompt semantics', () => {
    const text = applyProviderExecutionContext('Original prompt', {
      promptPreamble: '<ctx>Department</ctx>',
      resolutionReason: 'Injected',
    });

    expect(text).toContain('<ctx>Department</ctx>');
    expect(text.endsWith('Original prompt')).toBe(true);
  });

  it('falls back from native-codex to a stronger Department runtime for review-loop work', () => {
    mockGetDepartmentCapabilityView.mockReturnValue(makeCapabilityView({
      departmentContract: {
        providerPolicy: {
          defaultProvider: 'native-codex',
          allowedProviders: ['native-codex', 'claude-api'],
        },
      },
    }));

    const routing = resolveCapabilityAwareProvider({
      workspacePath: '/tmp/ws',
      requestedProvider: 'native-codex',
      requestedModel: 'gpt-5.4',
      runtimeContract: {
        ...makeCapabilityView().runtimeContract,
        executionClass: 'review-loop',
      },
    });

    expect(routing.selectedProvider).toBe('claude-api');
    expect(routing.requiredExecutionClass).toBe('review-loop');
    expect(routing.routingMode).toBe('fallback');
    expect(routing.reason).toContain('moved review-loop work from "native-codex" to "claude-api"');
  });

  it('keeps native-codex when the Department backend already exposes Claude Engine capabilities', () => {
    mockGetDepartmentProviderCapabilityProfile.mockImplementation((providerId: string) => ({
      providerId,
      runtimeFamily: 'claude-engine',
      departmentMainline: 'claude-engine',
      runtimeCapabilities: {
        supportsDepartmentRuntime: true,
        supportsToolRuntime: true,
        supportsArtifactContracts: true,
        supportsReadWriteAudit: true,
        supportsPermissionEnforcement: true,
        supportsReviewLoops: true,
      },
      supportedExecutionClasses: ['light', 'artifact-heavy', 'review-loop', 'delivery'],
      notes: ['native-codex Department mainline is on Claude Engine.'],
    }));
    mockGetDepartmentProviderExecutionSupport.mockImplementation((providerId: string, executionClass: string) => ({
      providerId,
      executionClass,
      supported: true,
      missingCapabilities: [],
      profile: mockGetDepartmentProviderCapabilityProfile(providerId),
      requirement: {
        executionClass,
        requiredCapabilities: [],
        description: `${executionClass} requirement`,
      },
    }));

    const routing = resolveCapabilityAwareProvider({
      workspacePath: '/tmp/ws',
      requestedProvider: 'native-codex',
      requestedModel: 'gpt-5.4',
      runtimeContract: {
        ...makeCapabilityView().runtimeContract,
        executionClass: 'artifact-heavy',
      },
    });

    expect(routing.selectedProvider).toBe('native-codex');
    expect(routing.routingMode).toBe('preferred');
    expect(routing.reason).toContain('kept provider "native-codex"');
  });

  it('falls back from native-codex for delivery-class Department work', () => {
    const routing = resolveCapabilityAwareProvider({
      workspacePath: '/tmp/ws',
      requestedProvider: 'native-codex',
      requestedModel: 'gpt-5.4',
      runtimeContract: {
        ...makeCapabilityView().runtimeContract,
        executionClass: 'delivery',
      },
    });

    expect(routing.selectedProvider).toBe('claude-api');
    expect(routing.requiredExecutionClass).toBe('delivery');
    expect(routing.routingMode).toBe('fallback');
    expect(routing.reason).toContain('moved delivery work from "native-codex" to "claude-api"');
  });
});
