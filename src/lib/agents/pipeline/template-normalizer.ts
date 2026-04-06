import type {
  StageCapabilities,
  StageDefinition,
  StageExecutionConfig,
  StageRoleDefinition,
  StageSourceContract,
} from '../group-types';
import type { GraphPipelineNode } from './graph-pipeline-types';
import type { PipelineStage, TemplateDefinition } from './pipeline-types';

type LegacyNodeLike = Partial<StageExecutionConfig> & {
  id?: string;
  stageId?: string;
  groupId?: string;
  label?: string;
  kind?: GraphPipelineNode['kind'];
  stageType?: PipelineStage['stageType'];
  autoTrigger?: boolean;
  triggerOn?: PipelineStage['triggerOn'];
  promptTemplate?: string;
  upstreamStageIds?: string[];
  fanOutSource?: PipelineStage['fanOutSource'];
  joinFrom?: PipelineStage['joinFrom'];
  joinPolicy?: PipelineStage['joinPolicy'];
  contract?: PipelineStage['contract'];
  fanOutContract?: PipelineStage['fanOutContract'];
  joinMergeContract?: PipelineStage['joinMergeContract'];
  fanOut?: GraphPipelineNode['fanOut'];
  join?: GraphPipelineNode['join'];
  gate?: GraphPipelineNode['gate'];
  switch?: GraphPipelineNode['switch'];
  loop?: GraphPipelineNode['loop'];
  subgraphRef?: GraphPipelineNode['subgraphRef'];
};

type LegacyGroupMap = Record<string, Partial<StageExecutionConfig>>;

type LegacyTemplateLike = Omit<TemplateDefinition, 'pipeline' | 'graphPipeline' | 'groups'> & {
  groups?: LegacyGroupMap;
  pipeline?: LegacyNodeLike[];
  graphPipeline?: {
    nodes: LegacyNodeLike[];
    edges: Array<{ from: string; to: string; condition?: string; dataMapping?: Record<string, string> }>;
  };
};

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeRoles(roles: unknown): StageRoleDefinition[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (!role || typeof role !== 'object') return null;
      const candidate = role as Record<string, unknown>;
      if (typeof candidate.id !== 'string' || typeof candidate.workflow !== 'string') return null;
      return {
        id: candidate.id,
        workflow: candidate.workflow,
        timeoutMs: typeof candidate.timeoutMs === 'number' ? candidate.timeoutMs : 10 * 60 * 1000,
        autoApprove: candidate.autoApprove !== false,
        ...(typeof candidate.maxRetries === 'number' ? { maxRetries: candidate.maxRetries } : {}),
        ...(typeof candidate.staleThresholdMs === 'number' ? { staleThresholdMs: candidate.staleThresholdMs } : {}),
      } satisfies StageRoleDefinition;
    })
    .filter((role): role is StageRoleDefinition => !!role);
}

function collectLegacyStageIds(raw: LegacyTemplateLike): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (legacyGroupId: string | undefined, stageId: string) => {
    if (!legacyGroupId) return;
    const list = map.get(legacyGroupId) ?? [];
    list.push(stageId);
    map.set(legacyGroupId, list);
  };

  for (const stage of raw.pipeline ?? []) {
    const stageId = stage.stageId || stage.groupId;
    if (!stageId) continue;
    add(stage.groupId ?? stage.stageId, stageId);
  }

  for (const node of raw.graphPipeline?.nodes ?? []) {
    const stageId = node.id || node.stageId || node.groupId;
    if (!stageId) continue;
    add(node.groupId ?? node.id ?? node.stageId, stageId);
  }

  return map;
}

function normalizeSourceContract(
  contract: unknown,
  legacyGroupToStageIds: Map<string, string[]>,
): StageSourceContract | undefined {
  if (!contract || typeof contract !== 'object') return undefined;
  const candidate = contract as Record<string, unknown>;
  const acceptedSourceStageIds = dedupe([
    ...((Array.isArray(candidate.acceptedSourceStageIds) ? candidate.acceptedSourceStageIds : []) as string[]),
    ...((Array.isArray(candidate.acceptedSourceGroupIds) ? candidate.acceptedSourceGroupIds : []) as string[])
      .flatMap((legacyId) => legacyGroupToStageIds.get(legacyId) ?? [legacyId]),
  ]);

  return {
    acceptedSourceStageIds,
    ...(Array.isArray(candidate.requireReviewOutcome) ? { requireReviewOutcome: candidate.requireReviewOutcome as StageSourceContract['requireReviewOutcome'] } : {}),
    ...(candidate.autoIncludeUpstreamSourceRuns === true ? { autoIncludeUpstreamSourceRuns: true } : {}),
    ...(candidate.autoBuildInputArtifactsFromSources === true ? { autoBuildInputArtifactsFromSources: true } : {}),
  };
}

function defaultExecutionMode(node: LegacyNodeLike): StageExecutionConfig['executionMode'] {
  if (node.kind && node.kind !== 'stage') return 'orchestration';
  if (node.stageType && node.stageType !== 'normal') return 'orchestration';
  return 'legacy-single';
}

function normalizeExecutionConfig(
  template: LegacyTemplateLike,
  node: LegacyNodeLike,
  legacyGroupMap: LegacyGroupMap,
  legacyGroupToStageIds: Map<string, string[]>,
  defaultTitle: string,
  defaultDescription = '',
): StageExecutionConfig & { legacyGroupId?: string } {
  const legacyGroupId = node.groupId;
  const legacy = legacyGroupId ? legacyGroupMap[legacyGroupId] : undefined;
  const title = node.title || legacy?.title || node.label || defaultTitle;
  const description = node.description || legacy?.description || defaultDescription;
  const executionMode = node.executionMode || legacy?.executionMode || defaultExecutionMode(node);
  const roles = normalizeRoles(node.roles ?? legacy?.roles);
  const capabilities = (node.capabilities ?? legacy?.capabilities) as StageCapabilities | undefined;
  const sourceContract = normalizeSourceContract(node.sourceContract ?? legacy?.sourceContract, legacyGroupToStageIds);
  const reviewPolicyId = node.reviewPolicyId || legacy?.reviewPolicyId;
  const defaultModel = node.defaultModel || legacy?.defaultModel || template.defaultModel;

  return {
    title,
    description,
    executionMode,
    roles,
    ...(capabilities ? { capabilities } : {}),
    ...(sourceContract ? { sourceContract } : {}),
    ...(reviewPolicyId ? { reviewPolicyId } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    ...(legacyGroupId ? { legacyGroupId } : {}),
  };
}

function stageTypeToKind(stageType?: PipelineStage['stageType']): GraphPipelineNode['kind'] {
  if (stageType === 'fan-out') return 'fan-out';
  if (stageType === 'join') return 'join';
  return 'stage';
}

export function normalizeTemplateDefinition(rawTemplate: LegacyTemplateLike): TemplateDefinition {
  const template: LegacyTemplateLike = structuredClone(rawTemplate);
  const legacyGroupMap = template.groups ?? {};
  const legacyGroupToStageIds = collectLegacyStageIds(template);

  const pipeline = template.pipeline?.map((stage, index) => {
    const stageId = stage.stageId || stage.groupId;
    if (!stageId) {
      throw new Error(`Template '${template.id}' pipeline[${index}] is missing stageId`);
    }
    const config = normalizeExecutionConfig(
      template,
      stage,
      legacyGroupMap,
      legacyGroupToStageIds,
      stageId,
    );

    return {
      stageId,
      autoTrigger: stage.autoTrigger ?? (index === 0 ? false : true),
      ...(stage.triggerOn ? { triggerOn: stage.triggerOn } : {}),
      ...(stage.promptTemplate ? { promptTemplate: stage.promptTemplate } : {}),
      ...(stage.upstreamStageIds ? { upstreamStageIds: stage.upstreamStageIds } : {}),
      ...(stage.stageType ? { stageType: stage.stageType } : {}),
      ...(stage.fanOutSource ? { fanOutSource: stage.fanOutSource } : {}),
      ...(stage.joinFrom ? { joinFrom: stage.joinFrom } : {}),
      ...(stage.joinPolicy ? { joinPolicy: stage.joinPolicy } : {}),
      ...(stage.contract ? { contract: stage.contract } : {}),
      ...(stage.fanOutContract ? { fanOutContract: stage.fanOutContract } : {}),
      ...(stage.joinMergeContract ? { joinMergeContract: stage.joinMergeContract } : {}),
      ...config,
      groupId: stageId,
    } satisfies PipelineStage;
  });

  const graphPipeline = template.graphPipeline
    ? {
        nodes: template.graphPipeline.nodes.map((node, index) => {
          const stageId = node.id || node.stageId || node.groupId;
          if (!stageId) {
            throw new Error(`Template '${template.id}' graphPipeline.nodes[${index}] is missing id`);
          }
          const config = normalizeExecutionConfig(
            template,
            node,
            legacyGroupMap,
            legacyGroupToStageIds,
            stageId,
            node.kind === 'stage' ? '' : `${node.kind} orchestration node`,
          );
          return {
            id: stageId,
            kind: node.kind ?? stageTypeToKind(node.stageType),
            ...(node.label ? { label: node.label } : {}),
            ...(node.autoTrigger !== undefined ? { autoTrigger: node.autoTrigger } : {}),
            ...(node.triggerOn ? { triggerOn: node.triggerOn } : {}),
            ...(node.promptTemplate ? { promptTemplate: node.promptTemplate } : {}),
            ...(node.contract ? { contract: node.contract } : {}),
            ...(node.fanOut ? { fanOut: node.fanOut } : {}),
            ...(node.join ? { join: node.join } : {}),
            ...(node.gate ? { gate: node.gate } : {}),
            ...(node.switch ? { switch: node.switch } : {}),
            ...(node.loop ? { loop: node.loop } : {}),
            ...(node.subgraphRef ? { subgraphRef: node.subgraphRef } : {}),
            ...config,
            groupId: stageId,
          } satisfies GraphPipelineNode;
        }),
        edges: template.graphPipeline.edges ?? [],
      }
    : undefined;

  return {
    id: template.id,
    kind: 'template',
    title: template.title,
    description: template.description,
    ...(pipeline ? { pipeline } : {}),
    ...(graphPipeline ? { graphPipeline } : {}),
    ...(template.defaultModel ? { defaultModel: template.defaultModel } : {}),
  };
}

export function listTemplateNodes(template: TemplateDefinition): Array<PipelineStage | GraphPipelineNode> {
  if (template.graphPipeline) return template.graphPipeline.nodes;
  return template.pipeline ?? [];
}

export function getTemplateNode(
  template: TemplateDefinition,
  stageId: string,
): PipelineStage | GraphPipelineNode | null {
  if (template.graphPipeline) {
    return template.graphPipeline.nodes.find((node) => node.id === stageId) ?? null;
  }
  return template.pipeline?.find((stage) => stage.stageId === stageId) ?? null;
}

function pipelineNodeKind(stage: PipelineStage): StageDefinition['nodeKind'] {
  if (stage.stageType === 'fan-out') return 'fan-out';
  if (stage.stageType === 'join') return 'join';
  return 'stage';
}

export function toStageDefinition(
  template: TemplateDefinition,
  node: PipelineStage | GraphPipelineNode,
): StageDefinition {
  const id = 'stageId' in node ? node.stageId : node.id;
  const nodeKind = 'kind' in node ? node.kind : pipelineNodeKind(node);
  return {
    id,
    templateId: template.id,
    title: node.title || ('label' in node ? node.label : undefined) || id,
    description: node.description || '',
    label: 'label' in node ? node.label : undefined,
    nodeKind,
    executionMode: node.executionMode,
    roles: node.roles ?? [],
    ...(node.capabilities ? { capabilities: node.capabilities } : {}),
    ...(node.sourceContract ? { sourceContract: node.sourceContract } : {}),
    ...(node.reviewPolicyId ? { reviewPolicyId: node.reviewPolicyId } : {}),
    ...(node.defaultModel || template.defaultModel ? { defaultModel: node.defaultModel || template.defaultModel } : {}),
    groupId: id,
  };
}

export function resolveStageDefinition(
  template: TemplateDefinition,
  stageId: string,
): StageDefinition | null {
  const node = getTemplateNode(template, stageId);
  return node ? toStageDefinition(template, node) : null;
}
