import { NextRequest, NextResponse } from 'next/server';
import { pipelineToGraphPipeline, graphPipelineToPipeline } from '@/lib/agents/graph-pipeline-converter';

export const dynamic = 'force-dynamic';

type ConvertDirection = 'pipeline-to-graph' | 'graph-to-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { direction, pipeline, graphPipeline } = body as {
      direction?: ConvertDirection;
      pipeline?: any[];
      graphPipeline?: any;
    };

    if (!direction) {
      return NextResponse.json(
        { error: 'direction is required (pipeline-to-graph | graph-to-pipeline)' },
        { status: 400 },
      );
    }

    switch (direction) {
      case 'pipeline-to-graph': {
        if (!pipeline || !Array.isArray(pipeline)) {
          return NextResponse.json(
            { error: 'pipeline[] is required for pipeline-to-graph conversion' },
            { status: 400 },
          );
        }
        const result = pipelineToGraphPipeline(pipeline);
        return NextResponse.json({ graphPipeline: result });
      }

      case 'graph-to-pipeline': {
        if (!graphPipeline || !graphPipeline.nodes) {
          return NextResponse.json(
            { error: 'graphPipeline is required for graph-to-pipeline conversion' },
            { status: 400 },
          );
        }
        const result = graphPipelineToPipeline(graphPipeline);
        return NextResponse.json({ pipeline: result });
      }

      default:
        return NextResponse.json(
          { error: `Unknown direction: '${direction}'` },
          { status: 400 },
        );
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
