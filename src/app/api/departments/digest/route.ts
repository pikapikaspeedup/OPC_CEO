import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments/digest?workspace=<encoded_uri>&date=2026-01-15&period=day|week|month
export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsDigestGet } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsDigestGet(req);
  })
}
