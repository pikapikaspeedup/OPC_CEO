import type { TemplateDefinition } from './pipeline-types';
import type { DagIR, DagNode, DagEdge } from './dag-ir-types';
import { resolveStageId } from './pipeline-graph';
import { validateTemplatePipeline } from './pipeline-graph';
import { compileGraphPipelineToIR } from './graph-compiler';

// ── IR Cache ────────────────────────────────────────────────────────────────

const irCache = new Map<string, DagIR>();

/**
 * Get cached IR or compile from template.
 * The primary entry point for all runtime consumers.
 * Auto-detects format: graphPipeline takes priority over pipeline[].
 */
export function getOrCompileIR(template: TemplateDefinition): DagIR {
  const cached = irCache.get(template.id);
  if (cached) return cached;
  const ir = compileTemplateToIR(template);
  irCache.set(template.id, ir);
  return ir;
}

/**
 * Unified compilation entry point.
 * Auto-detects format and dispatches to the appropriate compiler.
 */
export function compileTemplateToIR(template: TemplateDefinition): DagIR {
  if (template.graphPipeline) {
    return compileGraphPipelineToIR(template.id, template.graphPipeline);
  }
  return compilePipelineToIR(template);
}

/** Invalidate cached IR for a template (called when templates are reloaded). */
export function invalidateIRCache(templateId: string): void {
  irCache.delete(templateId);
}

/** Clear all cached IRs (used in tests). */
export function clearIRCache(): void {
  irCache.clear();
}

// ── Compiler ────────────────────────────────────────────────────────────────

/**
 * Compile a pipeline[] template definition into a DagIR.
 *
 * Rules:
 * 1. Each PipelineStage → one DagNode
 * 2. stageType 'fan-out' → kind 'fan-out', stageType 'join' → kind 'join', else → kind 'stage'
 * 3. Explicit upstreamStageIds → DagEdges. No upstreamStageIds + not first → implicit linear edge
 * 4. Nodes with no incoming edges → entryNodeIds
 * 5. V4.4 contracts propagate to IR nodes
 * 6. Validation runs first; compile throws on invalid template
 */
export function compilePipelineToIR(template: TemplateDefinition): DagIR {
  // Validate first — reject invalid templates
  const errors = validateTemplatePipeline(template);
  if (errors.length > 0) {
    throw new Error(`Cannot compile template '${template.id}': ${errors.join('; ')}`);
  }

  const pipeline = template.pipeline ?? [];
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  // Pass 1: Build nodes
  for (let i = 0; i < pipeline.length; i++) {
    const stage = pipeline[i];
    const stageId = resolveStageId(stage);

    const kind = stage.stageType === 'fan-out'
      ? 'fan-out' as const
      : stage.stageType === 'join'
        ? 'join' as const
        : 'stage' as const;

    const node: DagNode = {
      id: stageId,
      kind,
      title: stage.title,
      description: stage.description,
      executionMode: stage.executionMode,
      roles: stage.roles,
      capabilities: stage.capabilities,
      sourceContract: stage.sourceContract,
      reviewPolicyId: stage.reviewPolicyId,
      defaultModel: stage.defaultModel,
      groupId: stageId,
      autoTrigger: stage.autoTrigger,
      triggerOn: stage.triggerOn || 'approved',
      promptTemplate: stage.promptTemplate,
      contract: stage.contract,
      sourceIndex: i,
    };

    // Fan-out specific
    if (kind === 'fan-out' && stage.fanOutSource) {
      node.fanOut = {
        workPackagesPath: stage.fanOutSource.workPackagesPath,
        perBranchTemplateId: stage.fanOutSource.perBranchTemplateId,
        contract: stage.fanOutContract,
        maxConcurrency: stage.fanOutSource.maxConcurrency,
      };
    }

    // Join specific
    if (kind === 'join' && stage.joinFrom) {
      node.join = {
        sourceNodeId: stage.joinFrom,
        policy: stage.joinPolicy || 'all',
        contract: stage.joinMergeContract,
      };
    }

    nodes.push(node);
  }

  // Pass 2: Build edges
  const nodesWithIncoming = new Set<string>();

  for (let i = 0; i < pipeline.length; i++) {
    const stage = pipeline[i];
    const stageId = resolveStageId(stage);

    if (stage.upstreamStageIds) {
      // Explicit upstream dependencies (empty array = no dependencies, also no implicit edge)
      for (const upstreamId of stage.upstreamStageIds) {
        edges.push({ from: upstreamId, to: stageId });
        nodesWithIncoming.add(stageId);
      }
    } else if (i > 0) {
      // Implicit linear dependency on previous stage
      const prevId = resolveStageId(pipeline[i - 1]);
      edges.push({ from: prevId, to: stageId });
      nodesWithIncoming.add(stageId);
    }
  }

  // Pass 3: Identify entry nodes
  const entryNodeIds = nodes
    .map(n => n.id)
    .filter(id => !nodesWithIncoming.has(id));

  return {
    templateId: template.id,
    nodes,
    edges,
    entryNodeIds,
    compiledAt: new Date().toISOString(),
    irVersion: 1,
  };
}
