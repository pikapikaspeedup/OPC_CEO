import { describe, expect, it } from 'vitest';

import { createRuntimeRoutes } from './server';

function findRoute(pathname: string) {
  return createRuntimeRoutes({ includeHealth: false }).find((route) => route.pattern.test(pathname));
}

describe('runtime route table', () => {
  it('registers conversation auxiliary runtime routes for split web/api mode', async () => {
    const cases = [
      {
        pathname: '/api/conversations/conversation-1/files',
        wrongMethod: 'POST',
        allow: 'GET',
      },
      {
        pathname: '/api/conversations/conversation-1/proceed',
        wrongMethod: 'GET',
        allow: 'POST',
      },
      {
        pathname: '/api/conversations/conversation-1/revert',
        wrongMethod: 'GET',
        allow: 'POST',
      },
      {
        pathname: '/api/conversations/conversation-1/revert-preview',
        wrongMethod: 'POST',
        allow: 'GET',
      },
    ];

    for (const item of cases) {
      const route = findRoute(item.pathname);
      expect(route, item.pathname).toBeDefined();
      const match = item.pathname.match(route!.pattern);
      expect(match, item.pathname).toBeTruthy();

      const response = await route!.handler(
        new Request(`http://localhost${item.pathname}`, { method: item.wrongMethod }),
        match!,
      );

      expect(response.status, item.pathname).toBe(405);
      expect(response.headers.get('Allow'), item.pathname).toBe(item.allow);
    }
  });
});
