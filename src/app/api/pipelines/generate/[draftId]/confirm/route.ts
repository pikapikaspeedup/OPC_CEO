import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { confirmDraft, getDraft } from '@/lib/agents/pipeline-generator';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import { GLOBAL_ASSETS_DIR } from '@/lib/agents/gateway-home';
import { AssetLoader } from '@/lib/agents/asset-loader';
import type { TemplateDefinition } from '@/lib/agents/pipeline/pipeline-types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pipelines/generate/[draftId]/confirm
 * Confirm a draft, save the resulting template to disk.
 *
 * Body (optional): { graphPipeline?, templateMeta?: { title?, description? } }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;

  const preDraft = getDraft(draftId);
  if (!preDraft) {
    return NextResponse.json({ error: 'Draft not found or expired' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const modifications = body as {
    graphPipeline?: any;
    templateMeta?: { title?: string; description?: string };
  };

  try {
    const result = await confirmDraft(draftId, modifications);

    if (!result.saved) {
      appendAuditEvent({
        kind: 'template:ai-rejected',
        message: `AI pipeline draft rejected: ${result.validationErrors?.join('; ') ?? 'unknown'}`,
        meta: { draftId },
      });

      return NextResponse.json({
        saved: false,
        validationErrors: result.validationErrors,
      }, { status: 422 });
    }

    // Use the confirmed draft (modifications may have been applied by confirmDraft)
    const draft = getDraft(draftId) ?? preDraft;

    // Build groups from DAG nodes — deduplicate by groupId and generate a
    // default worker role for each group so the template is immediately usable.
    const groupMap = new Map<string, { title: string; nodeLabels: string[] }>();
    for (const n of draft.graphPipeline.nodes as any[]) {
      const existing = groupMap.get(n.groupId);
      if (existing) {
        if (n.label) existing.nodeLabels.push(n.label);
      } else {
        groupMap.set(n.groupId, { title: n.label ?? n.groupId, nodeLabels: n.label ? [n.label] : [] });
      }
    }

    const groups: TemplateDefinition['groups'] = {};
    for (const [gid, info] of groupMap) {
      groups[gid] = {
        title: info.title,
        description: info.nodeLabels.length > 1 ? `节点: ${info.nodeLabels.join(', ')}` : '',
        executionMode: 'review-loop' as const,
        roles: [
          {
            id: 'worker',
            workflow: `/dev-worker`,
            timeoutMs: 600_000,
            autoApprove: false,
          },
        ],
      };
    }

    const templateDef: TemplateDefinition = {
      id: result.templateId,
      kind: 'template',
      title: draft.templateMeta.title,
      description: draft.templateMeta.description ?? '',
      groups,
      pipeline: [],
      graphPipeline: draft.graphPipeline as any,
    };

    const templatesDir = path.join(GLOBAL_ASSETS_DIR, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const filePath = path.join(templatesDir, `${result.templateId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(templateDef, null, 2), 'utf-8');

    // Reload template cache
    AssetLoader.reloadTemplates();

    appendAuditEvent({
      kind: 'template:ai-confirmed',
      message: `AI pipeline draft confirmed and saved: ${result.templateId}`,
      meta: { draftId, templateId: result.templateId },
    });

    return NextResponse.json({
      saved: true,
      templateId: result.templateId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
