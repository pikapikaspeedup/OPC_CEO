import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// POST /api/departments/sync?workspace=<uri>&target=<ide|all>
export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsSyncPost } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsSyncPost(req);
  })
}
