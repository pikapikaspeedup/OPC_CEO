import { handleModelsGet } from '@/server/runtime/routes/user';
import {
  proxyToRuntime,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/models');

export async function GET(req: Request = DEFAULT_REQUEST) {
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req);
  }
  return handleModelsGet();
}
