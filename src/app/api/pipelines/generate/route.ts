import { NextResponse } from 'next/server';
import { generatePipeline, type GenerationInput } from '@/lib/agents/pipeline-generator';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import { AssetLoader } from '@/lib/agents/asset-loader';
import { callLLMOneshot } from '@/lib/agents/llm-oneshot';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pipelines/generate
 * Generate a graphPipeline draft using AI.
 *
 * Body: GenerationInput { goal, constraints?, referenceTemplateId?, model? }
 * Returns: GenerationResult (draft — must be confirmed before saving)
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { goal, constraints, referenceTemplateId, model } = body as GenerationInput;

  if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
    return NextResponse.json({ error: 'goal is required' }, { status: 400 });
  }

  // Guard against overly long goals (security: prevent prompt injection via payload size)
  if (goal.length > 5000) {
    return NextResponse.json({ error: 'goal exceeds maximum length (5000 chars)' }, { status: 400 });
  }

  try {
    const allTemplates = AssetLoader.loadAllTemplates();

    const result = await generatePipeline(
      { goal, constraints, referenceTemplateId, model },
      allTemplates,
      callLLMOneshot,
    );

    appendAuditEvent({
      kind: 'template:ai-generated',
      message: `AI pipeline draft generated: ${result.templateMeta.title}`,
      meta: {
        draftId: result.draftId,
        goal: goal.slice(0, 200),
        model,
        nodeCount: result.graphPipeline.nodes.length,
        valid: result.validation.valid,
        riskCount: result.risks.length,
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
