import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    knowledgeStore: await import('../../knowledge/store'),
    store: await import('../store'),
    publisher: await import('../publisher'),
    canonicalAssets: await import('../../agents/canonical-assets'),
  };
}

describe('evolution publisher', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-publisher-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('publishes a workflow proposal and activates source knowledge', async () => {
    const { knowledgeStore, store, publisher, canonicalAssets } = await loadModules();

    knowledgeStore.upsertKnowledgeAsset({
      id: 'source-knowledge-1',
      scope: 'department',
      workspaceUri: 'file:///tmp/research',
      category: 'workflow-proposal',
      title: 'phase5-release-digest',
      content: 'Reason: Release digests repeat every week.',
      source: { type: 'run', runId: 'run-source' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'proposal',
    });

    store.upsertEvolutionProposal({
      id: 'proposal-publish-1',
      kind: 'workflow',
      status: 'evaluated',
      workspaceUri: 'file:///tmp/research',
      title: 'Phase5 Release Digest',
      targetName: 'phase5-release-digest',
      targetRef: '/phase5-release-digest',
      rationale: 'Stabilize weekly release digests.',
      content: '# Phase5 Release Digest',
      sourceKnowledgeIds: ['source-knowledge-1'],
      evidence: [],
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const published = publisher.publishEvolutionProposal('proposal-publish-1');
    expect(published?.status).toBe('published');
    expect(published?.publishedArtifactPath).toContain('phase5-release-digest.md');
    expect(canonicalAssets.getCanonicalWorkflow('phase5-release-digest')?.content).toContain('# Phase5 Release Digest');
    expect(knowledgeStore.getKnowledgeAsset('source-knowledge-1')?.status).toBe('active');
  });

  it('publishes business evolution rule, script, and SOP proposals to canonical assets or knowledge', async () => {
    const { knowledgeStore, store, publisher, canonicalAssets } = await loadModules();

    store.upsertEvolutionProposal({
      id: 'proposal-rule-1',
      kind: 'rule',
      status: 'evaluated',
      workspaceUri: 'file:///tmp/research',
      title: 'Report Approval Rule',
      targetName: 'report-approval-rule',
      targetRef: 'rule:report-approval-rule',
      rationale: 'Repeated runs require approval before publishing.',
      content: '# Report Approval Rule',
      sourceKnowledgeIds: [],
      evidence: [],
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
    });
    store.upsertEvolutionProposal({
      id: 'proposal-script-1',
      kind: 'script',
      status: 'evaluated',
      workspaceUri: 'file:///tmp/research',
      title: 'Report Upload Script',
      targetName: 'report-upload-script',
      targetRef: 'script:report-upload-script',
      rationale: 'Repeated report uploads should use a reviewed script.',
      content: '#!/usr/bin/env bash\necho upload',
      sourceKnowledgeIds: [],
      evidence: [],
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
    });
    store.upsertEvolutionProposal({
      id: 'proposal-sop-1',
      kind: 'sop',
      status: 'evaluated',
      workspaceUri: 'file:///tmp/research',
      title: 'Report SOP',
      targetName: 'report-sop',
      targetRef: 'sop:report-sop',
      rationale: 'Repeated report steps should be documented.',
      content: '# Report SOP',
      sourceKnowledgeIds: [],
      evidence: [{ source: 'run-capsules', label: 'runs', detail: 'evidence', runIds: ['run-sop-1'] }],
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    expect(publisher.publishEvolutionProposal('proposal-rule-1')?.publishedArtifactPath).toContain('report-approval-rule.md');
    expect(canonicalAssets.getCanonicalRule('report-approval-rule')?.content).toContain('# Report Approval Rule');

    const script = publisher.publishEvolutionProposal('proposal-script-1');
    expect(script?.publishedArtifactPath).toContain('report-upload-script/run.sh');
    expect(fs.readFileSync(script?.publishedArtifactPath || '', 'utf-8')).toContain('echo upload');

    const sop = publisher.publishEvolutionProposal('proposal-sop-1');
    expect(sop?.publishedArtifactPath).toBe('knowledge:knowledge-evolution-sop-proposal-sop-1');
    expect(knowledgeStore.getKnowledgeAsset('knowledge-evolution-sop-proposal-sop-1')?.category).toBe('pattern');
  });
});
