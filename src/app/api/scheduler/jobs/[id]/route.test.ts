import { describe, expect, it } from 'vitest';

import { DELETE } from './route';

describe('DELETE /api/scheduler/jobs/[id]', () => {
  it('returns a protected response for built-in scheduled jobs', async () => {
    const jobId = 'builtin-platform-engineering-story-top-candidates';

    const res = await DELETE(new Request(`http://localhost/api/scheduler/jobs/${jobId}`, {
      method: 'DELETE',
    }), { params: Promise.resolve({ id: jobId }) });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: 'BUILTIN_JOB_PROTECTED',
      error: 'Built-in scheduled job cannot be deleted. Use enabled=false to disable it instead.',
      jobId,
    });
  });
});
