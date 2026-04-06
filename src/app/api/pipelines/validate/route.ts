import { NextRequest, NextResponse } from 'next/server';
import { AssetLoader } from '@/lib/agents/asset-loader';
import { validateTemplatePipeline } from '@/lib/agents/pipeline/pipeline-graph';
import { validateTemplateContracts } from '@/lib/agents/contract-validator';
import { validateGraphPipeline } from '@/lib/agents/pipeline/graph-compiler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { templateId, template: inlineTemplate } = body as {
      templateId?: string;
      template?: any;
    };

    let template;
    if (inlineTemplate) {
      template = inlineTemplate;
    } else if (templateId) {
      template = AssetLoader.getTemplate(templateId);
      if (!template) {
        return NextResponse.json({ error: `Template '${templateId}' not found` }, { status: 404 });
      }
    } else {
      return NextResponse.json(
        { error: 'Either templateId or template must be provided' },
        { status: 400 },
      );
    }

    // Detect format and validate accordingly
    const format = template.graphPipeline ? 'graphPipeline' : 'pipeline';
    let dagErrors: string[];

    if (template.graphPipeline) {
      dagErrors = validateGraphPipeline(template.graphPipeline);
    } else {
      dagErrors = validateTemplatePipeline(template);
    }

    const contractResult = validateTemplateContracts(template);

    return NextResponse.json({
      valid: dagErrors.length === 0 && contractResult.valid,
      format,
      dagErrors,
      contractErrors: contractResult.errors,
      contractWarnings: contractResult.warnings,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
