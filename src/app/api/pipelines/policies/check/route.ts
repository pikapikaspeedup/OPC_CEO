import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { GATEWAY_HOME } from '@/lib/agents/gateway-home';
import { evaluatePolicies, findApplicablePolicies } from '@/lib/agents/resource-policy-engine';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import type { ResourcePolicy, ResourceUsage } from '@/lib/agents/resource-policy-types';

export const dynamic = 'force-dynamic';

const POLICIES_FILE = path.join(GATEWAY_HOME, 'policies', 'resource-policies.json');

function loadPolicies(): ResourcePolicy[] {
  if (!existsSync(POLICIES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(POLICIES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * POST /api/pipelines/policies/check
 * Evaluate resource policies against provided usage counters.
 *
 * Body: { context: { workspaceUri?, templateId?, projectId? }, usage: ResourceUsage }
 * Returns: PolicyEvalResult
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { context, usage } = body as {
    context: { workspaceUri?: string; templateId?: string; projectId?: string };
    usage: ResourceUsage;
  };

  if (!context || !usage) {
    return NextResponse.json({ error: 'Missing context or usage' }, { status: 400 });
  }

  const allPolicies = loadPolicies();
  const applicable = findApplicablePolicies(allPolicies, context);
  const result = evaluatePolicies(applicable, usage);

  // Audit violations
  for (const v of result.violations) {
    appendAuditEvent({
      kind: v.action === 'block' ? 'policy:violation-block' : 'policy:violation-warn',
      projectId: context.projectId,
      message: v.message,
      meta: { policyId: v.policyId, resource: v.rule.resource, limit: v.rule.limit, current: v.currentValue },
    });
  }

  return NextResponse.json(result);
}
