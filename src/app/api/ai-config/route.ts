import { NextResponse } from 'next/server';
import { loadAIConfig, saveAIConfig, resetAIConfigCache } from '@/lib/providers/ai-config';
import type { AIProviderConfig } from '@/lib/providers/types';
import { findUnavailableProviders, formatProviderValidationError } from '@/lib/providers/provider-availability';
import { getProviderInventory } from '@/lib/providers/provider-inventory';

export async function GET() {
  try {
    const config = loadAIConfig();
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({ error: 'Failed to load AI config' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as AIProviderConfig;
    if (!body.defaultProvider) {
      return NextResponse.json({ error: 'defaultProvider is required' }, { status: 400 });
    }

    const inventory = getProviderInventory();
    const invalidProviders = findUnavailableProviders(body, inventory);
    if (invalidProviders.length > 0) {
      return NextResponse.json(
        { error: formatProviderValidationError(invalidProviders), issues: invalidProviders },
        { status: 400 },
      );
    }

    resetAIConfigCache();
    saveAIConfig(body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save AI config' }, { status: 500 });
  }
}
