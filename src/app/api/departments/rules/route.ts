import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// GET /api/departments/rules?workspace=<uri>
export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsRulesGet } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsRulesGet(req);
  });
}

// PUT /api/departments/rules?workspace=<uri>&name=<ruleName>
// Body: { content: string }
export async function PUT(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsRulesPut } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsRulesPut(req);
  });
}

// DELETE /api/departments/rules?workspace=<uri>&name=<ruleName>
export async function DELETE(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleDepartmentsRulesDelete } = await import('@/server/control-plane/routes/departments');
    return handleDepartmentsRulesDelete(req);
  });
}
