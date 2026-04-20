import { createHash } from 'crypto';

import type { PromptModeResolution, TaskResult } from '../agents/group-types';
import type { KnowledgeAsset, KnowledgeCategory } from './contracts';

export interface ExtractKnowledgeInput {
  runId: string;
  workspaceUri?: string;
  result: TaskResult;
  promptResolution?: PromptModeResolution;
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
  createdAt?: string;
}

function hashKnowledgeId(runId: string, category: KnowledgeCategory, index: number, title: string): string {
  const hash = createHash('sha1').update(`${runId}:${category}:${index}:${title}`).digest('hex').slice(0, 10);
  return `${runId}-${category}-${hash}`;
}

function buildBaseAsset(
  input: ExtractKnowledgeInput,
  category: KnowledgeCategory,
  index: number,
  title: string,
  content: string,
  status: KnowledgeAsset['status'] = 'active',
  confidence = 0.6,
): KnowledgeAsset {
  const createdAt = input.createdAt || new Date().toISOString();
  const tags: string[] = [];
  if (input.resolvedWorkflowRef) tags.push(`workflow:${input.resolvedWorkflowRef}`);
  for (const skillRef of input.resolvedSkillRefs || []) {
    tags.push(`skill:${skillRef}`);
  }
  for (const workflowRef of input.promptResolution?.matchedWorkflowRefs || []) {
    tags.push(`workflow:${workflowRef}`);
  }
  for (const skillRef of input.promptResolution?.matchedSkillRefs || []) {
    tags.push(`skill:${skillRef}`);
  }

  return {
    id: hashKnowledgeId(input.runId, category, index, title),
    scope: 'department',
    workspaceUri: input.workspaceUri,
    category,
    title,
    content,
    source: {
      type: 'run',
      runId: input.runId,
    },
    confidence,
    tags: Array.from(new Set(tags)),
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

function extractDecisionSentences(summary: string): string[] {
  const pattern = /(?:decided|chose|selected|switched to|using|adopted|opted for|went with|picked)\s+(.+?)(?:\.|$)/gi;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(summary)) !== null) {
    matches.push(match[0].trim());
  }
  return matches;
}

export function extractKnowledgeAssetsFromRun(input: ExtractKnowledgeInput): KnowledgeAsset[] {
  const assets: KnowledgeAsset[] = [];
  const { result } = input;
  const createdAt = input.createdAt || new Date().toISOString();
  const summary = (result.summary || '').trim();

  if (!summary) return assets;

  const decisions = extractDecisionSentences(summary);
  decisions.forEach((decision, index) => {
    assets.push(buildBaseAsset(
      { ...input, createdAt },
      'decision',
      index,
      `Decision from run ${input.runId.slice(0, 8)} #${index + 1}`,
      decision,
      'active',
      0.8,
    ));
  });

  if (result.changedFiles.length > 0) {
    const filesSummary = result.changedFiles.length > 10
      ? `${result.changedFiles.slice(0, 10).join(', ')} (+${result.changedFiles.length - 10} more)`
      : result.changedFiles.join(', ');
    assets.push(buildBaseAsset(
      { ...input, createdAt },
      'pattern',
      0,
      `Implementation pattern from run ${input.runId.slice(0, 8)}`,
      `Files touched: ${filesSummary}\n\nSummary:\n${summary}`,
      'active',
      0.65,
    ));
  }

  if (result.status !== 'completed' || result.blockers.length > 0) {
    assets.push(buildBaseAsset(
      { ...input, createdAt },
      'lesson',
      0,
      `Lesson from run ${input.runId.slice(0, 8)}`,
      `Status: ${result.status}\n\nBlockers:\n${result.blockers.join('\n') || 'None'}\n\nSummary:\n${summary}`,
      'active',
      0.7,
    ));
  }

  const workflowSuggestion = input.promptResolution?.workflowSuggestion;
  if (workflowSuggestion) {
    assets.push(buildBaseAsset(
      { ...input, createdAt },
      'workflow-proposal',
      0,
      workflowSuggestion.title,
      [
        `Reason: ${workflowSuggestion.reason}`,
        `Source: ${workflowSuggestion.source}`,
        `Recommended Scope: ${workflowSuggestion.recommendedScope}`,
        '',
        'Evidence:',
        `- requestedWorkflowRefs: ${workflowSuggestion.evidence.requestedWorkflowRefs.join(', ') || 'none'}`,
        `- requestedSkillHints: ${workflowSuggestion.evidence.requestedSkillHints.join(', ') || 'none'}`,
        `- matchedWorkflowRefs: ${workflowSuggestion.evidence.matchedWorkflowRefs.join(', ') || 'none'}`,
        `- matchedSkillRefs: ${workflowSuggestion.evidence.matchedSkillRefs.join(', ') || 'none'}`,
      ].join('\n'),
      'proposal',
      0.75,
    ));
  }

  return assets;
}
