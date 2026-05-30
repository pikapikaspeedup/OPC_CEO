import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments/content?workspace=<uri>[&path=<relative markdown path>]
export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsContentGet } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsContentGet(req);
  });
}
