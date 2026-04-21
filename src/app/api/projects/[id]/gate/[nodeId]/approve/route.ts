import { NextResponse } from 'next/server';
import { getProject, updateProject } from '@/lib/agents/project-registry';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import { appendJournalEntry } from '@/lib/agents/execution-journal';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/[id]/gate/[nodeId]/approve
 * Approve or reject a gate node.
 *
 * Body: { action: 'approve' | 'reject', reason?: string, approvedBy?: string }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(request);
  }

  const { id, nodeId } = await params;

  const project = getProject(id);
  if (!project || !project.pipelineState) {
    return NextResponse.json({ error: 'Project not found or no pipeline state' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as string | undefined;

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  const stageProgress = project.pipelineState.stages.find(s => s.stageId === nodeId);
  if (!stageProgress) {
    return NextResponse.json({ error: `Node '${nodeId}' not found in pipeline state` }, { status: 404 });
  }

  const now = new Date().toISOString();
  const reason = (body.reason as string) || undefined;
  const approvedBy = (body.approvedBy as string) || undefined;

  // Update gate approval state
  stageProgress.gateApproval = {
    status: action === 'approve' ? 'approved' : 'rejected',
    approvedBy,
    reason,
    decidedAt: now,
  };

  // If approved, mark the gate node as completed so downstream can proceed
  if (action === 'approve') {
    stageProgress.status = 'completed';
    stageProgress.completedAt = now;
  } else {
    stageProgress.status = 'cancelled';
  }

  updateProject(id, {
    pipelineState: project.pipelineState,
    updatedAt: now,
  });

  // Audit
  appendAuditEvent({
    kind: action === 'approve' ? 'gate:approved' : 'gate:rejected',
    projectId: id,
    stageId: nodeId,
    message: `Gate '${nodeId}' ${action}ed${reason ? `: ${reason}` : ''}`,
    meta: { approvedBy, reason },
  });

  // Journal
  appendJournalEntry({
    projectId: id,
    nodeId,
    nodeKind: 'gate',
    eventType: 'gate:decided',
    details: { action, approvedBy, reason },
  });

  return NextResponse.json({
    nodeId,
    action,
    timestamp: now,
  });
}
