/**
 * Pipeline Generator — AI-assisted graphPipeline generation.
 *
 * Generates a graphPipeline draft based on user goals and constraints,
 * validates it, assesses risks, and manages draft lifecycle.
 * All generated drafts require explicit human confirmation before saving.
 */

import { randomUUID } from 'crypto';
import type { GraphPipeline } from './graph-pipeline-types';
import type { ContractError, ContractWarning } from './contract-types';
import type { RiskAssessment } from './risk-assessor';
import { assessGenerationRisks, hasCriticalRisk } from './risk-assessor';
import { buildGenerationContext, type GenerationContext, type GroupSummary } from './generation-context';
import type { TemplateDefinition } from './pipeline-types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface GenerationInput {
  /** Project goal description (natural language) */
  goal: string;
  /** Optional constraints */
  constraints?: {
    maxStages?: number;
    allowFanOut?: boolean;
    allowLoop?: boolean;
    allowGate?: boolean;
    techStack?: string;
    teamSize?: string;
  };
  /** Reference template ID */
  referenceTemplateId?: string;
  /** Model to use */
  model?: string;
}

export interface GenerationValidation {
  valid: boolean;
  dagErrors: string[];
  contractErrors: ContractError[];
  contractWarnings: ContractWarning[];
}

export interface GenerationResult {
  /** Generated graphPipeline draft */
  graphPipeline: GraphPipeline;
  /** Template metadata */
  templateMeta: {
    id: string;
    title: string;
    description: string;
  };
  /** AI explanation of the design */
  explanation: string;
  /** Validation results */
  validation: GenerationValidation;
  /** Risk assessment */
  risks: RiskAssessment[];
  /** Draft status — must be confirmed before saving */
  status: 'draft';
  /** Draft ID for later confirmation */
  draftId: string;
}

// ── Draft Store ─────────────────────────────────────────────────────────────

interface DraftEntry {
  result: GenerationResult;
  createdAt: number;
  confirmed: boolean;
}

/** In-memory draft store with TTL */
const draftStore = new Map<string, DraftEntry>();
const DRAFT_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cleanExpiredDrafts(): void {
  const now = Date.now();
  for (const [id, entry] of draftStore) {
    if (now - entry.createdAt > DRAFT_TTL_MS) {
      draftStore.delete(id);
    }
  }
}

export function getDraft(draftId: string): GenerationResult | null {
  cleanExpiredDrafts();
  const entry = draftStore.get(draftId);
  if (!entry) return null;
  return entry.result;
}

export function isDraftConfirmed(draftId: string): boolean {
  return draftStore.get(draftId)?.confirmed ?? false;
}

/** Visible for testing */
export function _clearDrafts(): void {
  draftStore.clear();
}

// ── Prompt Building ─────────────────────────────────────────────────────────

export function buildGenerationPrompt(
  input: GenerationInput,
  context: GenerationContext,
): string {
  const groupList = context.availableGroups
    .map((g: GroupSummary) => `- ${g.id}: ${g.title} — ${g.description} (roles: ${g.roles.join(', ') || 'none'})`)
    .join('\n');

  const templateList = context.existingTemplates
    .map(t => `- ${t.id}: ${t.title} (${t.stageCount} stages${t.hasFanOut ? ', has fan-out' : ''}${t.hasLoop ? ', has loop' : ''})`)
    .join('\n');

  const constraintLines: string[] = [];
  if (input.constraints?.maxStages) constraintLines.push(`- Maximum ${input.constraints.maxStages} stages`);
  if (input.constraints?.allowFanOut === false) constraintLines.push('- Do NOT use fan-out');
  if (input.constraints?.allowLoop === false) constraintLines.push('- Do NOT use loop');
  if (input.constraints?.allowGate === false) constraintLines.push('- Do NOT use gate');
  if (input.constraints?.techStack) constraintLines.push(`- Tech stack: ${input.constraints.techStack}`);
  if (input.constraints?.teamSize) constraintLines.push(`- Team size: ${input.constraints.teamSize}`);

  const refSection = context.referenceTemplate
    ? `\n## Reference Template\n\`\`\`json\n${JSON.stringify(context.referenceTemplate.graphPipeline ?? context.referenceTemplate.pipeline, null, 2)}\n\`\`\``
    : '';

  return `You are a pipeline architect for the Antigravity Gateway system.

## Task
Generate a graphPipeline (DAG workflow definition) based on the user's goal.
Output valid JSON with a "graphPipeline" object and an "explanation" string.

## Available Agent Groups
${groupList || '(none — use placeholder groupIds)'}

## Existing Templates (for reference)
${templateList || '(none)'}

## Output Format
Respond ONLY with a JSON code block containing:
\`\`\`json
{
  "graphPipeline": {
    "nodes": [...],
    "edges": [...]
  },
  "title": "Template Title",
  "description": "Template description",
  "explanation": "Why this pipeline design was chosen..."
}
\`\`\`

## Node Types
- stage: Runs an agent group to perform a task
- fan-out: Splits work into parallel branches (requires fanOut config)
- join: Waits for all branches to complete (requires join config)
- gate: Requires human approval before proceeding
- switch: Routes to different paths based on conditions
- loop-start/loop-end: Repeatable section with max iterations

## Rules
1. Every node must have a unique id, a kind, and a groupId
2. Every edge must reference existing node IDs via "from" and "to"
3. The graph must be acyclic (except within loop-start/loop-end pairs)
4. Loops must have maxIterations ≤ 5
5. Each stage should have a clear purpose

## Constraints
${constraintLines.length > 0 ? constraintLines.join('\n') : '(none)'}
${refSection}
## User Goal
${input.goal}`;
}

// ── JSON Extraction ─────────────────────────────────────────────────────────

/**
 * Extract JSON from LLM output.
 * Handles: fenced code blocks, bare JSON objects.
 */
export function extractJsonFromResponse(raw: string): {
  graphPipeline?: GraphPipeline;
  title?: string;
  description?: string;
  explanation?: string;
} {
  // Try fenced code block first
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  // Find the outermost { ... }
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No valid JSON object found in LLM response');
  }

  return JSON.parse(jsonStr.slice(start, end + 1));
}

// ── Generate Pipeline ───────────────────────────────────────────────────────

/**
 * Generate a graphPipeline draft.
 *
 * The `callLLM` parameter is an async function that takes a prompt and returns
 * the LLM's raw text response. This decouples the generator from
 * the specific LLM infrastructure.
 */
export async function generatePipeline(
  input: GenerationInput,
  allTemplates: TemplateDefinition[],
  callLLM: (prompt: string, model?: string) => Promise<string>,
): Promise<GenerationResult> {
  const context = buildGenerationContext(allTemplates, input.referenceTemplateId);
  const prompt = buildGenerationPrompt(input, context);

  const rawResponse = await callLLM(prompt, input.model);

  // Parse JSON
  const parsed = extractJsonFromResponse(rawResponse);

  if (!parsed.graphPipeline || !parsed.graphPipeline.nodes || !parsed.graphPipeline.edges) {
    throw new Error('LLM output does not contain a valid graphPipeline (missing nodes or edges)');
  }

  const graphPipeline = parsed.graphPipeline;

  // Validate
  // Dynamic import to avoid circular deps
  const { validateGraphPipeline } = await import('./graph-compiler');
  const dagErrors = validateGraphPipeline(graphPipeline);

  // We build a minimal template to run contract validation
  const { validateTemplateContracts } = await import('./contract-validator');
  const tempTemplate: TemplateDefinition = {
    id: '__draft__',
    kind: 'template',
    title: parsed.title ?? 'AI-Generated Pipeline',
    description: parsed.description ?? '',
    groups: Object.fromEntries(
      graphPipeline.nodes.map(n => [
        n.groupId,
        { title: n.label ?? n.groupId, description: '', executionMode: 'review-loop' as const, roles: [] },
      ]),
    ),
    pipeline: [],
    graphPipeline,
  };
  const contractResult = validateTemplateContracts(tempTemplate);

  // Risk assessment
  const risks = assessGenerationRisks(graphPipeline, dagErrors, context);

  const draftId = randomUUID();
  const result: GenerationResult = {
    graphPipeline,
    templateMeta: {
      id: `ai-${draftId.slice(0, 8)}`,
      title: parsed.title ?? 'AI-Generated Pipeline',
      description: parsed.description ?? input.goal,
    },
    explanation: parsed.explanation ?? '',
    validation: {
      valid: dagErrors.length === 0 && contractResult.valid,
      dagErrors,
      contractErrors: contractResult.errors,
      contractWarnings: contractResult.warnings,
    },
    risks,
    status: 'draft',
    draftId,
  };

  // Store draft
  draftStore.set(draftId, { result, createdAt: Date.now(), confirmed: false });

  return result;
}

// ── Confirm Draft ───────────────────────────────────────────────────────────

export interface ConfirmResult {
  templateId: string;
  saved: boolean;
  validationErrors?: string[];
}

/**
 * Confirm a draft and prepare it for saving.
 * Optionally applies user modifications and re-validates.
 * Returns the confirmed template ID, or validation errors if blocked.
 *
 * Note: actual file save is handled by the API route / caller,
 * not by this function (separation of concerns).
 */
export async function confirmDraft(
  draftId: string,
  modifications?: {
    graphPipeline?: GraphPipeline;
    templateMeta?: Partial<GenerationResult['templateMeta']>;
  },
): Promise<ConfirmResult> {
  cleanExpiredDrafts();

  const entry = draftStore.get(draftId);
  if (!entry) {
    return { templateId: '', saved: false, validationErrors: ['Draft not found or expired'] };
  }
  if (entry.confirmed) {
    return { templateId: '', saved: false, validationErrors: ['Draft already confirmed'] };
  }

  // Apply modifications
  let graph = entry.result.graphPipeline;
  let meta = { ...entry.result.templateMeta };

  if (modifications?.graphPipeline) {
    graph = modifications.graphPipeline;
  }
  if (modifications?.templateMeta) {
    meta = { ...meta, ...modifications.templateMeta };
  }

  // Re-validate DAG structure only (group availability was checked during generation)
  const { validateGraphPipeline } = await import('./graph-compiler');
  const dagErrors = validateGraphPipeline(graph);

  if (dagErrors.length > 0) {
    return { templateId: '', saved: false, validationErrors: dagErrors };
  }

  // Mark confirmed
  entry.confirmed = true;
  entry.result.graphPipeline = graph;
  entry.result.templateMeta = meta;

  return { templateId: meta.id, saved: true };
}
