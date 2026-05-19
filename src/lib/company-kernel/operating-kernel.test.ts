import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  OperatingAgendaItem,
  RunCapsule,
} from './contracts';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
	  return {
	    agendaStore: await import('./agenda-store'),
	    budgetGate: await import('./budget-gate'),
	    budgetLedgerStore: await import('./budget-ledger-store'),
	    budgetPolicy: await import('./budget-policy'),
	    circuitBreaker: await import('./circuit-breaker'),
    knowledgeStore: await import('../knowledge/store'),
	    memoryCandidateStore: await import('./memory-candidate-store'),
	    operatingDay: await import('./operating-day'),
	    operatingIntegration: await import('./operating-integration'),
	    operatingSignalStore: await import('./operating-signal-store'),
	    runRegistry: await import('../agents/run-registry'),
	    runCapsuleStore: await import('./run-capsule-store'),
	    approvalHandler: await import('../approval/handler'),
	  };
	}

function makeCapsule(overrides: Partial<RunCapsule> = {}): RunCapsule {
  return {
    capsuleId: overrides.capsuleId || `capsule-${overrides.runId || 'run-1'}`,
    runId: overrides.runId || 'run-1',
    workspaceUri: overrides.workspaceUri || 'file:///tmp/workspace',
    goal: 'Generate reusable report',
    prompt: 'Generate reusable report',
    status: 'completed',
    finishedAt: '2026-04-25T10:01:00.000Z',
    checkpoints: [],
    verifiedFacts: ['Result status: completed'],
    decisions: [],
    reusableSteps: ['Use the AI digest workflow for daily report generation.'],
    blockers: [],
    changedFiles: [],
    outputArtifacts: [{
      id: `ev-${overrides.runId || 'run-1'}`,
      type: 'result-envelope',
      label: 'Result Envelope',
      runId: overrides.runId || 'run-1',
      artifactPath: 'result-envelope.json',
      createdAt: '2026-04-25T10:01:00.000Z',
    }],
    qualitySignals: {
      resultStatus: 'completed',
      verificationPassed: true,
      hasResultEnvelope: true,
      hasArtifactManifest: false,
      hasDeliveryPacket: false,
    },
    sourceRunUpdatedAt: '2026-04-25T10:01:00.000Z',
    createdAt: '2026-04-25T10:00:00.000Z',
    updatedAt: '2026-04-25T10:01:00.000Z',
    ...overrides,
  };
}

function makeAgendaItem(overrides: Partial<OperatingAgendaItem> = {}): OperatingAgendaItem {
  return {
    id: 'agenda-1',
    signalIds: ['signal-1'],
    title: 'Dispatch safe work',
    recommendedAction: 'dispatch',
    targetDepartmentId: 'file:///tmp/workspace',
    priority: 'p1',
    score: 80,
    status: 'ready',
    reason: 'test',
    evidenceRefs: [],
    workspaceUri: 'file:///tmp/workspace',
    estimatedCost: { tokens: 200, minutes: 10 },
    createdAt: '2026-04-25T10:00:00.000Z',
    updatedAt: '2026-04-25T10:00:00.000Z',
    ...overrides,
  };
}

describe('company operating kernel phase 3-5', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'company-operating-kernel-'));
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

  it('observes run capsules into signals, agenda, and operating day', async () => {
    const modules = await loadModules();
    const agenda = modules.operatingIntegration.observeRunCapsuleForAgenda(makeCapsule({
      runId: 'run-learning',
    }));

    expect(agenda).toHaveLength(1);
    expect(modules.operatingSignalStore.countOperatingSignals({ source: 'run' })).toBe(1);
    expect(modules.agendaStore.countOperatingAgendaItems({ status: 'triaged' })).toBe(1);

    const day = modules.operatingDay.getCompanyOperatingDay({
      timezone: 'Asia/Shanghai',
      limit: 10,
    });
    expect(day.agenda.map((item) => item.id)).toContain(agenda[0].id);
    expect(day.focus[0]).toContain('Reusable work found');
  }, 15_000);

  it('blocks dispatch when the budget gate exceeds policy or circuit is open', async () => {
    const modules = await loadModules();
    modules.budgetPolicy.upsertBudgetPolicy({
      ...modules.budgetPolicy.buildDefaultBudgetPolicy({
        scope: 'department',
        scopeId: 'file:///tmp/workspace',
      }),
      maxTokens: 100,
      maxMinutes: 5,
      maxDispatches: 1,
    });

    const overBudget = modules.budgetGate.reserveBudgetForAgendaItem(makeAgendaItem());
    expect(overBudget.decision.allowed).toBe(false);
    expect(overBudget.ledger.decision).toBe('blocked');

    for (let index = 0; index < 3; index += 1) {
      modules.circuitBreaker.recordCircuitFailure({
        scope: 'department',
        scopeId: 'file:///tmp/workspace',
        reason: `test failure ${index + 1}`,
      });
    }
    const openCircuit = modules.budgetGate.checkBudgetForAgendaItem(makeAgendaItem({
      estimatedCost: { tokens: 1, minutes: 1 },
    }));
    expect(openCircuit.allowed).toBe(false);
    expect(openCircuit.reasons.join('\n')).toContain('Circuit breaker open');
  });

  it('moves expired open circuit breakers into half-open state', async () => {
    const modules = await loadModules();
    const openedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recoverAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    modules.circuitBreaker.upsertCircuitBreaker({
      id: 'breaker:department:file:///tmp/expired-circuit',
      scope: 'department',
      scopeId: 'file:///tmp/expired-circuit',
      status: 'open',
      failureCount: 3,
      threshold: 3,
      coolDownMinutes: 1,
      openedAt,
      recoverAt,
      reason: 'expired cooldown',
      updatedAt: openedAt,
    });

    const refreshed = modules.circuitBreaker.getCircuitBreaker('breaker:department:file:///tmp/expired-circuit');

    expect(refreshed?.status).toBe('half-open');
    expect(refreshed?.recoverAt).toBe(recoverAt);
    expect(modules.circuitBreaker.listCircuitBreakers({ status: 'open' })).toHaveLength(0);
    expect(modules.circuitBreaker.listCircuitBreakers({ status: 'half-open' })).toHaveLength(1);
  });

  it('applies department default budget policy to unconfigured departments', async () => {
    const modules = await loadModules();
    modules.budgetPolicy.upsertBudgetPolicy({
      ...modules.budgetPolicy.buildDefaultBudgetPolicy({ scope: 'department' }),
      maxTokens: 123_456,
      maxMinutes: 42,
      maxDispatches: 7,
    });

    const effective = modules.budgetPolicy.getOrCreateBudgetPolicy({
      scope: 'department',
      scopeId: 'file:///tmp/new-department',
    });

    expect(effective.scopeId).toBe('file:///tmp/new-department');
    expect(effective.maxTokens).toBe(123_456);
    expect(effective.maxMinutes).toBe(42);
    expect(effective.maxDispatches).toBe(7);
    expect(effective.metadata?.inheritedFrom).toBe('budget:department:default:day');
  });

  it('finalizes run budget reservations without double-counting reserved ledger', async () => {
    const modules = await loadModules();
    const agendaItem = modules.agendaStore.upsertOperatingAgendaItem(makeAgendaItem({
      id: 'agenda-budget-finalize',
      estimatedCost: { tokens: 80, minutes: 4 },
    }));
    const reserved = modules.budgetGate.reserveBudgetForAgendaItem(agendaItem);
    modules.budgetGate.attachRunToBudgetReservation(reserved.ledger, 'run-budget-finalize');

    modules.budgetGate.finalizeBudgetForTerminalRun({
      runId: 'run-budget-finalize',
      status: 'completed',
      tokens: 60,
      minutes: 3,
    });

    const entries = modules.budgetLedgerStore.listBudgetLedgerEntries({
      runId: 'run-budget-finalize',
    });
    expect(entries.map((entry) => entry.decision).sort()).toEqual(['committed', 'reserved']);
    expect(modules.budgetLedgerStore.summarizeBudgetLedger(entries)).toEqual({
      tokens: 60,
      minutes: 3,
      dispatches: 1,
    });
  });

  it('records growth operations in the budget ledger and blocks over-budget generation', async () => {
    const modules = await loadModules();
    modules.budgetPolicy.upsertBudgetPolicy({
      ...modules.budgetPolicy.buildDefaultBudgetPolicy({
        scope: 'growth-proposal',
        scopeId: 'global',
      }),
      maxTokens: 10,
      maxMinutes: 1,
      maxDispatches: 1,
    });

    const blocked = modules.budgetGate.recordBudgetForOperation({
      scope: 'growth-proposal',
      scopeId: 'global',
      estimatedCost: { tokens: 2_000, minutes: 2 },
      dispatches: 1,
      operationKind: 'growth.generate',
    });

    expect(blocked.decision.allowed).toBe(false);
    expect(blocked.ledger.decision).toBe('blocked');
    expect(blocked.ledger.metadata?.operationKind).toBe('growth.generate');
  });

  it('skips repeated operations while their cooldown window is active', async () => {
    const modules = await loadModules();
    modules.budgetPolicy.upsertBudgetPolicy({
      ...modules.budgetPolicy.buildDefaultBudgetPolicy({
        scope: 'growth-proposal',
        scopeId: 'global',
      }),
      cooldownMinutesByKind: {
        'growth.generate': 30,
      },
    });

    const first = modules.budgetGate.recordBudgetForOperation({
      scope: 'growth-proposal',
      scopeId: 'global',
      estimatedCost: { tokens: 100, minutes: 1 },
      dispatches: 1,
      operationKind: 'growth.generate',
    });
    expect(first.decision.allowed).toBe(true);

    const second = modules.budgetGate.recordBudgetForOperation({
      scope: 'growth-proposal',
      scopeId: 'global',
      estimatedCost: { tokens: 100, minutes: 1 },
      dispatches: 1,
      operationKind: 'growth.generate',
      blockedDecision: 'skipped',
    });
    expect(second.decision.allowed).toBe(false);
    expect(second.decision.reasons.join('\n')).toContain('Cooldown not elapsed for growth.generate');
    expect(second.ledger.decision).toBe('skipped');
  });

  it('opens real run circuit breakers after repeated terminal failures and resets on success', async () => {
    const modules = await loadModules();
    const workspace = 'file:///tmp/circuit-workspace';
    for (let index = 0; index < 3; index += 1) {
      const run = modules.runRegistry.createRun({
        stageId: `stage-${index}`,
        workspace,
        prompt: 'fail repeatedly',
        provider: 'native-codex',
        resolvedWorkflowRef: '/failing-workflow',
        triggerContext: {
          source: 'scheduler',
          schedulerJobId: 'scheduler-circuit-job',
        },
      });
      modules.runRegistry.updateRun(run.runId, {
        status: 'failed',
        lastError: `failure ${index + 1}`,
      });
    }

    expect(modules.circuitBreaker.getCircuitBreaker('breaker:department:file:///tmp/circuit-workspace')?.status).toBe('open');
    expect(modules.circuitBreaker.getCircuitBreaker('breaker:scheduler-job:scheduler-circuit-job')?.status).toBe('open');
    expect(modules.circuitBreaker.getCircuitBreaker('breaker:provider:native-codex')?.status).toBe('open');
    expect(modules.circuitBreaker.getCircuitBreaker('breaker:workflow:/failing-workflow')?.status).toBe('open');

    const run = modules.runRegistry.createRun({
      stageId: 'stage-success',
      workspace,
      prompt: 'recover',
      provider: 'native-codex',
      resolvedWorkflowRef: '/failing-workflow',
      triggerContext: {
        source: 'scheduler',
        schedulerJobId: 'scheduler-circuit-job',
      },
    });
    modules.runRegistry.updateRun(run.runId, { status: 'completed' });

    expect(modules.circuitBreaker.getCircuitBreaker('breaker:department:file:///tmp/circuit-workspace')?.status).toBe('closed');
    expect(modules.circuitBreaker.getCircuitBreaker('breaker:scheduler-job:scheduler-circuit-job')?.status).toBe('closed');
  });

  it('observes approval lifecycle changes into operating agenda', async () => {
    const modules = await loadModules();
    const approval = await modules.approvalHandler.submitApprovalRequest({
      type: 'proposal_publish',
      target: { kind: 'knowledge', knowledgeId: 'workflow-proposal' },
      title: 'Publish workflow',
      description: 'Publish a high-risk workflow proposal',
      workspace: 'file:///tmp/workspace',
      urgency: 'high',
    });

    expect(modules.operatingSignalStore.countOperatingSignals({ source: 'approval' })).toBe(1);
    expect(modules.agendaStore.countOperatingAgendaItems({ status: 'ready' })).toBe(1);

    await modules.approvalHandler.handleApprovalResponse(approval.id, 'rejected', 'not ready', 'web');
    expect(modules.operatingSignalStore.countOperatingSignals({ source: 'approval' })).toBe(2);
    expect(modules.agendaStore.listOperatingAgendaItems({ limit: 10 }).some((item) => item.title.includes('rejected'))).toBe(true);
  });

});
