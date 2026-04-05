/**
 * Prompt Builder — Pure functions for constructing workflow prompts.
 *
 * Extracted from group-runtime.ts for maintainability.
 * All functions are pure (no side-effects except file reads for review decisions).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GroupRoleDefinition, ArtifactRef, ReviewDecision, TaskResult, TaskEnvelope } from './group-types';
import { AssetLoader } from './asset-loader';

// ---------------------------------------------------------------------------
// getCopiedArtifactPath — canonical input path convention
// ---------------------------------------------------------------------------

export function getCopiedArtifactPath(artifact: ArtifactRef): string {
  const shortSrcId = artifact.sourceRunId?.slice(0, 8) || 'unknown';
  return `input/${shortSrcId}/${artifact.path}`;
}

// ---------------------------------------------------------------------------
// formatPromptArtifactLines — format artifact references for prompt inclusion
// ---------------------------------------------------------------------------

export function formatPromptArtifactLines(artifactDir: string, inputArtifacts: ArtifactRef[]): string[] {
  if (inputArtifacts.length === 0) {
    return ['- None were provided. If you need upstream inputs and cannot find them, stop and report blocked.'];
  }

  return inputArtifacts.map((artifact, index) => {
    const label = artifact.title || artifact.kind || artifact.path;
    const copiedPath = `${artifactDir}${getCopiedArtifactPath(artifact)}`;
    const sourceSuffix = artifact.sourceRunId ? `; sourceRunId=${artifact.sourceRunId}` : '';
    return `- [${index + 1}] ${label} (${artifact.kind}) -> ${copiedPath}${sourceSuffix}`;
  });
}

// ---------------------------------------------------------------------------
// buildRoleSwitchPrompt — V5.5: prompt for reusing an existing cascade
// ---------------------------------------------------------------------------

export function buildRoleSwitchPrompt(
  role: GroupRoleDefinition,
  round: number,
  artifactDir: string,
  artifactAbsDir: string,
  originalPrompt: string,
  inputArtifacts: ArtifactRef[] = [],
): string {
  const outputDir = role.id.includes('architect') ? 'architecture' : 'specs';
  const reviewPrefix = role.id.includes('architecture') ? 'architecture-' : '';
  const outputAbsDir = path.join(artifactAbsDir, outputDir);
  const reviewAbsDir = path.join(artifactAbsDir, 'review');
  const inputArtifactLines = formatPromptArtifactLines(artifactDir, inputArtifacts);

  const sections = [
    '',
    '═══════════════════════════════════════════════════════',
    `ROLE CONTINUATION — Round ${round} — ${role.id}`,
    '═══════════════════════════════════════════════════════',
    '',
    `You are now continuing as: ${role.id}`,
    `This is revision round ${round}. The reviewer found issues in your previous output.`,
    '',
    AssetLoader.resolveWorkflowContent(role.workflow),
    '',
    'Canonical upstream inputs',
    ...inputArtifactLines,
    '',
    `Read reviewer feedback from: ${artifactDir}review/${reviewPrefix}review-round-${round - 1}.md`,
    `Read reviewer feedback absolute path: ${path.join(reviewAbsDir, `${reviewPrefix}review-round-${round - 1}.md`)}`,
    `Update specs in: ${artifactDir}${outputDir}/`,
    `Update specs in absolute directory: ${outputAbsDir}/`,
    '- Address every reviewer concern explicitly and keep the upstream constraints intact.',
    '',
    'Original goal',
    originalPrompt,
  ];

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// buildRolePrompt — construct the workflow prompt for each role
// ---------------------------------------------------------------------------

export function buildRolePrompt(
  role: GroupRoleDefinition,
  originalPrompt: string,
  artifactDir: string,
  artifactAbsDir: string,
  round: number,
  isReviewer: boolean,
  inputArtifacts: ArtifactRef[] = [],
): string {
  const taskEnvelopePath = `${artifactDir}task-envelope.json`;
  const taskEnvelopeAbsPath = path.join(artifactAbsDir, 'task-envelope.json');
  const outputDir = role.id.includes('architect') ? 'architecture' : 'specs';
  const reviewPrefix = role.id.includes('architecture') ? 'architecture-' : '';
  const inputArtifactLines = formatPromptArtifactLines(artifactDir, inputArtifacts);
  const outputAbsDir = path.join(artifactAbsDir, outputDir);
  const reviewAbsDir = path.join(artifactAbsDir, 'review');

  const workflowContent = AssetLoader.resolveWorkflowContent(role.workflow);
  const sharedIntro = [
    workflowContent,
    '',
    'Stage context',
    `- Task envelope: ${taskEnvelopePath}`,
    `- Task envelope absolute path: ${taskEnvelopeAbsPath}`,
    `- Run artifact directory (absolute): ${artifactAbsDir}`,
    '- Workspace root: use the current workspace root as cwd.',
    '',
    'Canonical upstream inputs',
    ...inputArtifactLines,
    '',
    'Execution rules',
    '- Read the task envelope first, then every canonical upstream input listed above before planning.',
    '- Treat the copied input artifacts above as the authoritative upstream deliverables for this stage.',
    '- Prefer the copied files under this run over searching for alternate copies elsewhere in the workspace.',
    '- If any required input file is missing or inconsistent, stop and report blocked instead of guessing.',
    '- Preserve explicit tradeoffs and constraints from the upstream spec in your output.',
    `- Write every generated file under this run artifact directory: ${artifactAbsDir}`,
    '- Do NOT write outputs to workspace-root folders like `specs/`, `review/`, or `delivery/`.',
  ];

  if (isReviewer) {
    return [
      ...sharedIntro,
      '',
      'Review assignment',
      `- Review target directory: ${artifactDir}${reviewPrefix ? 'architecture' : 'specs'}/`,
      `- Review target directory (absolute): ${outputAbsDir}/`,
      `- Review round: ${round}`,
      `- Write review markdown to: ${artifactDir}review/${reviewPrefix}review-round-${round}.md`,
      `- Write review markdown absolute path: ${path.join(reviewAbsDir, `${reviewPrefix}review-round-${round}.md`)}`,
      `- Write decision JSON to: ${artifactDir}review/result-round-${round}.json`,
      `- Write decision JSON absolute path: ${path.join(reviewAbsDir, `result-round-${round}.json`)}`,
      '- The decision JSON must include a "decision" field with exactly one of: "approved", "revise", "rejected".',
      '- Review both the generated specs and the canonical upstream inputs before deciding.',
      '',
      'Original goal',
      originalPrompt,
    ].join('\n');
  }

  if (round === 1) {
    return [
      ...sharedIntro,
      '',
      'Author assignment',
      `- Write specs to: ${artifactDir}${outputDir}/`,
      `- Write specs to absolute directory: ${outputAbsDir}/`,
      '- Produce concrete, implementation-driving decisions. Avoid vague recommendations.',
      '- Use the canonical upstream inputs above as the source of truth for this stage.',
      '',
      'Original goal',
      originalPrompt,
    ].join('\n');
  }

  return [
    ...sharedIntro,
    '',
    'Revision assignment',
    `- Revision round: ${round}`,
    `- Read reviewer feedback from: ${artifactDir}review/${reviewPrefix}review-round-${round - 1}.md`,
    `- Read reviewer feedback absolute path: ${path.join(reviewAbsDir, `${reviewPrefix}review-round-${round - 1}.md`)}`,
    `- Update specs in: ${artifactDir}${outputDir}/`,
    `- Update specs in absolute directory: ${outputAbsDir}/`,
    '- Address every reviewer concern explicitly and keep the upstream constraints intact.',
    '',
    'Original goal',
    originalPrompt,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// buildDeliveryPrompt — V2.5: construct the workflow prompt for delivery runs
// ---------------------------------------------------------------------------

export function buildDeliveryPrompt(
  role: GroupRoleDefinition,
  originalPrompt: string,
  artifactDir: string,
  artifactAbsDir: string,
  taskEnvelope?: TaskEnvelope,
): string {
  const wpPath = `${artifactDir}work-package/work-package.json`;
  const inputDir = `${artifactDir}input/`;
  const taskEnvelopePath = `${artifactDir}task-envelope.json`;
  const inputArtifactLines = formatPromptArtifactLines(artifactDir, taskEnvelope?.inputArtifacts || []);

  const wpAbsPath = path.join(artifactAbsDir, 'work-package', 'work-package.json');
  const hasWorkPackage = fs.existsSync(wpAbsPath);

  if (hasWorkPackage) {
    return [
      AssetLoader.resolveWorkflowContent(role.workflow),
      '',
      'Stage context',
      `- Task envelope: ${taskEnvelopePath}`,
      `- Task envelope absolute path: ${path.join(artifactAbsDir, 'task-envelope.json')}`,
      `- Work package: ${wpPath}`,
      `- Work package absolute path: ${wpAbsPath}`,
      `- Input directory root: ${inputDir}`,
      `- Run artifact directory (absolute): ${artifactAbsDir}`,
      '',
      'Canonical upstream inputs',
      ...inputArtifactLines,
      '',
      'Delivery assignment',
      '- Read the work package first, then the task envelope, then every canonical upstream input listed above.',
      '- Implement all requested changes in the workspace codebase.',
      `- Write delivery artifacts to: ${artifactDir}delivery/`,
      `- Write delivery artifacts to absolute directory: ${path.join(artifactAbsDir, 'delivery')}/`,
      '- You MUST create: delivery/delivery-packet.json, delivery/implementation-summary.md, and delivery/test-results.md.',
      '- Do NOT write outputs to workspace-root `delivery/`; always write inside this run artifact directory.',
      '- If a required upstream artifact is missing, report blocked instead of inferring requirements from memory.',
      '',
      'Original goal',
      originalPrompt,
    ].join('\n');
  }

  return [
    AssetLoader.resolveWorkflowContent(role.workflow),
    '',
    'Stage context',
    `- Task envelope: ${taskEnvelopePath}`,
    `- Task envelope absolute path: ${path.join(artifactAbsDir, 'task-envelope.json')}`,
    `- Input directory root: ${inputDir}`,
    `- Run artifact directory (absolute): ${artifactAbsDir}`,
    '',
    'Canonical upstream inputs',
    ...inputArtifactLines,
    '',
    'Delivery assignment',
    `- Write your delivery artifacts to: ${artifactDir}delivery/`,
    `- Write your delivery artifacts to absolute directory: ${path.join(artifactAbsDir, 'delivery')}/`,
    '- You MUST create: delivery/delivery-packet.json (with status, summary, changedFiles, tests fields), delivery/implementation-summary.md, and delivery/test-results.md.',
    '- Do NOT write outputs to workspace-root `delivery/`; always write inside this run artifact directory.',
    '- Read the task envelope and canonical upstream inputs before implementation.',
    '',
    'Original goal',
    originalPrompt,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// extractReviewDecision — parse DECISION marker from review file then steps
// ---------------------------------------------------------------------------

export function extractReviewDecision(
  artifactAbsDir: string,
  round: number,
  steps: any[],
  result: TaskResult,
): ReviewDecision {
  // 1. Primary: Try reading round-scoped result-round-N.json
  const roundResultPath = path.join(artifactAbsDir, 'review', `result-round-${round}.json`);
  const legacyResultPath = path.join(artifactAbsDir, 'review', 'result.json');

  const pathsToTry = [roundResultPath];
  if (round === 1) pathsToTry.push(legacyResultPath);

  for (const resultJsonPath of pathsToTry) {
    try {
      if (fs.existsSync(resultJsonPath)) {
        const data = JSON.parse(fs.readFileSync(resultJsonPath, 'utf-8'));
        if (data.decision && typeof data.decision === 'string') {
          const decisionLower = data.decision.toLowerCase();
          if (['approved', 'revise', 'rejected'].includes(decisionLower)) {
            return decisionLower as ReviewDecision;
          }
        }
      }
    } catch {
      // Silent fail, fallback to other methods
    }
  }

  // 2. Secondary: If result object has decision directly
  if ((result as any)?.decision && typeof (result as any).decision === 'string') {
    const decisionLower = (result as any).decision.toLowerCase();
    if (['approved', 'revise', 'rejected'].includes(decisionLower)) {
      return decisionLower as ReviewDecision;
    }
  }

  // 3. Fallback: Parse Markdown markers
  const reviewPatterns = [
    path.join(artifactAbsDir, 'review', `review-round-${round}.md`),
    path.join(artifactAbsDir, 'review', `architecture-review-round-${round}.md`),
  ];

  for (const reviewPath of reviewPatterns) {
    try {
      if (fs.existsSync(reviewPath)) {
        const content = fs.readFileSync(reviewPath, 'utf-8');
        const decision = parseDecisionMarker(content);
        if (decision) return decision;
      }
    } catch {
      // File read failed, try next
    }
  }

  // Fallback: scan raw steps for DECISION marker
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') continue;
    const planner = step.plannerResponse || step.response || {};
    const text = planner.modifiedResponse || planner.response || '';
    const decision = parseDecisionMarker(text);
    if (decision) return decision;
  }

  throw new Error('Missing explicit review decision (no DECISION: marker found in review file or conversation steps)');
}

export function parseDecisionMarker(text: string): ReviewDecision | null {
  const match = text.match(/DECISION:\s*\**\s*(APPROVED|REVISE|REJECTED)/i);
  if (!match) return null;
  const decision = match[1].toUpperCase();
  if (decision === 'APPROVED') return 'approved';
  if (decision === 'REVISE') return 'revise';
  if (decision === 'REJECTED') return 'rejected';
  return null;
}
