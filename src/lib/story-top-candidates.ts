export const STORY_TOP_CANDIDATE_KIND = 'story-top';
export const STORY_TOP_CANDIDATE_WORKFLOW_REF = '/platform_engineering_story_candidates';
export const STORY_TOP_CANDIDATE_ARTIFACT = 'story-top-candidates.json';

export type StoryTopCandidateArea =
  | 'frontend'
  | 'api'
  | 'runtime'
  | 'scheduler'
  | 'provider'
  | 'knowledge'
  | 'approval'
  | 'database'
  | 'docs';

export type StoryTopCandidateSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface StoryTopCandidatePayload {
  storyKey?: string;
  sourcePath: string;
  storyText: string;
  title: string;
  summary: string;
  expectedOutcome: string;
  severity: StoryTopCandidateSeverity;
  rationale: string;
  affectedAreas?: StoryTopCandidateArea[];
}

export interface StoryTopCandidateMetadata extends Record<string, unknown> {
  candidateKind?: string;
  candidateActive?: boolean;
  storyKey?: string;
  sourcePath?: string;
  storyText?: string;
  expectedOutcome?: string;
  rationale?: string;
  candidateBatchId?: string;
  candidateGeneratedAt?: string;
}

export function isStoryTopCandidateMetadata(metadata?: Record<string, unknown> | null): metadata is StoryTopCandidateMetadata {
  return metadata?.candidateKind === STORY_TOP_CANDIDATE_KIND;
}

export function isActiveStoryTopCandidateMetadata(metadata?: Record<string, unknown> | null): metadata is StoryTopCandidateMetadata {
  return isStoryTopCandidateMetadata(metadata) && metadata.candidateActive === true;
}

export function readStoryTopCandidateGeneratedAt(metadata?: Record<string, unknown> | null): string | null {
  if (!isStoryTopCandidateMetadata(metadata)) return null;
  return typeof metadata.candidateGeneratedAt === 'string' && metadata.candidateGeneratedAt
    ? metadata.candidateGeneratedAt
    : null;
}
