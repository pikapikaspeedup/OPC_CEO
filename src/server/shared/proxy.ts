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

  const body = await cloneRequestBody(req);
  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
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
