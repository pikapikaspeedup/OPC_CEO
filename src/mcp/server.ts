#!/usr/bin/env node

/**
 * Antigravity MCP Server
 * Exposes internal agent registries and dispatch capabilities to external LLMs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fileURLToPath } from "url";
import path from "path";
import type { InterventionAction } from "../lib/agents/group-runtime.js";

// 1. MCP stdio requires stdout to be EXCLUSIVELY JSON-RPC.
//    Redirect all pino-pretty output to stderr by setting this env var
//    BEFORE any module imports trigger logger initialization.
process.env.ANTIGRAVITY_MCP = '1';

// 2. Calculate project root and enforce it BEFORE any local imports
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
process.chdir(projectRoot);

const server = new McpServer({
  name: "antigravity-mcp-server",
  version: "1.0.0"
});

async function main() {
// 2. Dynamically import everything else so that `process.cwd()` is correctly set first
const { listProjects, getProject } = await import("../lib/agents/project-registry.js");
const { getRun } = await import("../lib/agents/run-registry.js");
const { interveneRun, cancelRun } = await import("../lib/agents/group-runtime.js");



// Tool: antigravity_list_projects
server.registerTool(
  "antigravity_list_projects",
  {
    title: "List Projects",
    description: "List all active and completed projects with their high-level pipeline status.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum results to return"),
      offset: z.number().int().min(0).default(0).describe("Number of results to skip")
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async ({ limit, offset }) => {
    try {
      const projects = listProjects();
      const paginated = projects.slice(offset, offset + limit);
      
      const output = {
        total: projects.length,
        count: paginated.length,
        offset,
        projects: paginated.map((p: any) => ({
          projectId: p.projectId,
          name: p.name,
          status: p.status,
          pipelineState: p.pipelineState ? {
             status: p.pipelineState.status,
             activeStageIds: p.pipelineState.activeStageIds,
             templateId: p.pipelineState.templateId
          } : null,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        }))
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// Tool: antigravity_get_project
server.registerTool(
  "antigravity_get_project",
  {
    title: "Get Project Details",
    description: "Get detailed status of a specific project, including its pipeline stages and corresponding runs.",
    inputSchema: z.object({
      projectId: z.string().describe("The ID of the project to retrieve")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ projectId }) => {
    try {
      const project = getProject(projectId);
      if (!project) {
        return { content: [{ type: "text", text: `Error: Project not found: ${projectId}` }] };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
        structuredContent: project as any
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// Tool: antigravity_get_run
server.registerTool(
  "antigravity_get_run",
  {
    title: "Get Agent Run Details",
    description: "Get the detailed status of an agent run (roles, review decisions, supervisor logs).",
    inputSchema: z.object({
      runId: z.string().describe("The ID of the run to retrieve")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ runId }) => {
    try {
      const run = getRun(runId);
      if (!run) {
        return { content: [{ type: "text", text: `Error: Run not found: ${runId}` }] };
      }
      
      // We can return the full JSON, but let's provide a summary in text too
      let textContent = `Status: ${run.status}  Round: ${run.currentRound || "?"}  Group: ${run.groupId}\n`;
      if (run.lastError) textContent += `Error: ${run.lastError}\n`;
      const roles = run.roles || [];
      textContent += `Total role entries: ${roles.length}\n`;
      roles.forEach((r: any, i: number) => {
        textContent += `  [${i}] ${r.roleId.padEnd(30)} R${r.round || "?"} ${r.status} decision=${r.reviewDecision || "-"}\n`;
      });
      const sups = run.supervisorReviews || [];
      if (sups.length > 0) {
         const latest = sups[sups.length - 1];
         textContent += `Latest supervisor: ${latest.decision?.status || "?"} — ${(latest.decision?.analysis || "").slice(0, 120)}\n`;
      }
      
      textContent += `\nFull JSON:\n${JSON.stringify(run, null, 2)}`;

      return {
        content: [{ type: "text", text: textContent }],
        structuredContent: run as any
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// Tool: antigravity_intervene_run
server.registerTool(
  "antigravity_intervene_run",
  {
    title: "Intervene on Run",
    description: "Perform an intervention (retry, restart_role, nudge, cancel) on a stuck or failed run.",
    inputSchema: z.object({
      runId: z.string().describe("The ID of the run to intervene on"),
      action: z.enum(["retry", "restart_role", "nudge", "cancel"]).describe("The intervention action to take"),
      prompt: z.string().optional().describe("Optional prompt/message for the intervention (e.g. feedback for retry)"),
      roleId: z.string().optional().describe("Optional specific roleId to target")
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  },
  async ({ runId, action, prompt, roleId }) => {
    try {
      const result = action === "cancel"
        ? (await cancelRun(runId), { status: "cancelled", action })
        : await interveneRun(runId, action as InterventionAction, prompt, roleId);
      return {
        content: [{ type: "text", text: `Intervention SUCCESS: \n${JSON.stringify(result, null, 2)}` }],
        structuredContent: result
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// Tool: antigravity_dispatch_pipeline
server.registerTool(
  "antigravity_dispatch_pipeline",
  {
    title: "Dispatch Pipeline or Group",
    description: "Start a new agent run using a pipeline template or single group ID.",
    inputSchema: z.object({
      workspace: z.string().describe("Workspace URI (e.g. file:///path/to/project)"),
      prompt: z.string().describe("Goal or prompt for the pipeline/run"),
      projectId: z.string().optional().describe("Optional projectId to attach this run to"),
      templateId: z.string().optional().describe("Template ID (e.g. development-template-1). If provided, it starts a pipeline."),
      groupId: z.string().optional().describe("Group ID (e.g. product-spec). Use this for single-group runs instead of full pipelines."),
      sourceRunIds: z.array(z.string()).optional().describe("For groups that require upstream artifacts")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async ({ workspace, prompt, projectId, templateId, groupId, sourceRunIds }) => {
    try {
      // Forward everything to the Next.js API — let the server handle
      // all template resolution, stage inference, and group lookup.
      // Do NOT pre-resolve here; that would bypass server-side auto-inference
      // for non-first-stage dispatches (e.g. templateId + sourceRunIds).
      if (!groupId && !templateId) {
        throw new Error("Missing required parameter: must provide either groupId or templateId");
      }
      
      // Forward to the Next.js local API to decouple execution from MCP process
      const res = await fetch('http://127.0.0.1:3000/api/agent-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          workspace,
          prompt,
          projectId,
          templateId,
          sourceRunIds,
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`API Dispatch Failed (${res.status}): ${errorText}`);
      }

      const result = await res.json();
      
      return {
        content: [{ type: "text", text: `Dispatch SUCCESS. Run ID: ${result.runId}` }],
        structuredContent: result
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// ---------------------------------------------------------------------------
// V4.3 Operations & Observability Tools
// ---------------------------------------------------------------------------

const { analyzeProject, buildProjectGraph } = await import("../lib/agents/project-diagnostics.js");
const { reconcileProject } = await import("../lib/agents/project-reconciler.js");
const { listScheduledJobsEnriched } = await import("../lib/agents/scheduler.js");

// Tool: antigravity_get_project_diagnostics
server.registerTool(
  "antigravity_get_project_diagnostics",
  {
    title: "Get Project Diagnostics",
    description: "Return the project health summary, active stages, waiting/stale/blocked reasons, and branch anomaly diagnostics.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID to diagnose"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ projectId }) => {
    try {
      const diagnostics = analyzeProject(projectId);
      if (!diagnostics) {
        return { content: [{ type: "text", text: `Project ${projectId} not found.` }] };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(diagnostics, null, 2) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_list_scheduler_jobs
server.registerTool(
  "antigravity_list_scheduler_jobs",
  {
    title: "List Scheduler Jobs",
    description: "Return the list of scheduled jobs with their enabled status, next run time, and last run result.",
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const jobs = listScheduledJobsEnriched();
      return {
        content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_reconcile_project
server.registerTool(
  "antigravity_reconcile_project",
  {
    title: "Reconcile Project",
    description: "Run idempotent reconciliation on a project to fix inconsistent pipeline state. DESTRUCTIVE when dryRun is false. Defaults to dryRun: true.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID to reconcile"),
      dryRun: z.boolean().default(true).describe("If true, only report what would be done without making changes"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ projectId, dryRun }) => {
    try {
      const result = await reconcileProject(projectId, { dryRun });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_lint_template (V4.4)
server.registerTool(
  "antigravity_lint_template",
  {
    title: "Lint Template Contracts",
    description: "Validate a template's DAG structure and typed contracts. Returns errors and warnings without modifying any state.",
    inputSchema: z.object({
      templateId: z.string().describe("The template ID to lint"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ templateId }) => {
    try {
      const { AssetLoader } = await import("../lib/agents/asset-loader.js");
      const { validateTemplatePipeline } = await import("../lib/agents/pipeline-graph.js");
      const { validateTemplateContracts } = await import("../lib/agents/contract-validator.js");

      const template = AssetLoader.getTemplate(templateId);
      if (!template) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `Template '${templateId}' not found` }) }] };
      }

      const dagErrors = validateTemplatePipeline(template);
      const contractResult = validateTemplateContracts(template);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            templateId,
            valid: dagErrors.length === 0 && contractResult.valid,
            dagErrors,
            contractErrors: contractResult.errors,
            contractWarnings: contractResult.warnings,
          }, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_validate_template (V5.1)
server.registerTool(
  "antigravity_validate_template",
  {
    title: "Validate Template",
    description: "Validate any template format (pipeline[] or graphPipeline). Auto-detects the format, checks DAG structure and typed contracts. Returns format, errors, and warnings.",
    inputSchema: z.object({
      templateId: z.string().optional().describe("The template ID to validate (loads from disk)"),
      template: z.any().optional().describe("Inline template object to validate"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ templateId, template: inlineTemplate }) => {
    try {
      const { AssetLoader } = await import("../lib/agents/asset-loader.js");
      const { validateTemplatePipeline } = await import("../lib/agents/pipeline-graph.js");
      const { validateTemplateContracts } = await import("../lib/agents/contract-validator.js");
      const { validateGraphPipeline } = await import("../lib/agents/graph-compiler.js");

      let template = inlineTemplate;
      if (!template && templateId) {
        template = AssetLoader.getTemplate(templateId);
        if (!template) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Template '${templateId}' not found` }) }] };
        }
      }
      if (!template) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Either templateId or template must be provided" }) }] };
      }

      const format = template.graphPipeline ? 'graphPipeline' : 'pipeline';
      const dagErrors = template.graphPipeline
        ? validateGraphPipeline(template.graphPipeline)
        : validateTemplatePipeline(template);
      const contractResult = validateTemplateContracts(template);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            format,
            valid: dagErrors.length === 0 && contractResult.valid,
            dagErrors,
            contractErrors: contractResult.errors,
            contractWarnings: contractResult.warnings,
          }, null, 2),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_convert_template (V5.1)
server.registerTool(
  "antigravity_convert_template",
  {
    title: "Convert Template Format",
    description: "Convert between pipeline[] and graphPipeline formats. Supports 'pipeline-to-graph' and 'graph-to-pipeline' directions.",
    inputSchema: z.object({
      direction: z.enum(["pipeline-to-graph", "graph-to-pipeline"]).describe("Conversion direction"),
      pipeline: z.array(z.any()).optional().describe("Pipeline stages (for pipeline-to-graph)"),
      graphPipeline: z.any().optional().describe("Graph pipeline (for graph-to-pipeline)"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ direction, pipeline, graphPipeline }) => {
    try {
      const { pipelineToGraphPipeline, graphPipelineToPipeline } = await import("../lib/agents/graph-pipeline-converter.js");

      if (direction === 'pipeline-to-graph') {
        if (!pipeline) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "pipeline[] is required" }) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ graphPipeline: pipelineToGraphPipeline(pipeline) }, null, 2) }] };
      }

      if (direction === 'graph-to-pipeline') {
        if (!graphPipeline) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "graphPipeline is required" }) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ pipeline: graphPipelineToPipeline(graphPipeline) }, null, 2) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown direction: '${direction}'` }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_gate_approve (V5.2)
server.registerTool(
  "antigravity_gate_approve",
  {
    title: "Approve/Reject Gate Node",
    description: "Approve or reject a gate node in a project pipeline. Gate nodes block pipeline progression until an explicit approval decision is made.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID"),
      nodeId: z.string().describe("Gate node ID"),
      decision: z.enum(["approved", "rejected"]).describe("Gate decision"),
      reason: z.string().optional().describe("Reason for the decision"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ projectId, nodeId, decision, reason }) => {
    try {
      const { getProject, updateProject } = await import("../lib/agents/project-registry.js");
      const { appendAuditEvent } = await import("../lib/agents/ops-audit.js");
      const { appendJournalEntry } = await import("../lib/agents/execution-journal.js");

      const project = getProject(projectId);
      if (!project || !project.pipelineState) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Project not found or no pipeline state" }) }] };
      }

      const stages = project.pipelineState.stages.map(s => {
        if (s.stageId !== nodeId) return s;
        return {
          ...s,
          gateApproval: {
            status: decision,
            reason: reason ?? undefined,
            decidedAt: new Date().toISOString(),
          },
        };
      });

      updateProject(projectId, {
        pipelineState: { ...project.pipelineState, stages },
        updatedAt: new Date().toISOString(),
      });

      appendAuditEvent({
        kind: decision === 'approved' ? 'gate:approved' : 'gate:rejected',
        projectId,
        stageId: nodeId,
        message: `Gate ${nodeId} ${decision}${reason ? `: ${reason}` : ''}`,
        meta: { decision, reason },
      });

      appendJournalEntry({
        projectId,
        nodeId,
        nodeKind: 'stage',
        eventType: 'gate:decided',
        details: { decision, reason },
      });

      return { content: [{ type: "text", text: JSON.stringify({ success: true, nodeId, decision }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_list_checkpoints (V5.2)
server.registerTool(
  "antigravity_list_checkpoints",
  {
    title: "List Checkpoints",
    description: "List all pipeline checkpoints for a project. Checkpoints capture pipeline state snapshots that can be used for replay/resume.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ projectId }) => {
    try {
      const { listCheckpoints } = await import("../lib/agents/checkpoint-manager.js");
      const checkpoints = listCheckpoints(projectId);
      return { content: [{ type: "text", text: JSON.stringify({ checkpoints }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_replay (V5.2)
server.registerTool(
  "antigravity_replay",
  {
    title: "Replay from Checkpoint",
    description: "Restore a project pipeline to a previous checkpoint state. If no checkpointId is specified, uses the most recent checkpoint.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID"),
      checkpointId: z.string().optional().describe("Checkpoint ID (latest if omitted)"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ projectId, checkpointId }) => {
    try {
      const { listCheckpoints, restoreFromCheckpoint } = await import("../lib/agents/checkpoint-manager.js");
      const { getProject, updateProject } = await import("../lib/agents/project-registry.js");
      const { appendAuditEvent } = await import("../lib/agents/ops-audit.js");

      const project = getProject(projectId);
      if (!project || !project.pipelineState) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Project not found or no pipeline state" }) }] };
      }

      let targetId = checkpointId;
      if (!targetId) {
        const all = listCheckpoints(projectId);
        if (all.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "No checkpoints available" }) }] };
        }
        targetId = all[all.length - 1].id;
      }

      const restored = restoreFromCheckpoint(projectId, targetId);

      updateProject(projectId, {
        pipelineState: {
          ...project.pipelineState,
          stages: restored.state.stages,
          activeStageIds: restored.state.activeStageIds,
          loopCounters: restored.loopCounters,
          lastCheckpointId: targetId,
          status: 'running',
        },
        status: 'active',
        updatedAt: new Date().toISOString(),
      });

      appendAuditEvent({
        kind: 'checkpoint:restored',
        projectId,
        message: `Replay from checkpoint ${targetId}`,
        meta: { checkpointId: targetId },
      });

      return { content: [{ type: "text", text: JSON.stringify({ replayed: true, checkpointId: targetId, restoredStageCount: restored.state.stages.length }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_query_journal (V5.2)
server.registerTool(
  "antigravity_query_journal",
  {
    title: "Query Execution Journal",
    description: "Query the execution journal for a project. Returns control-flow decisions, gate approvals, loop iterations, and switch evaluations.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID"),
      nodeId: z.string().optional().describe("Filter by node ID"),
      type: z.string().optional().describe("Filter by event type (e.g. gate:decided, loop:iteration, switch:routed)"),
      limit: z.number().int().min(1).max(1000).default(50).describe("Maximum entries to return"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ projectId, nodeId, type, limit }) => {
    try {
      const { queryJournal, getNodeJournal } = await import("../lib/agents/execution-journal.js");

      let entries;
      if (nodeId) {
        entries = getNodeJournal(projectId, nodeId);
      } else {
        entries = queryJournal(projectId, {
          ...(type ? { eventType: type as any } : {}),
        });
      }

      const sliced = entries.slice(-limit);
      return { content: [{ type: "text", text: JSON.stringify({ entries: sliced, total: entries.length }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_generate_pipeline (V5.3)
server.registerTool(
  "antigravity_generate_pipeline",
  {
    title: "Generate Pipeline (AI)",
    description: "Generate a graphPipeline draft using AI based on user goals and constraints. Returns a draft that MUST be confirmed before saving. The draft includes validation results and risk assessment.",
    inputSchema: z.object({
      goal: z.string().max(5000).describe("Project goal description (natural language)"),
      constraints: z.object({
        maxStages: z.number().int().min(1).max(50).optional().describe("Maximum stage count"),
        allowFanOut: z.boolean().optional().describe("Allow fan-out nodes"),
        allowLoop: z.boolean().optional().describe("Allow loop nodes"),
        allowGate: z.boolean().optional().describe("Allow gate nodes"),
        techStack: z.string().optional().describe("Technology stack hint"),
        teamSize: z.string().optional().describe("Team size hint"),
      }).optional(),
      referenceTemplateId: z.string().optional().describe("Reference template ID for inspiration"),
      model: z.string().optional().describe("LLM model to use"),
    }),
    annotations: {
      readOnlyHint: true, // Generation alone doesn't write files
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ goal, constraints, referenceTemplateId, model }) => {
    try {
      const { generatePipeline } = await import("../lib/agents/pipeline-generator.js");
      const { AssetLoader } = await import("../lib/agents/asset-loader.js");
      const { appendAuditEvent } = await import("../lib/agents/ops-audit.js");
      const { callLLMOneshot } = await import("../lib/agents/llm-oneshot.js");

      const allTemplates = AssetLoader.loadAllTemplates();

      const result = await generatePipeline(
        { goal, constraints, referenceTemplateId, model },
        allTemplates,
        callLLMOneshot,
      );

      appendAuditEvent({
        kind: 'template:ai-generated',
        message: `AI pipeline draft generated via MCP: ${result.templateMeta.title}`,
        meta: { draftId: result.draftId, goal: goal.slice(0, 200), model },
      });

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Tool: antigravity_confirm_pipeline_draft (V5.3)
server.registerTool(
  "antigravity_confirm_pipeline_draft",
  {
    title: "Confirm Pipeline Draft",
    description: "Confirm an AI-generated pipeline draft and prepare it for saving as a template. The draft must have been previously generated via antigravity_generate_pipeline. This is a destructive action — it writes the template to the template directory.",
    inputSchema: z.object({
      draftId: z.string().describe("Draft ID from generate result"),
      title: z.string().optional().describe("Override template title"),
      description: z.string().optional().describe("Override template description"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true, // Writes template file
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ draftId, title, description }) => {
    try {
      const { confirmDraft } = await import("../lib/agents/pipeline-generator.js");
      const { appendAuditEvent } = await import("../lib/agents/ops-audit.js");

      const modifications = (title || description)
        ? { templateMeta: { ...(title ? { title } : {}), ...(description ? { description } : {}) } }
        : undefined;

      const result = await confirmDraft(draftId, modifications);

      if (!result.saved) {
        appendAuditEvent({
          kind: 'template:ai-rejected',
          message: `AI draft rejected via MCP: ${result.validationErrors?.join('; ') ?? 'unknown'}`,
          meta: { draftId },
        });
      } else {
        appendAuditEvent({
          kind: 'template:ai-confirmed',
          message: `AI draft confirmed via MCP: ${result.templateId}`,
          meta: { draftId, templateId: result.templateId },
        });
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// ── V5.4 Platformization MCP Tools ──────────────────────────────────────────

// List available subgraphs
server.tool(
  "antigravity_list_subgraphs",
  "List all available reusable subgraph definitions",
  {},
  async () => {
    try {
      const { AssetLoader } = await import("../lib/agents/asset-loader.js");
      const subgraphs = AssetLoader.loadAllSubgraphs();
      return { content: [{ type: "text", text: JSON.stringify(subgraphs, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// List resource policies
server.tool(
  "antigravity_list_policies",
  "List resource policies. Optionally filter by scope or targetId.",
  {
    scope: z.enum(["workspace", "template", "project"]).optional().describe("Filter by policy scope"),
    targetId: z.string().optional().describe("Filter by target ID"),
  },
  async ({ scope, targetId }) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const { GATEWAY_HOME } = await import("../lib/agents/gateway-home.js");
      const policiesFile = path.join(GATEWAY_HOME, "policies", "resource-policies.json");

      let policies: any[] = [];
      if (fs.existsSync(policiesFile)) {
        policies = JSON.parse(fs.readFileSync(policiesFile, "utf-8"));
      }

      if (scope) policies = policies.filter((p: any) => p.scope === scope);
      if (targetId) policies = policies.filter((p: any) => p.targetId === targetId);

      return { content: [{ type: "text", text: JSON.stringify(policies, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

// Check resource policy violations
server.tool(
  "antigravity_check_policy",
  "Evaluate resource policies against current usage counters to check if dispatch is allowed",
  {
    workspaceUri: z.string().optional().describe("Workspace URI for workspace-scoped policies"),
    templateId: z.string().optional().describe("Template ID for template-scoped policies"),
    projectId: z.string().optional().describe("Project ID for project-scoped policies"),
    runs: z.number().default(0).describe("Total runs dispatched"),
    branches: z.number().default(0).describe("Total fan-out branches"),
    iterations: z.number().default(0).describe("Total loop iterations"),
    stages: z.number().default(0).describe("Total stages completed"),
    concurrentRuns: z.number().default(0).describe("Currently running runs"),
  },
  async ({ workspaceUri, templateId, projectId, runs, branches, iterations, stages, concurrentRuns }) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const { GATEWAY_HOME } = await import("../lib/agents/gateway-home.js");
      const { evaluatePolicies, findApplicablePolicies } = await import("../lib/agents/resource-policy-engine.js");

      const policiesFile = path.join(GATEWAY_HOME, "policies", "resource-policies.json");
      let allPolicies: any[] = [];
      if (fs.existsSync(policiesFile)) {
        allPolicies = JSON.parse(fs.readFileSync(policiesFile, "utf-8"));
      }

      const context = { workspaceUri, templateId, projectId };
      const usage = { runs, branches, iterations, stages, concurrentRuns };
      const applicable = findApplicablePolicies(allPolicies, context);
      const result = evaluatePolicies(applicable, usage);

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Antigravity MCP Server running via stdio");
}

main().catch(console.error);
