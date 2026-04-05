import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { GATEWAY_HOME } from '@/lib/agents/gateway-home';
import { evaluatePolicies, findApplicablePolicies } from '@/lib/agents/resource-policy-engine';
import type { ResourcePolicy, ResourceUsage } from '@/lib/agents/resource-policy-types';

export const dynamic = 'force-dynamic';

const POLICIES_DIR = path.join(GATEWAY_HOME, 'policies');
const POLICIES_FILE = path.join(POLICIES_DIR, 'resource-policies.json');

function loadPolicies(): ResourcePolicy[] {
  if (!existsSync(POLICIES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(POLICIES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function savePolicies(policies: ResourcePolicy[]): void {
  if (!existsSync(POLICIES_DIR)) {
    mkdirSync(POLICIES_DIR, { recursive: true });
  }
  writeFileSync(POLICIES_FILE, JSON.stringify(policies, null, 2), 'utf-8');
}

/**
 * GET /api/pipelines/policies
 * List all resource policies.
 *
 * Query params: scope?, targetId?
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');
  const targetId = url.searchParams.get('targetId');

  let policies = loadPolicies();

  if (scope) policies = policies.filter(p => p.scope === scope);
  if (targetId) policies = policies.filter(p => p.targetId === targetId);

  return NextResponse.json(policies);
}

/**
 * POST /api/pipelines/policies
 * Create or update a resource policy.
 *
 * Body: ResourcePolicy
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const policy = body as ResourcePolicy;

  if (!policy.id || !policy.name || !policy.scope || !policy.targetId || !Array.isArray(policy.rules)) {
    return NextResponse.json(
      { error: 'Missing required fields: id, name, scope, targetId, rules' },
      { status: 400 },
    );
  }

  // Validate scope
  if (!['workspace', 'template', 'project'].includes(policy.scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  // Validate rules
  const validResources = ['runs', 'branches', 'iterations', 'stages', 'concurrent-runs'];
  const validActions = ['warn', 'block', 'pause'];
  for (const rule of policy.rules) {
    if (!validResources.includes(rule.resource)) {
      return NextResponse.json({ error: `Invalid resource: ${rule.resource}` }, { status: 400 });
    }
    if (!validActions.includes(rule.action)) {
      return NextResponse.json({ error: `Invalid action: ${rule.action}` }, { status: 400 });
    }
    if (typeof rule.limit !== 'number' || rule.limit < 0) {
      return NextResponse.json({ error: 'Rule limit must be a non-negative number' }, { status: 400 });
    }
  }

  policy.kind = 'resource-policy';
  if (policy.enabled === undefined) policy.enabled = true;

  const policies = loadPolicies();
  const existingIdx = policies.findIndex(p => p.id === policy.id);
  if (existingIdx >= 0) {
    policies[existingIdx] = policy;
  } else {
    policies.push(policy);
  }

  savePolicies(policies);

  return NextResponse.json(policy, { status: existingIdx >= 0 ? 200 : 201 });
}
