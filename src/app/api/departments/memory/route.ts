import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments/memory?workspace=<uri>[&scope=department|organization]
export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsMemoryGet } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsMemoryGet(req);
  })
}

// POST /api/departments/memory?workspace=<uri>&category=<knowledge|decisions|patterns>
// Body: { content: string, source?: string }
export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsMemoryPost } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsMemoryPost(req);
  })
}
