import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CC_CONNECT_BASE = process.env.CC_CONNECT_URL || 'http://127.0.0.1:9820';
const CC_CONNECT_TOKEN = process.env.CC_CONNECT_TOKEN || 'ag-mgmt-2026';

/**
 * Proxy all requests to cc-connect Management API.
 * /api/cc-connect/status  → GET http://127.0.0.1:9820/api/v1/status
 * /api/cc-connect/projects/antigravity/sessions → GET http://127.0.0.1:9820/api/v1/projects/antigravity/sessions
 */
async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const subPath = path.join('/');
  const targetUrl = `${CC_CONNECT_BASE}/api/v1/${subPath}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${CC_CONNECT_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
  };

  // Forward body for POST/PATCH/PUT/DELETE
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      const body = await req.text();
      if (body) fetchOptions.body = body;
    } catch { /* no body */ }
  }

  try {
    const upstream = await fetch(targetUrl, fetchOptions);
    const data = await upstream.text();

    return new NextResponse(data, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'cc-connect Management API unreachable. Is cc-connect running with [management] enabled?',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const PUT = proxy;
