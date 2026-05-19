import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GrowthProposal } from './contracts';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  delete (globalThis as Record<string, unknown>).__PROJECT_REGISTRY_MAP;
  delete (globalThis as Record<string, unknown>).__PROJECT_REGISTRY_INITIALIZED__;
  delete (globalThis as Record<string, unknown>).__AGENT_RUNS_REGISTRY_MAP;
  delete (globalThis as Record<string, unknown>).__AGENT_RUNS_REGISTRY_INITIALIZED__;
  return {
    approvalStore: await import('../approval/request-store'),
    decisions: await import('./ceo-decision-control'),
    selfImprovementStore: await import('./self-improvement-store'),
    gatewayDb: await import('../storage/gateway-db'),
  };
}

function seedGrowthProposal(db: Database.Database, proposal: GrowthProposal): void {
  db.prepare(`
    INSERT INTO growth_proposals(
      proposal_id, kind, status, risk, score, workspace, target_name, target_ref,
      created_at, updated_at, payload_json
    )
    VALUES (
      @proposal_id, @kind, @status, @risk, @score, @workspace, @target_name, @target_ref,
      @created_at, @updated_at, @payload_json
    )
  `).run({
    proposal_id: proposal.id,
    kind: proposal.kind,
    status: proposal.status,
    risk: proposal.risk,
    score: proposal.score,
    workspace: proposal.workspaceUri || null,
    target_name: proposal.targetName,
    target_ref: proposal.targetRef,
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    payload_json: JSON.stringify(proposal),
  });
}

describe('ceo decision control', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ceo-decision-control-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns only system improvement approvals in the CEO queue', async () => {
    const { approvalStore, decisions, gatewayDb, selfImprovementStore } = await loadModules();
    const systemRequest = approvalStore.createApprovalRequest({
      type: 'other',
      target: { kind: 'system-improvement-proposal', proposalId: 'proposal-1' },
      workspace: 'organization',
      title: '系统改进审批',
      description: 'Need approval',
      urgency: 'high',
    });
    selfImprovementStore.upsertSystemImprovementProposal({
      id: 'proposal-1',
      status: 'approval-required',
      humanGate: {
        state: 'entry-approval-required',
        title: '等待准入',
        summary: '等待 CEO',
        updatedAt: '2026-05-06T10:00:00.000Z',
      },
      title: '系统改进详情支持 URL 深链恢复',
      summary: 'Restore proposal detail from URL.',
      sourceSignalIds: ['signal-1'],
      evidenceRefs: [],
      affectedFiles: ['src/app/page.tsx'],
      protectedAreas: ['approval'],
      risk: 'high',
      implementationPlan: ['Implement'],
      testPlan: ['npx tsc --noEmit --pretty false'],
      rollbackPlan: ['revert patch'],
      approvalRequestId: systemRequest.id,
      linkedRunIds: [],
      testEvidence: [],
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T10:00:00.000Z',
    });

    const growthRequest = approvalStore.createApprovalRequest({
      type: 'proposal_publish',
      target: { kind: 'growth-proposal', proposalId: 'growth-1' },
      workspace: 'organization',
      title: '增长提案审批',
      description: 'Need approval',
      urgency: 'high',
    });
    seedGrowthProposal(gatewayDb.getGatewayDb(), {
      id: 'growth-1',
      kind: 'workflow',
      status: 'approval-required',
      risk: 'high',
      score: 92,
      title: '增长提案',
      summary: 'Publish a workflow.',
      targetName: 'workflow',
      targetRef: 'workflow/ref',
      content: 'content',
      sourceRunIds: [],
      sourceCapsuleIds: [],
      sourceKnowledgeIds: [],
      sourceCandidateIds: [],
      evidenceRefs: [],
      approvalRequestId: growthRequest.id,
      createdAt: '2026-05-06T10:05:00.000Z',
      updatedAt: '2026-05-06T10:05:00.000Z',
    });

    approvalStore.createApprovalRequest({
      type: 'other',
      target: { kind: 'run', runId: 'legacy-run-1', projectId: 'project-1' },
      workspace: 'file:///tmp/legacy',
      title: '旧运行失败审批',
      description: '不应进入 CEO 正式决策队列',
      urgency: 'normal',
    });

    const items = await decisions.listCEODecisionItems();
    expect(items.map(item => item.target)).toEqual(expect.arrayContaining([
      { kind: 'system-improvement-proposal', proposalId: 'proposal-1' },
    ]));
    expect(items.every(item => item.target.kind !== 'growth-proposal')).toBe(true);
    expect(items.every(item => item.target.kind !== 'project')).toBe(true);
    expect(items.every(item => item.target.kind !== 'run')).toBe(true);
    expect(items.every(item => item.currentOwner === 'ceo')).toBe(true);
  }, 20000);

  it('does not surface rejected system improvement entry approvals in the CEO queue', async () => {
    const { approvalStore, decisions, selfImprovementStore } = await loadModules();
    const request = approvalStore.createApprovalRequest({
      type: 'other',
      target: { kind: 'system-improvement-proposal', proposalId: 'proposal-rejected-entry' },
      workspace: 'organization',
      title: '系统改进审批',
      description: 'Need approval',
      urgency: 'high',
    });
    approvalStore.respondToRequest(request.id, {
      action: 'rejected',
      message: 'Declined by CEO.',
      respondedAt: '2026-05-06T10:20:00.000Z',
      channel: 'web',
    });

    selfImprovementStore.upsertSystemImprovementProposal({
      id: 'proposal-rejected-entry',
      status: 'approval-required',
      humanGate: {
        state: 'entry-approval-required',
        title: '等待准入',
        summary: '等待 CEO',
        updatedAt: '2026-05-06T10:19:00.000Z',
      },
      title: '系统改进详情支持 URL 深链恢复',
      summary: 'Restore proposal detail from URL.',
      sourceSignalIds: ['signal-1'],
      evidenceRefs: [],
      affectedFiles: ['src/app/page.tsx'],
      protectedAreas: ['approval'],
      risk: 'high',
      implementationPlan: ['Implement'],
      testPlan: ['npx tsc --noEmit --pretty false'],
      rollbackPlan: ['revert patch'],
      approvalRequestId: request.id,
      linkedRunIds: [],
      testEvidence: [],
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T10:21:00.000Z',
    });

    const items = await decisions.listCEODecisionItems();
    expect(items.some((item) => item.target.kind === 'system-improvement-proposal' && item.target.proposalId === 'proposal-rejected-entry')).toBe(false);
  });
});
