/**
 * Generation Context — assembles context for AI pipeline generation.
 *
 * Gathers reusable workflows, existing templates, reference template,
 * and output schema so the LLM has everything it needs to produce
 * a valid graphPipeline.
 */

import type { TemplateDefinition } from './pipeline/pipeline-types';
import type { GraphPipelineNode } from './pipeline/graph-pipeline-types';
import type { StageExecutionMode } from './group-types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface TemplateSummary {
  id: string;
  title: string;
  description: string;
  stageCount: number;
  hasFanOut: boolean;
  hasLoop: boolean;
}

export interface GenerationContext {
  /** Reusable workflow IDs observed in existing templates */
  workflows: string[];
  /** Supported execution modes */
  executionModes: StageExecutionMode[];
  /** Supported graph node kinds */
  nodeKinds: GraphPipelineNode['kind'][];
  /** Existing template summaries (for structure inspiration) */
  existingTemplates: TemplateSummary[];
  /** Full reference template (when user specifies one) */
  referenceTemplate?: TemplateDefinition;
  /** LLM-friendly description of the output format */
  outputSchema: object;
}

// ── graphPipeline output schema (simplified for LLM) ────────────────

const GRAPH_PIPELINE_SCHEMA = {
  type: 'object',
  description: 'A DAG workflow definition with nodes and edges.',
  required: ['nodes', 'edges'],
  properties: {
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'executionMode', 'roles'],
        properties: {
          id: { type: 'string', description: 'Globally unique node ID' },
          kind: {
            type: 'string',
            enum: ['stage', 'fan-out', 'join', 'gate', 'switch', 'loop-start', 'loop-end'],
          },
          title: { type: 'string', description: 'Human-readable stage title' },
          executionMode: {
            type: 'string',
            enum: ['legacy-single', 'review-loop', 'delivery-single-pass', 'orchestration'],
          },
          roles: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'workflow', 'timeoutMs', 'autoApprove'],
              properties: {
                id: { type: 'string' },
                workflow: { type: 'string', description: 'Workflow path such as /dev-worker' },
                timeoutMs: { type: 'number' },
                autoApprove: { type: 'boolean' },
              },
            },
          },
          label: { type: 'string', description: 'Display label' },
          autoTrigger: { type: 'boolean', default: true },
          triggerOn: { type: 'string', enum: ['approved', 'completed', 'any'] },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
  },
};

// ── Context Builder ─────────────────────────────────────────────────────────

function hasNodeKind(template: TemplateDefinition, kind: GraphPipelineNode['kind']): boolean {
  if (template.graphPipeline) {
    return template.graphPipeline.nodes.some(n => n.kind === kind);
  }
  if (template.pipeline) {
    const stageTypes: Record<string, GraphPipelineNode['kind']> = {
      'fan-out': 'fan-out',
      'join': 'join',
    };
    return template.pipeline.some(s => stageTypes[s.stageType ?? ''] === kind);
  }
  return false;
}

function summarizeTemplate(t: TemplateDefinition): TemplateSummary {
  const stageCount = t.graphPipeline
    ? t.graphPipeline.nodes.length
    : (t.pipeline?.length ?? 0);

  return {
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    stageCount,
    hasFanOut: hasNodeKind(t, 'fan-out'),
    hasLoop: hasNodeKind(t, 'loop-start'),
  };
}

function extractWorkflows(templates: TemplateDefinition[]): string[] {
  const workflows = new Set<string>();
  for (const template of templates) {
    for (const stage of template.pipeline ?? []) {
      for (const role of stage.roles ?? []) workflows.add(role.workflow);
    }
    for (const node of template.graphPipeline?.nodes ?? []) {
      for (const role of node.roles ?? []) workflows.add(role.workflow);
    }
  }
  return [...workflows].sort();
}

/**
 * Build the generation context that is passed to the LLM prompt.
 * Loads groups and templates from AssetLoader.
 */
export function buildGenerationContext(
  allTemplates: TemplateDefinition[],
  referenceTemplateId?: string,
): GenerationContext {
  const workflows = extractWorkflows(allTemplates);
  const existingTemplates = allTemplates.map(summarizeTemplate);
  const referenceTemplate = referenceTemplateId
    ? allTemplates.find(t => t.id === referenceTemplateId) ?? undefined
    : undefined;

  return {
    workflows,
    executionModes: ['legacy-single', 'review-loop', 'delivery-single-pass', 'orchestration'],
    nodeKinds: ['stage', 'fan-out', 'join', 'gate', 'switch', 'loop-start', 'loop-end', 'subgraph-ref'],
    existingTemplates,
    referenceTemplate,
    outputSchema: GRAPH_PIPELINE_SCHEMA,
  };
}
