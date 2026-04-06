import { NextResponse } from 'next/server';
import { listPipelines } from '@/lib/agents/pipeline/pipeline-registry';
import type { TemplateSummaryFE } from '@/lib/types';

export async function GET() {
  try {
    const templates = listPipelines();
    const summaries: TemplateSummaryFE[] = templates.map(t => {
      // For graphPipeline templates, synthesize pipeline summary from nodes
      const isGraph = !!t.graphPipeline;
      const pipeline = isGraph
        ? (t.graphPipeline?.nodes ?? []).map((n: any) => ({
            stageId: n.id,
            title: n.title || n.label || n.id,
            stageType: n.kind === 'stage' ? 'normal' : n.kind,
          }))
        : (t.pipeline?.map(s => ({
            stageId: s.stageId,
            title: s.title || s.stageId,
            ...('stageType' in s ? { stageType: (s as any).stageType } : {}),
          })) ?? []);

      return {
        id: t.id,
        title: t.title,
        stages: Object.fromEntries(
          (t.graphPipeline?.nodes ?? t.pipeline ?? []).map((stage: any) => [
            'id' in stage ? stage.id : stage.stageId,
            {
              title: stage.title || stage.label || ('id' in stage ? stage.id : stage.stageId),
              description: stage.description,
              roleIds: (stage.roles ?? []).map((r: any) => r.id),
              executionMode: stage.executionMode,
            },
          ]),
        ),
        pipeline,
        format: isGraph ? 'graphPipeline' as const : 'pipeline' as const,
      };
    });
    return NextResponse.json(summaries);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
