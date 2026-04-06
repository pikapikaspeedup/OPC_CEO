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

    const templateDef: TemplateDefinition = {
      id: result.templateId,
      kind: 'template',
      title: draft.templateMeta.title,
      description: draft.templateMeta.description ?? '',
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
