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
  handleApprovalCreatePost,
  handleApprovalDetailGet,
  handleApprovalDetailPatch,
  handleApprovalFeedback,
  handleApprovalListGet,
} from '@/server/control-plane/routes/approval';
import { handleApprovalEventsStream } from '@/server/control-plane/routes/approval-events';
import { createCompanyControlPlaneRoutes } from '@/server/control-plane/company-routes';
import {
  handleCEOCommandPost,
  handleCEOEventsGet,
  handleCEOProfileFeedbackPost,
  handleCEOProfileGet,
  handleCEOProfilePatch,
  handleCEORoutineGet,
  handleCEOSetupGet,
  handleCEOSetupPost,
} from '@/server/control-plane/routes/ceo';
import {
  handleDepartmentsDigestGet,
  handleDepartmentsGet,
  handleDepartmentsMemoryGet,
  handleDepartmentsMemoryPost,
  handleDepartmentsPut,
  handleDepartmentsQuotaGet,
  handleDepartmentsSyncPost,
} from '@/server/control-plane/routes/departments';
import {
  handleAIConfigGet,
  handleAIConfigPut,
  handleApiKeysGet,
  handleApiKeysPut,
  handleApiKeysTestPost,
  handleMcpConfigGet,
  handleMcpServersDelete,
  handleMcpServersPost,
  handleMcpToolsGet,
} from '@/server/control-plane/routes/settings';
import {
  handleWorkspacesCloseDelete,
  handleWorkspacesCloseGet,
  handleWorkspacesClosePost,
  handleWorkspacesGet,
  handleWorkspacesImportPost,
} from '@/server/control-plane/routes/workspaces';
import {
  jsonResponse,
  methodNotAllowedResponse,
  type RouteDefinition,
  startRouteServer,
} from '@/server/shared/http-server';

const log = createLogger('ControlPlaneServer');

export function createControlPlaneRoutes(options: { includeHealth?: boolean } = {}): RouteDefinition[] {
  return [
      ...(options.includeHealth === false ? [] : [{
        pattern: /^\/health$/,
        handler: async () => jsonResponse({ ok: true, role: 'control-plane' }),
      }]),
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
      ...createCompanyControlPlaneRoutes(),
      {
        pattern: /^\/api\/approval$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleApprovalListGet(req);
          }
          if (req.method === 'POST') {
            return handleApprovalCreatePost(req);
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/approval\/events$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleApprovalEventsStream(req);
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/approval\/([^/]+)\/feedback$/,
        handler: async (req, match) => {
          if (req.method === 'GET' || req.method === 'POST') {
            return handleApprovalFeedback(req, decodeURIComponent(match[1]));
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/approval\/([^/]+)$/,
        handler: async (req, match) => {
          const id = decodeURIComponent(match[1]);
          if (req.method === 'GET') {
            return handleApprovalDetailGet(id);
          }
          if (req.method === 'PATCH') {
            return handleApprovalDetailPatch(req, id);
          }
          return methodNotAllowedResponse(['GET', 'PATCH']);
        },
      },
      {
        pattern: /^\/api\/ai-config$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleAIConfigGet();
          }
          if (req.method === 'PUT') {
            return handleAIConfigPut(req);
          }
          return methodNotAllowedResponse(['GET', 'PUT']);
        },
      },
      {
        pattern: /^\/api\/api-keys$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleApiKeysGet();
          }
          if (req.method === 'PUT') {
            return handleApiKeysPut(req);
          }
          return methodNotAllowedResponse(['GET', 'PUT']);
        },
      },
      {
        pattern: /^\/api\/api-keys\/test$/,
        handler: async (req) => {
          if (req.method === 'POST') {
            return handleApiKeysTestPost(req);
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/ceo\/command$/,
        handler: async (req) => {
          if (req.method === 'POST') {
            return handleCEOCommandPost(req);
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/ceo\/events$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleCEOEventsGet(req);
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/ceo\/profile$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleCEOProfileGet();
          }
          if (req.method === 'PATCH') {
            return handleCEOProfilePatch(req);
          }
          return methodNotAllowedResponse(['GET', 'PATCH']);
        },
      },
      {
        pattern: /^\/api\/ceo\/profile\/feedback$/,
        handler: async (req) => {
          if (req.method === 'POST') {
            return handleCEOProfileFeedbackPost(req);
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/ceo\/routine$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleCEORoutineGet();
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/ceo\/setup$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleCEOSetupGet();
          }
          if (req.method === 'POST') {
            return handleCEOSetupPost(req);
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/departments$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleDepartmentsGet(req);
          }
          if (req.method === 'PUT') {
            return handleDepartmentsPut(req);
          }
          return methodNotAllowedResponse(['GET', 'PUT']);
        },
      },
      {
        pattern: /^\/api\/departments\/digest$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleDepartmentsDigestGet(req);
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/departments\/memory$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleDepartmentsMemoryGet(req);
          }
          if (req.method === 'POST') {
            return handleDepartmentsMemoryPost(req);
          }
          return methodNotAllowedResponse(['GET', 'POST']);
        },
      },
      {
        pattern: /^\/api\/departments\/quota$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleDepartmentsQuotaGet(req);
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/departments\/sync$/,
        handler: async (req) => {
          if (req.method === 'POST') {
            return handleDepartmentsSyncPost(req);
          }
          return methodNotAllowedResponse(['POST']);
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
      {
        pattern: /^\/api\/mcp$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleMcpConfigGet();
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/mcp\/servers$/,
        handler: async (req) => {
          if (req.method === 'POST') {
            return handleMcpServersPost(req);
          }
          if (req.method === 'DELETE') {
            return handleMcpServersDelete(req);
          }
          return methodNotAllowedResponse(['POST', 'DELETE']);
        },
      },
      {
        pattern: /^\/api\/mcp\/tools$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleMcpToolsGet();
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/workspaces$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleWorkspacesGet();
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/workspaces\/import$/,
        handler: async (req) => {
          if (req.method === 'POST') {
            return handleWorkspacesImportPost(req);
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/workspaces\/close$/,
        handler: async (req) => {
          if (req.method === 'GET') {
            return handleWorkspacesCloseGet();
          }
          if (req.method === 'POST') {
            return handleWorkspacesClosePost(req);
          }
          if (req.method === 'DELETE') {
            return handleWorkspacesCloseDelete(req);
          }
          return methodNotAllowedResponse(['GET', 'POST', 'DELETE']);
        },
      },
    ];
}

export function startControlPlaneServer(options: {
  port: number;
  hostname?: string;
}) {
  const server = startRouteServer({
    name: 'control-plane',
    port: options.port,
    hostname: options.hostname,
    routes: createControlPlaneRoutes(),
  });
  log.info({ port: options.port }, 'Control-plane server started');
  return server;
}
