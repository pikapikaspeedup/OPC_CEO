import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments/quota?workspace=<uri>
// Returns real-time token quota and usage for a workspace.
export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsQuotaGet } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsQuotaGet(req);
  })
}
