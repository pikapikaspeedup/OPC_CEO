import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments?workspace=<encoded_uri>
export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const {
      handleDepartmentsGet,
      handleDepartmentsListGet,
    } = await import('@/server/control-plane/routes/departments');
    const url = new URL(req.url);
    if (!url.searchParams.get('workspace')) {
      return handleDepartmentsListGet();
    }
    return handleDepartmentsGet(req);
  });
}

// PUT /api/departments?workspace=<encoded_uri>
export async function PUT(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsPut } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsPut(req);
  });
}
