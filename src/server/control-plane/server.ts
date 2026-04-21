import { createLogger } from '@/lib/logger';
import { GET as getAgentRuns, POST as postAgentRuns } from '@/app/api/agent-runs/route';
import { GET as getAgentRun, DELETE as deleteAgentRun } from '@/app/api/agent-runs/[id]/route';
import { GET as getAgentRunConversation } from '@/app/api/agent-runs/[id]/conversation/route';
import { POST as postAgentRunIntervene } from '@/app/api/agent-runs/[id]/intervene/route';
import { GET as getProjects, POST as postProjects } from '@/app/api/projects/route';
import { GET as getProject, PATCH as patchProject, DELETE as deleteProject } from '@/app/api/projects/[id]/route';
import { GET as getProjectDiagnostics } from '@/app/api/projects/[id]/diagnostics/route';
import { GET as getProjectGraph } from '@/app/api/projects/[id]/graph/route';
import { GET as getProjectDeliverables, POST as postProjectDeliverables } from '@/app/api/projects/[id]/deliverables/route';
import { GET as getProjectJournal } from '@/app/api/projects/[id]/journal/route';
import { GET as getProjectCheckpoints, POST as postProjectCheckpoints } from '@/app/api/projects/[id]/checkpoints/route';
import { POST as postProjectCheckpointRestore } from '@/app/api/projects/[id]/checkpoints/[checkpointId]/restore/route';
import { POST as postProjectReconcile } from '@/app/api/projects/[id]/reconcile/route';
import { POST as postProjectReplay } from '@/app/api/projects/[id]/replay/route';
import { POST as postProjectResume } from '@/app/api/projects/[id]/resume/route';
import { POST as postProjectGateApprove } from '@/app/api/projects/[id]/gate/[nodeId]/approve/route';
import { GET as getConversations } from '@/app/api/conversations/route';
import { GET as getSchedulerJobs, POST as postSchedulerJobs } from '@/app/api/scheduler/jobs/route';
import { GET as getSchedulerJob, PATCH as patchSchedulerJob, DELETE as deleteSchedulerJob } from '@/app/api/scheduler/jobs/[id]/route';
import { POST as postSchedulerJobTrigger } from '@/app/api/scheduler/jobs/[id]/trigger/route';
import { GET as getManagementOverview } from '@/app/api/management/overview/route';
import { GET as getAuditEvents } from '@/app/api/operations/audit/route';
import {
  jsonResponse,
  methodNotAllowedResponse,
  startRouteServer,
} from '@/server/shared/http-server';

const log = createLogger('ControlPlaneServer');

export function startControlPlaneServer(options: {
  port: number;
  hostname?: string;
}) {
  const server = startRouteServer({
    name: 'control-plane',
    port: options.port,
    hostname: options.hostname,
    routes: [
      {
        pattern: /^\/health$/,
        handler: async () => jsonResponse({ ok: true, role: 'control-plane' }),
      },
      {
        pattern: /^\/api\/agent-runs$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return getAgentRuns(req);
          }
          if (req.method === 'POST') {
            return postAgentRuns(req);
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/agent-runs\/([^/]+)$/,
        handler: async (req, match) => {
          const params = { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) };
          if (req.method === 'GET') {
            return getAgentRun(req, params);
          }
          if (req.method === 'DELETE') {
            return deleteAgentRun(req, params);
          }
          return methodNotAllowedResponse(['GET', 'DELETE']);
        },
      },
      {
        pattern: /^\/api\/agent-runs\/([^/]+)\/intervene$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postAgentRunIntervene(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/agent-runs\/([^/]+)\/conversation$/,
        handler: async (req, match) => {
          if (req.method === 'GET') {
            return getAgentRunConversation(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/projects$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return getProjects(req);
          }
          if (req.method === 'POST') {
            return postProjects(req);
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)$/,
        handler: async (req, match) => {
          const params = { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) };
          if (req.method === 'GET') {
            return getProject(req, params);
          }
          if (req.method === 'PATCH') {
            return patchProject(req, params);
          }
          if (req.method === 'DELETE') {
            return deleteProject(req, params);
          }
          return methodNotAllowedResponse(['GET', 'PATCH', 'DELETE']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/diagnostics$/,
        handler: async (req, match) => {
          if (req.method === 'GET') {
            return getProjectDiagnostics(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/graph$/,
        handler: async (req, match) => {
          if (req.method === 'GET') {
            return getProjectGraph(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/deliverables$/,
        handler: async (req, match) => {
          const params = { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) };
          if (req.method === 'GET') {
            return getProjectDeliverables(req, params);
          }
          if (req.method === 'POST') {
            return postProjectDeliverables(req, params);
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/journal$/,
        handler: async (req, match) => {
          if (req.method === 'GET') {
            return getProjectJournal(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/checkpoints$/,
        handler: async (req, match) => {
          const params = { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) };
          if (req.method === 'GET') {
            return getProjectCheckpoints(req, params);
          }
          if (req.method === 'POST') {
            return postProjectCheckpoints(req, params);
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/checkpoints\/([^/]+)\/restore$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postProjectCheckpointRestore(req, {
              params: Promise.resolve({
                id: decodeURIComponent(match[1]),
                checkpointId: decodeURIComponent(match[2]),
              }),
            });
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/reconcile$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postProjectReconcile(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/resume$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postProjectResume(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/replay$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postProjectReplay(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/gate\/([^/]+)\/approve$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postProjectGateApprove(req, {
              params: Promise.resolve({
                id: decodeURIComponent(match[1]),
                nodeId: decodeURIComponent(match[2]),
              }),
            });
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/conversations$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return getConversations(req);
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/scheduler\/jobs$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return getSchedulerJobs(req);
          }
          if (req.method === 'POST') {
            return postSchedulerJobs(req);
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/scheduler\/jobs\/([^/]+)$/,
        handler: async (req, match) => {
          const params = { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) };
          if (req.method === 'GET') {
            return getSchedulerJob(req, params);
          }
          if (req.method === 'PATCH') {
            return patchSchedulerJob(req, params);
          }
          if (req.method === 'DELETE') {
            return deleteSchedulerJob(req, params);
          }
          return methodNotAllowedResponse(['GET', 'PATCH', 'DELETE']);
        },
      },
      {
        pattern: /^\/api\/scheduler\/jobs\/([^/]+)\/trigger$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postSchedulerJobTrigger(req, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/management\/overview$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return getManagementOverview(req);
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/operations\/audit$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return getAuditEvents(req);
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
    ],
  });

  log.info({ port: options.port }, 'Control-plane server started');
  return server;
}
