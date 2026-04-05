import { NextResponse } from 'next/server';
import { listGroups } from '@/lib/agents/group-registry';

export const dynamic = 'force-dynamic';

// GET /api/agent-groups — list all available agent groups
export async function GET() {
  return NextResponse.json(listGroups().filter(group => group.executionMode !== 'orchestration'));
}
