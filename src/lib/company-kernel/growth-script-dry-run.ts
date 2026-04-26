import type { GrowthProposal } from './contracts';
import { getGrowthProposal, patchGrowthProposal } from './growth-proposal-store';

const DESTRUCTIVE_SCRIPT_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /curl\b[\s\S]*\|\s*(?:sh|bash)\b/i,
  /wget\b[\s\S]*\|\s*(?:sh|bash)\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,
];

function evaluateScriptDryRun(proposal: GrowthProposal): {
  status: 'passed' | 'failed';
  reasons: string[];
} {
  const reasons: string[] = [];
  const content = proposal.content.trim();
  if (!content) {
    reasons.push('Script content is empty.');
  }
  if (!/\bDRY_RUN\b/.test(content)) {
    reasons.push('Script must expose a DRY_RUN guard before publication.');
  }
  for (const pattern of DESTRUCTIVE_SCRIPT_PATTERNS) {
    if (pattern.test(content)) {
      reasons.push(`Blocked destructive pattern: ${pattern.source}`);
    }
  }
  return {
    status: reasons.length === 0 ? 'passed' : 'failed',
    reasons: reasons.length > 0 ? reasons : ['Static sandbox dry-run checks passed.'],
  };
}

export function runGrowthProposalScriptDryRun(id: string): GrowthProposal | null {
  const proposal = getGrowthProposal(id);
  if (!proposal) return null;
  if (proposal.kind !== 'script') {
    throw new Error('Only script growth proposals support dry-run');
  }
  const result = evaluateScriptDryRun(proposal);
  return patchGrowthProposal(id, {
    metadata: {
      ...(proposal.metadata || {}),
      scriptDryRun: {
        mode: 'static-sandbox',
        status: result.status,
        reasons: result.reasons,
        checkedAt: new Date().toISOString(),
      },
    },
  });
}
