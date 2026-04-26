import { NextResponse, type NextRequest } from 'next/server';

import { shouldBlockUnconfiguredWebApi } from '@/lib/gateway-role';

export function proxy(request: NextRequest) {
  if (!shouldBlockUnconfiguredWebApi(process.env)) {
    return NextResponse.next();
  }

  return NextResponse.json(
    {
      error: 'AG_ROLE=web requires AG_CONTROL_PLANE_URL and AG_RUNTIME_URL for API requests',
      role: 'web',
      path: request.nextUrl.pathname,
    },
    { status: 503 },
  );
}

export const config = {
  matcher: ['/api/:path*'],
};
