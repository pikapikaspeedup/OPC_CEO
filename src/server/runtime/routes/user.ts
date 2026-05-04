import { getDefaultConnection, getUserInfo, grpc, tryAllServers } from '@/lib/bridge/gateway';
import { loadAIConfig } from '@/lib/providers/ai-config';
import { buildProviderAwareModelResponse, mergeModelResponses } from '@/lib/provider-model-catalog';
import { aggregateProviderUsage, buildProviderCreditSummaries } from '@/lib/provider-usage-analytics';

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export async function handleMeGet(): Promise<Response> {
  const user = getUserInfo();
  const connection = await getDefaultConnection();
  const aiConfig = loadAIConfig();
  const providerUsage = aggregateProviderUsage(30);

  let credits = null;
  if (connection) {
    try {
      credits = await grpc.getModelConfigs(connection.port, connection.csrf, connection.apiKey);
    } catch {
      credits = null;
    }
  }

  return json({
    ...user,
    apiKey: undefined,
    hasApiKey: !!user.apiKey,
    credits,
    providerCredits: buildProviderCreditSummaries(),
    providerUsageSummary: providerUsage.summary,
    creditSource: connection ? 'antigravity' : null,
    providerAwareNotice: aiConfig.defaultProvider !== 'antigravity'
      ? 'credits currently reflect Antigravity IDE runtime only'
      : null,
  });
}

export async function handleModelsGet(): Promise<Response> {
  const fallback = await buildProviderAwareModelResponse();
  try {
    const data = await tryAllServers((port, csrf, apiKey) => grpc.getModelConfigs(port, csrf, apiKey));
    return json(mergeModelResponses(data, fallback));
  } catch (error: unknown) {
    if ((fallback.clientModelConfigs || []).length > 0) {
      return json(fallback);
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
