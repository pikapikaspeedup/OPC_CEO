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
            groupId: n.groupId,
            stageId: n.id,
            stageType: n.kind === 'stage' ? 'normal' : n.kind,
          }))
        : (t.pipeline?.map(s => ({
            groupId: s.groupId,
            ...(s.stageId ? { stageId: s.stageId } : {}),
            ...('stageType' in s ? { stageType: (s as any).stageType } : {}),
          })) ?? []);

      return {
        id: t.id,
        title: t.title,
        groups: Object.fromEntries(
          Object.entries(t.groups).map(([gid, g]) => [
            gid,
            {
              title: g.title,
              description: g.description,
              roleIds: g.roles.map(r => r.id),
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
