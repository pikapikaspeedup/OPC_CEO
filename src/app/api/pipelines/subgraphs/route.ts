import { NextResponse } from 'next/server';
import { AssetLoader } from '@/lib/agents/asset-loader';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pipelines/subgraphs
 * List all available subgraph definitions.
 */
export async function GET() {
  try {
    const subgraphs = AssetLoader.loadAllSubgraphs();
    return NextResponse.json(subgraphs);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
