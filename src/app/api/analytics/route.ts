import { NextResponse } from 'next/server';
import { tryAllServers, grpc } from '@/lib/bridge/gateway';
import { aggregateProviderUsage } from '@/lib/provider-usage-analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  const providerUsage = aggregateProviderUsage(30);
  try {
    const data = await tryAllServers((p, c, a) => grpc.getUserAnalyticsSummary(p, c, a));
    return NextResponse.json({
      ...data,
      providerUsage: providerUsage.entries,
      providerUsageSummary: providerUsage.summary,
      dataSources: {
        antigravityRuntime: true,
        gatewayRuns: true,
      },
    });
  } catch {
    return NextResponse.json({
      providerUsage: providerUsage.entries,
      providerUsageSummary: providerUsage.summary,
      dataSources: {
        antigravityRuntime: false,
        gatewayRuns: true,
      },
      providerAwareNotice: 'Runtime analytics unavailable; showing Gateway run aggregation only.',
    });
  }
}
