/**
 * Generation Context — assembles context for AI pipeline generation.
 *
 * Gathers available groups, existing templates, reference template,
 * and output schema so the LLM has everything it needs to produce
 * a valid graphPipeline.
 */

import type { TemplateDefinition } from './pipeline-types';
import type { GraphPipelineNode } from './graph-pipeline-types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface GroupSummary {
  id: string;
  title: string;
  description: string;
  roles: string[];
  executionMode?: string;
}

export interface TemplateSummary {
  id: string;
  title: string;
  description: string;
  stageCount: number;
  hasFanOut: boolean;
  hasLoop: boolean;
}

export interface GenerationContext {
  /** Available agent groups (for the LLM to reference) */
  availableGroups: GroupSummary[];
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
        required: ['id', 'kind', 'groupId'],
        properties: {
          id: { type: 'string', description: 'Globally unique node ID' },
          kind: {
            type: 'string',
            enum: ['stage', 'fan-out', 'join', 'gate', 'switch', 'loop-start', 'loop-end'],
          },
          groupId: { type: 'string', description: 'Agent group ID from available groups' },
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

function extractGroups(templates: TemplateDefinition[]): GroupSummary[] {
  const seen = new Set<string>();
  const groups: GroupSummary[] = [];

  for (const t of templates) {
    if (!t.groups) continue;
    for (const [gid, g] of Object.entries(t.groups)) {
      if (seen.has(gid)) continue;
      seen.add(gid);
      groups.push({
        id: gid,
        title: g.title,
        description: g.description ?? '',
        roles: (g.roles ?? []).map((r: any) => r.id ?? r.title ?? String(r)),
        executionMode: g.executionMode,
      });
    }
  }

  return groups;
}

/**
 * Build the generation context that is passed to the LLM prompt.
 * Loads groups and templates from AssetLoader.
 */
export function buildGenerationContext(
  allTemplates: TemplateDefinition[],
  referenceTemplateId?: string,
): GenerationContext {
  const availableGroups = extractGroups(allTemplates);
  const existingTemplates = allTemplates.map(summarizeTemplate);
  const referenceTemplate = referenceTemplateId
    ? allTemplates.find(t => t.id === referenceTemplateId) ?? undefined
    : undefined;

  return {
    availableGroups,
    existingTemplates,
    referenceTemplate,
    outputSchema: GRAPH_PIPELINE_SCHEMA,
  };
}
