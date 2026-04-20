import { NextResponse } from 'next/server';
import { tryAllServers, grpc } from '@/lib/bridge/gateway';
import { buildProviderAwareModelResponse, mergeModelResponses } from '@/lib/provider-model-catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  const fallback = buildProviderAwareModelResponse();
  try {
    const data = await tryAllServers((p, c, a) => grpc.getModelConfigs(p, c, a));
    return NextResponse.json(mergeModelResponses(data, fallback));
  } catch (error: unknown) {
    if ((fallback.clientModelConfigs || []).length > 0) {
      return NextResponse.json(fallback);
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
