import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getApiKeysPath, getProviderInventory, readStoredApiKeys, type StoredApiKeys } from '@/lib/providers/provider-inventory';

// GET /api/api-keys — 返回已设置状态（不返回 key 值）
export async function GET() {
  return NextResponse.json(getProviderInventory());
}

// PUT /api/api-keys — 保存 key（做 trim，不做其他处理）
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      anthropic?: string;
      openai?: string;
      gemini?: string;
      grok?: string;
    };
    const keys = readStoredApiKeys() as StoredApiKeys;

    if (typeof body.anthropic === 'string') {
      keys.anthropic = body.anthropic.trim() || undefined;
    }
    if (typeof body.openai === 'string') {
      keys.openai = body.openai.trim() || undefined;
    }
    if (typeof body.gemini === 'string') {
      keys.gemini = body.gemini.trim() || undefined;
    }
    if (typeof body.grok === 'string') {
      keys.grok = body.grok.trim() || undefined;
    }

    const p = getApiKeysPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(keys, null, 2));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save API keys' }, { status: 500 });
  }
}
