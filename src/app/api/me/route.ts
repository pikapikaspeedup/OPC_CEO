import { NextResponse } from 'next/server';
import { getUserInfo, getDefaultConnection, grpc } from '@/lib/bridge/gateway';
import { loadAIConfig } from '@/lib/providers/ai-config';
import { aggregateProviderUsage, buildProviderCreditSummaries } from '@/lib/provider-usage-analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = getUserInfo();
  const conn = await getDefaultConnection();
  const aiConfig = loadAIConfig();
  const providerUsage = aggregateProviderUsage(30);
  let credits = null;
  if (conn) {
    try {
      credits = await grpc.getModelConfigs(conn.port, conn.csrf, conn.apiKey);
    } catch {}
  }
  return NextResponse.json({
    ...user,
    apiKey: undefined,
    hasApiKey: !!user.apiKey,
    credits,
    providerCredits: buildProviderCreditSummaries(),
    providerUsageSummary: providerUsage.summary,
    creditSource: conn ? 'antigravity' : null,
    providerAwareNotice: aiConfig.defaultProvider !== 'antigravity'
      ? 'credits currently reflect Antigravity IDE runtime only'
      : null,
  });
}
