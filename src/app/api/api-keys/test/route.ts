import { NextResponse } from 'next/server';

// POST /api/api-keys/test — 测试 provider key 是否有效
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { provider: string; apiKey: string; baseUrl?: string };
    const { provider, apiKey, baseUrl } = body;

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json({ status: 'invalid', error: 'No API key provided' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      if (provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'x-api-key': apiKey.trim(),
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-20250404',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
          return NextResponse.json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          return NextResponse.json({ status: 'ok' });
        }
        return NextResponse.json({ status: 'error', error: `HTTP ${response.status}` });
      }

      if (provider === 'openai' || provider === 'openai-api') {
        const endpoint = baseUrl?.replace(/\/+$/, '') || 'https://api.openai.com';
        const response = await fetch(`${endpoint}/v1/models`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${apiKey.trim()}`,
          },
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
          return NextResponse.json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok) {
          return NextResponse.json({ status: 'ok' });
        }
        if (response.status >= 400 && response.status < 500) {
          return NextResponse.json({ status: 'ok' });
        }
        return NextResponse.json({ status: 'error', error: `HTTP ${response.status}` });
      }

      if (provider === 'gemini' || provider === 'gemini-api') {
        const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models';
        const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey.trim())}`, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
          return NextResponse.json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok) {
          return NextResponse.json({ status: 'ok' });
        }
        return NextResponse.json({ status: 'error', error: `HTTP ${response.status}` });
      }

      if (provider === 'grok' || provider === 'grok-api') {
        const endpoint = baseUrl?.replace(/\/+$/, '') || 'https://api.x.ai/v1';
        const response = await fetch(`${endpoint}/models`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
          },
        });

        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
          return NextResponse.json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok) {
          return NextResponse.json({ status: 'ok' });
        }
        return NextResponse.json({ status: 'error', error: `HTTP ${response.status}` });
      }

      if (provider === 'custom') {
        if (!baseUrl) {
          return NextResponse.json({ status: 'error', error: 'Custom provider requires baseUrl' });
        }
        let endpoint = '';
        try {
          endpoint = new URL(baseUrl).toString().replace(/\/+$/, '');
        } catch {
          return NextResponse.json({ status: 'error', error: 'base URL invalid' });
        }

        const response = await fetch(`${endpoint}/v1/models`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${apiKey.trim()}`,
          },
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
          return NextResponse.json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok) {
          return NextResponse.json({ status: 'ok' });
        }
        if (response.status === 404) {
          return NextResponse.json({ status: 'error', error: 'base URL invalid or /v1/models unavailable' });
        }
        if (response.status >= 400 && response.status < 500) {
          return NextResponse.json({ status: 'error', error: `HTTP ${response.status}` });
        }
        return NextResponse.json({ status: 'error', error: `HTTP ${response.status}` });
      }

      clearTimeout(timeoutId);
      return NextResponse.json({ status: 'untested', error: `Provider '${provider}' test not supported` });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if ((fetchErr as Error).name === 'AbortError') {
        return NextResponse.json({ status: 'error', error: 'Request timed out' });
      }
      return NextResponse.json({ status: 'error', error: (fetchErr as Error).message || 'Connection failed' });
    }
  } catch {
    return NextResponse.json({ status: 'error', error: 'Network error' }, { status: 500 });
  }
}
