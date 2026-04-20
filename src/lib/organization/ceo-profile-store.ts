import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { GATEWAY_HOME } from '../agents/gateway-home';
import { createLogger } from '../logger';
import type { CEODecisionRecord, CEOFeedbackSignal, CEOPendingIssue, CEOProfile } from './contracts';

const log = createLogger('CEOProfileStore');
const CEO_PROFILE_FILE = path.join(GATEWAY_HOME, 'ceo-profile.json');

function ensureHome(): void {
  if (!existsSync(GATEWAY_HOME)) {
    mkdirSync(GATEWAY_HOME, { recursive: true });
  }
}

export function defaultCEOProfile(): CEOProfile {
  const now = new Date().toISOString();
  return {
    id: 'default-ceo',
    identity: {
      name: 'AI CEO',
      role: 'ceo',
      tone: 'pragmatic',
    },
    priorities: [],
    activeFocus: [],
    communicationStyle: {
      verbosity: 'normal',
      escalationStyle: 'balanced',
    },
    riskTolerance: 'medium',
    reviewPreference: 'balanced',
    recentDecisions: [],
    feedbackSignals: [],
    pendingIssues: [],
    updatedAt: now,
  };
}

export function getCEOProfile(): CEOProfile {
  ensureHome();
  if (!existsSync(CEO_PROFILE_FILE)) {
    const profile = defaultCEOProfile();
    writeFileSync(CEO_PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');
    return profile;
  }

  try {
    const stored = JSON.parse(readFileSync(CEO_PROFILE_FILE, 'utf-8')) as Partial<CEOProfile>;
    return {
      ...defaultCEOProfile(),
      ...stored,
      identity: {
        ...defaultCEOProfile().identity,
        ...(stored.identity || {}),
      },
      communicationStyle: {
        ...defaultCEOProfile().communicationStyle,
        ...(stored.communicationStyle || {}),
      },
      recentDecisions: stored.recentDecisions || [],
      feedbackSignals: stored.feedbackSignals || [],
      pendingIssues: stored.pendingIssues || [],
    };
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Failed to load CEO profile, resetting to defaults');
    const profile = defaultCEOProfile();
    writeFileSync(CEO_PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');
    return profile;
  }
}

export function saveCEOProfile(profile: CEOProfile): CEOProfile {
  ensureHome();
  const next: CEOProfile = {
    ...profile,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(CEO_PROFILE_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function updateCEOProfile(patch: Partial<CEOProfile>): CEOProfile {
  const current = getCEOProfile();
  return saveCEOProfile({
    ...current,
    ...patch,
    identity: {
      ...current.identity,
      ...(patch.identity || {}),
    },
    communicationStyle: {
      ...current.communicationStyle,
      ...(patch.communicationStyle || {}),
    },
    recentDecisions: patch.recentDecisions || current.recentDecisions,
    feedbackSignals: patch.feedbackSignals || current.feedbackSignals,
    pendingIssues: patch.pendingIssues || current.pendingIssues,
  });
}

export function appendCEODecision(decision: CEODecisionRecord): CEOProfile {
  const current = getCEOProfile();
  const recentDecisions = [decision, ...(current.recentDecisions || [])].slice(0, 20);
  return saveCEOProfile({
    ...current,
    recentDecisions,
  });
}

export function appendCEOFeedback(feedback: CEOFeedbackSignal): CEOProfile {
  const current = getCEOProfile();
  const feedbackSignals = [feedback, ...(current.feedbackSignals || [])].slice(0, 50);
  return saveCEOProfile({
    ...current,
    feedbackSignals,
  });
}

export function updateCEOActiveFocus(focus: string[]): CEOProfile {
  const current = getCEOProfile();
  return saveCEOProfile({
    ...current,
    activeFocus: focus.slice(0, 5),
  });
}

export function appendCEOPendingIssue(issue: CEOPendingIssue): CEOProfile {
  const current = getCEOProfile();
  const pendingIssues = [issue, ...(current.pendingIssues || [])]
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index)
    .slice(0, 30);
  return saveCEOProfile({
    ...current,
    pendingIssues,
  });
}

export function removeCEOPendingIssue(id: string): CEOProfile {
  const current = getCEOProfile();
  const pendingIssues = (current.pendingIssues || []).filter((issue) => issue.id !== id);
  return saveCEOProfile({
    ...current,
    pendingIssues,
  });
}

export function removeCEOPendingIssuesByPrefix(prefix: string): CEOProfile {
  const current = getCEOProfile();
  const pendingIssues = (current.pendingIssues || []).filter((issue) => !issue.id.startsWith(prefix));
  return saveCEOProfile({
    ...current,
    pendingIssues,
  });
}

export function reconcileCEOPendingIssues(input: {
  pendingApprovalIds?: Set<string>;
  terminalProjectIds?: Set<string>;
}): CEOProfile {
  const current = getCEOProfile();
  const pendingIssues = (current.pendingIssues || []).filter((issue) => {
    if (issue.source === 'approval') {
      if (!input.pendingApprovalIds) return true;
      return input.pendingApprovalIds.has(issue.id.replace(/^approval:/, ''));
    }
    if (issue.source === 'project' && issue.projectId) {
      if (!input.terminalProjectIds) return true;
      return !input.terminalProjectIds.has(issue.projectId);
    }
    return true;
  });

  if (pendingIssues.length === (current.pendingIssues || []).length) {
    return current;
  }

  return saveCEOProfile({
    ...current,
    pendingIssues,
  });
}
