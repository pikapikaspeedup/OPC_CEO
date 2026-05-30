import {
  getControlPlaneBaseUrl,
  getGatewayServerRole,
  getRuntimeBaseUrl,
  shouldProxyToControlPlane,
  shouldProxyToRuntime,
} from '@/lib/gateway-role';
import { CORRELATION_ID_HEADER, getCorrelationId, resolveCorrelationId } from '@/lib/request-context';

async function cloneRequestBody(req: Request): Promise<Blob | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  const body = await req.arrayBuffer();
  return new Blob([body]);
}

const PROXY_HEADERS_TIMEOUT_MS = 10_000;
const PROXY_MAX_GET_ATTEMPTS = 3;

function backoffDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 200));
}

/**
 * fetch that aborts only if the response *headers* don't arrive within
 * timeoutMs. The timer is cleared as soon as fetch resolves, so streaming /
 * SSE bodies (e.g. /api/approval/events, /api/agent-runs/[id]/stream) keep
 * flowing without being cut off mid-stream.
 */
async function fetchWithHeadersTimeout(
  targetUrl: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('proxy headers timeout', 'TimeoutError')),
    timeoutMs,
  );
  try {
    return await fetch(targetUrl, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyRequestToBase(
  req: Request,
  baseUrl: string,
  pathOverride?: string,
): Promise<Response> {
  const currentUrl = new URL(req.url);
  const targetUrl = new URL(pathOverride || currentUrl.pathname, baseUrl);
  targetUrl.search = currentUrl.search;

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.set('x-ag-proxied-by-role', getGatewayServerRole(process.env));
  headers.set(CORRELATION_ID_HEADER, getCorrelationId() || resolveCorrelationId(req));

  // Captured once so it can be reused across retries.
  const body = await cloneRequestBody(req);
  const init: RequestInit = { method: req.method, headers, body, redirect: 'manual' };

  // Only idempotent reads may be retried; retrying a write could double-execute.
  const idempotent = req.method === 'GET' || req.method === 'HEAD';
  const maxAttempts = idempotent ? PROXY_MAX_GET_ATTEMPTS : 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithHeadersTimeout(targetUrl, init, PROXY_HEADERS_TIMEOUT_MS);
      if (idempotent && response.status >= 500 && attempt < maxAttempts) {
        await response.body?.cancel().catch(() => {});
        await backoffDelay(attempt);
        continue;
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await backoffDelay(attempt);
    }
  }

  // Upstream unreachable (e.g. the api process is mid-restart). Return a clean
  // 502 rather than throwing, which Next would surface as an opaque 500.
  return new Response(
    JSON.stringify({
      error: 'Upstream service unavailable',
      detail: lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown'),
    }),
    { status: 502, headers: { 'content-type': 'application/json' } },
  );
}

export function shouldProxyControlPlaneRequest(): boolean {
  return shouldProxyToControlPlane(process.env);
}

export function shouldProxyRuntimeRequest(): boolean {
  return shouldProxyToRuntime(process.env);
}

export async function proxyToControlPlane(
  req: Request,
  pathOverride?: string,
): Promise<Response> {
  const baseUrl = getControlPlaneBaseUrl(process.env);
  if (!baseUrl) {
    throw new Error('AG_CONTROL_PLANE_URL is not configured');
  }
  return proxyRequestToBase(req, baseUrl, pathOverride);
}

export async function proxyToRuntime(
  req: Request,
  pathOverride?: string,
): Promise<Response> {
  const baseUrl = getRuntimeBaseUrl(process.env);
  if (!baseUrl) {
    throw new Error('AG_RUNTIME_URL is not configured');
  }
  return proxyRequestToBase(req, baseUrl, pathOverride);
}

export async function runControlPlaneRoute(
  req: Request,
  handler: () => Promise<Response> | Response,
  pathOverride?: string,
): Promise<Response> {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req, pathOverride);
  }
  return handler();
}

export async function runRuntimeRoute(
  req: Request,
  handler: () => Promise<Response> | Response,
  pathOverride?: string,
): Promise<Response> {
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req, pathOverride);
  }
  return handler();
}

export async function runControlPlaneThenRuntimeRoute(
  req: Request,
  handler: () => Promise<Response> | Response,
  options?: {
    controlPlanePathOverride?: string;
    runtimePathOverride?: string;
  },
): Promise<Response> {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req, options?.controlPlanePathOverride);
  }
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req, options?.runtimePathOverride);
  }
  return handler();
}
