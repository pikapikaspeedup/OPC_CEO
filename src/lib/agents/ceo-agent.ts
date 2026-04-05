/**
 * CEO Agent — Core Logic (Phase 6: LLM Decision Mode)
 *
 * Processes human CEO commands using LLM semantic understanding.
 * The LLM analyzes the command, department info, and template catalog
 * to determine the best dispatch decision.
 *
 * Preserved fast paths (no LLM):
 * - Empty input check
 * - Status queries (状态/进度/汇报)
 * - Intervention intents (取消/暂停/恢复/重试/跳过)
 */

import { createLogger } from '../logger';
import { buildCompanyContext, buildCEOSystemPrompt } from './ceo-prompts';
import { getDepartmentLoad, ceoCreateProject } from './ceo-tools';
import { executeDispatch } from './dispatch-service';
import { cancelRun, interveneRun } from './group-runtime';
import { listProjects, updateProject } from './project-registry';
import { listRuns } from './run-registry';
import { callLLMOneshot } from './llm-oneshot';
import { extractJsonFromResponse } from './pipeline-generator';
import type { DepartmentConfig, CEOEvent } from '../types';

const log = createLogger('CEOAgent');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CEOCommandResult {
  success: boolean;
  action: 'create_project' | 'report_to_human' | 'info' | 'cancel' | 'pause' | 'resume' | 'retry' | 'skip' | 'multi_create' | 'needs_decision';
  message: string;
  projectId?: string;
  projectIds?: string[];
  runId?: string;
  runIds?: string[];
  event?: CEOEvent;
  /** When action='needs_decision', provides options for the CEO to choose */
  suggestions?: CEOSuggestion[];
}

export interface CEOSuggestion {
  type: 'use_template' | 'create_template' | 'reassign_department' | 'auto_generate_and_dispatch' | 'suggest_add_template';
  label: string;
  description: string;
  /** Data to pass back when CEO selects this option */
  payload?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// LLM Decision types (expected from the LLM JSON output)
// ---------------------------------------------------------------------------

interface LLMDecisionDispatch {
  action: 'dispatch';
  workspace: string;
  templateId: string;
  projectName: string;
  goal: string;
  priority?: string;
  model?: string;
  reasoning: string;
}

interface LLMDecisionSuggestAdd {
  action: 'suggest_add_template';
  workspace: string;
  templateId: string;
  departmentName: string;
  projectName: string;
  goal: string;
  reasoning: string;
}

interface LLMDecisionCreate {
  action: 'create_template';
  workspace: string;
  departmentName: string;
  projectName: string;
  goal: string;
  templateGoal: string;
  reasoning: string;
}

interface LLMDecisionReport {
  action: 'report_to_human';
  reportTitle: string;
  reportDescription: string;
  reasoning: string;
}

interface LLMDecisionMulti {
  action: 'multi_dispatch';
  dispatches: Array<{ workspace: string; templateId: string }>;
  projectName: string;
  goal: string;
  reasoning: string;
}

type LLMDecision =
  | LLMDecisionDispatch
  | LLMDecisionSuggestAdd
  | LLMDecisionCreate
  | LLMDecisionReport
  | LLMDecisionMulti;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _eventId = 0;

// ---------------------------------------------------------------------------
// Intervention intent detection & handling (preserved from Phase 5)
// ---------------------------------------------------------------------------

/**
 * Find a project matching keywords in the command text.
 */
function findProjectByCommand(
  command: string,
  departments: Map<string, DepartmentConfig>,
): { projectId: string; name: string; workspace: string } | null {
  const allProjects = listProjects();

  // Remove intent keywords to isolate the project identifier
  const intentWords = ['取消', '停止', '终止', '暂停', '恢复', '继续', '重试', '再试', '重新执行', '重跑', '跳过', '忽略',
    'cancel', 'stop', 'abort', 'pause', 'suspend', 'resume', 'continue', 'retry', 'skip',
    '项目', '任务', '把', '将', '请', '给', '的', '了', '一下'];
  let searchText = command;
  for (const w of intentWords) {
    searchText = searchText.replace(new RegExp(w, 'gi'), '');
  }
  searchText = searchText.trim();

  // 1. Exact projectId match
  const byId = allProjects.find(p => command.includes(p.projectId.slice(0, 8)));
  if (byId) return { projectId: byId.projectId, name: byId.name, workspace: byId.workspace || '' };

  // 2. Name match (fuzzy)
  if (searchText.length >= 2) {
    const byName = allProjects.find(p =>
      command.includes(p.name) || p.name.includes(searchText),
    );
    if (byName) return { projectId: byName.projectId, name: byName.name, workspace: byName.workspace || '' };
  }

  // 3. Department match — find most recent active project in matched department
  for (const [uri, config] of departments) {
    const normalizedCmd = command.replace(/\s+/g, '');
    const normalizedName = config.name.replace(/\s+/g, '');
    if (normalizedCmd.includes(normalizedName)) {
      const deptProjects = allProjects
        .filter(p => p.workspace === uri && p.status === 'active')
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      if (deptProjects.length > 0) {
        return { projectId: deptProjects[0].projectId, name: deptProjects[0].name, workspace: deptProjects[0].workspace || '' };
      }
    }
  }

  // 4. Fall back to most recent active project (only if exactly one)
  const active = allProjects
    .filter(p => p.status === 'active')
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  if (active.length === 1) {
    return { projectId: active[0].projectId, name: active[0].name, workspace: active[0].workspace || '' };
  }

  return null;
}

/**
 * Handle intervention intents: cancel, pause, resume, retry, skip.
 */
async function handleInterventionIntent(
  command: string,
  intent: 'cancel' | 'pause' | 'resume' | 'retry' | 'skip',
  departments: Map<string, DepartmentConfig>,
): Promise<CEOCommandResult | null> {
  const target = findProjectByCommand(command, departments);
  if (!target) return null;

  const runs = listRuns({ projectId: target.projectId });
  const activeRun = runs.find(r => r.status === 'running' || r.status === 'queued');

  switch (intent) {
    case 'cancel': {
      if (activeRun) {
        try {
          await cancelRun(activeRun.runId);
          log.info({ projectId: target.projectId, runId: activeRun.runId }, 'CEO cancelled run');
        } catch (err: any) {
          log.warn({ err: err.message }, 'Failed to cancel run, cancelling project only');
        }
      }
      updateProject(target.projectId, { status: 'cancelled' });
      return {
        success: true,
        action: 'cancel',
        message: `已取消项目「${target.name}」${activeRun ? '及其执行中的 Run' : ''}`,
        projectId: target.projectId,
        runId: activeRun?.runId,
        event: {
          id: `ceo-evt-${++_eventId}`,
          type: 'info',
          title: '项目已取消',
          description: `${target.name}`,
          projectId: target.projectId,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'pause': {
      if (activeRun) {
        try { await cancelRun(activeRun.runId); } catch { /* best effort */ }
      }
      updateProject(target.projectId, { status: 'paused' });
      return {
        success: true,
        action: 'pause',
        message: `已暂停项目「${target.name}」`,
        projectId: target.projectId,
        event: {
          id: `ceo-evt-${++_eventId}`,
          type: 'info',
          title: '项目已暂停',
          description: `${target.name} — 暂停执行，可稍后恢复`,
          projectId: target.projectId,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'resume': {
      updateProject(target.projectId, { status: 'active' });
      return {
        success: true,
        action: 'resume',
        message: `已恢复项目「${target.name}」为活跃状态`,
        projectId: target.projectId,
        event: {
          id: `ceo-evt-${++_eventId}`,
          type: 'info',
          title: '项目已恢复',
          description: `${target.name}`,
          projectId: target.projectId,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'retry': {
      if (activeRun) {
        try {
          await interveneRun(activeRun.runId, 'retry');
          return {
            success: true,
            action: 'retry',
            message: `已对项目「${target.name}」的当前 Run 发起重试`,
            projectId: target.projectId,
            runId: activeRun.runId,
            event: {
              id: `ceo-evt-${++_eventId}`,
              type: 'info',
              title: '已重试',
              description: `${target.name} Run ${activeRun.runId.slice(0, 8)}`,
              projectId: target.projectId,
              timestamp: new Date().toISOString(),
            },
          };
        } catch (err: any) {
          return {
            success: false,
            action: 'retry',
            message: `重试失败：${err.message}`,
            projectId: target.projectId,
          };
        }
      }
      return {
        success: false,
        action: 'retry',
        message: `找到项目「${target.name}」但无法重试：没有可用的 Run`,
        projectId: target.projectId,
      };
    }

    case 'skip': {
      if (!activeRun) {
        return {
          success: false,
          action: 'skip',
          message: `项目「${target.name}」没有正在执行的 Run，无法跳过阶段`,
          projectId: target.projectId,
        };
      }
      try {
        await interveneRun(activeRun.runId, 'nudge', '跳过当前阶段并继续执行下一个');
        return {
          success: true,
          action: 'skip',
          message: `已指示项目「${target.name}」跳过当前阶段`,
          projectId: target.projectId,
          runId: activeRun.runId,
          event: {
            id: `ceo-evt-${++_eventId}`,
            type: 'info',
            title: '已跳过阶段',
            description: `${target.name}`,
            projectId: target.projectId,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (err: any) {
        return {
          success: false,
          action: 'skip',
          message: `跳过失败：${err.message}`,
          projectId: target.projectId,
        };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// LLM Decision Engine
// ---------------------------------------------------------------------------

/**
 * Call the LLM to decide what to do with the CEO's command.
 * Returns a structured LLMDecision or throws on failure.
 */
async function callCEOLLM(
  command: string,
  departments: Map<string, DepartmentConfig>,
  options?: { model?: string },
): Promise<LLMDecision> {
  const context = buildCompanyContext(departments);
  const systemPrompt = buildCEOSystemPrompt(context);
  const fullPrompt = `${systemPrompt}\n\n## 人类 CEO 指令\n${command}`;

  log.info({ commandLen: command.length, deptCount: context.departments.length, tplCount: context.allTemplates.length }, 'Calling LLM for CEO decision');

  const rawResponse = await callLLMOneshot(fullPrompt, options?.model);
  const parsed = extractJsonFromResponse(rawResponse) as any;

  if (!parsed.action) {
    throw new Error('LLM response missing required "action" field');
  }

  log.info({ action: parsed.action, reasoning: (parsed.reasoning || '').slice(0, 100) }, 'LLM CEO decision received');

  return parsed as LLMDecision;
}

// ---------------------------------------------------------------------------
// Decision processors
// ---------------------------------------------------------------------------

async function processDispatchDecision(
  command: string,
  decision: LLMDecisionDispatch,
  departments: Map<string, DepartmentConfig>,
  requestedModel?: string,
): Promise<CEOCommandResult> {
  // Validate workspace exists
  const dept = departments.get(decision.workspace);
  if (!dept) {
    return {
      success: false,
      action: 'report_to_human',
      message: `LLM 选择的工作区 ${decision.workspace} 不存在。可用部门：${[...departments.values()].map(d => d.name).join(', ')}`,
    };
  }

  // Check load
  const load = getDepartmentLoad(decision.workspace, departments);
  if (load?.load === 'high') {
    return {
      success: true,
      action: 'report_to_human',
      message: `${dept.name} 当前负载较高（${load.active} 个活跃任务），建议稍后派发。`,
      event: {
        id: `ceo-evt-${++_eventId}`,
        type: 'warning',
        title: `${dept.name} 负载过高`,
        description: `部门有 ${load.active} 个活跃项目，建议等待后再派发新任务`,
        workspaceUri: decision.workspace,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Create project
  const projectName = decision.projectName?.slice(0, 20) || '新任务';
  const model = requestedModel || decision.model;
  const result = ceoCreateProject({
    name: projectName,
    goal: decision.goal || decision.projectName,
    workspace: decision.workspace,
    projectType: 'adhoc',
    priority: (decision.priority as 'urgent' | 'high' | 'normal' | 'low') || 'normal',
  });

  log.info({ projectId: result.projectId, department: dept.name, templateId: decision.templateId }, 'CEO LLM created project');

  // Auto-dispatch
  let runId: string | undefined;
  try {
    const dispatchResult = await executeDispatch({
      templateId: decision.templateId,
      workspace: decision.workspace,
      prompt: decision.goal || decision.projectName,
      projectId: result.projectId,
      ...(model ? { model } : {}),
    });
    runId = dispatchResult.runId;
    log.info({ projectId: result.projectId, runId, templateId: decision.templateId }, 'CEO LLM auto-dispatched run');
  } catch (err: any) {
    log.warn({ projectId: result.projectId, err: err.message }, 'CEO LLM auto-dispatch failed');
  }

  const message = runId
    ? `已将任务「${projectName}」派发给 ${dept.name}（${decision.templateId}），执行已启动`
    : `已将任务「${projectName}」派发给 ${dept.name}，但执行未能启动`;

  // Persist CEO decision to project
  updateProject(result.projectId, {
    ceoDecision: {
      command,
      action: 'dispatch',
      reasoning: decision.reasoning,
      departmentName: dept.name,
      templateId: decision.templateId,
      message,
      resolved: true,
      decidedAt: new Date().toISOString(),
    },
  });

  return {
    success: true,
    action: 'create_project',
    message,
    projectId: result.projectId,
    runId,
    event: {
      id: `ceo-evt-${++_eventId}`,
      type: 'info',
      title: '新任务已派发',
      description: `${projectName} → ${dept.name} (${decision.templateId})${runId ? ` Run: ${runId}` : ''}`,
      projectId: result.projectId,
      workspaceUri: decision.workspace,
      timestamp: new Date().toISOString(),
    },
  };
}

function processSuggestAddDecision(
  command: string,
  decision: LLMDecisionSuggestAdd,
  departments: Map<string, DepartmentConfig>,
): CEOCommandResult {
  const dept = departments.get(decision.workspace);
  const deptName = dept?.name || decision.departmentName;

  // Create project first
  const projectName = decision.projectName?.slice(0, 20) || '新任务';
  const result = ceoCreateProject({
    name: projectName,
    goal: decision.goal || decision.projectName,
    workspace: decision.workspace,
    projectType: 'adhoc',
  });

  const suggestions: CEOSuggestion[] = [
    {
      type: 'suggest_add_template',
      label: `✨ 将模板「${decision.templateId}」添加到 ${deptName} 并执行`,
      description: `${decision.reasoning}`,
      payload: {
        workspace: decision.workspace,
        templateId: decision.templateId,
        projectId: result.projectId,
        goal: decision.goal,
      },
    },
    {
      type: 'auto_generate_and_dispatch',
      label: '🤖 AI 自动生成新模板并执行',
      description: `根据任务目标自动设计工作模板，生成后直接关联到 ${deptName} 并开始执行`,
      payload: { workspace: decision.workspace, departmentName: deptName, goal: decision.goal },
    },
  ];

  const message = `已创建项目「${projectName}」。${deptName} 没有关联模板「${decision.templateId}」，需要您确认是否添加：`;

  // Persist CEO decision to project (unresolved — waiting for user action)
  updateProject(result.projectId, {
    ceoDecision: {
      command,
      action: 'suggest_add_template',
      reasoning: decision.reasoning,
      departmentName: deptName,
      templateId: decision.templateId,
      message,
      suggestions,
      resolved: false,
      decidedAt: new Date().toISOString(),
    },
  });

  return {
    success: true,
    action: 'needs_decision',
    message,
    projectId: result.projectId,
    suggestions,
    event: {
      id: `ceo-evt-${++_eventId}`,
      type: 'warning',
      title: '需要 CEO 决策',
      description: `建议将模板 ${decision.templateId} 添加到 ${deptName}`,
      projectId: result.projectId,
      workspaceUri: decision.workspace,
      timestamp: new Date().toISOString(),
    },
  };
}

function processCreateTemplateDecision(
  command: string,
  decision: LLMDecisionCreate,
  departments: Map<string, DepartmentConfig>,
): CEOCommandResult {
  const dept = departments.get(decision.workspace);
  const deptName = dept?.name || decision.departmentName;

  // Create project first
  const projectName = decision.projectName?.slice(0, 20) || '新任务';
  const result = ceoCreateProject({
    name: projectName,
    goal: decision.goal || decision.projectName,
    workspace: decision.workspace,
    projectType: 'adhoc',
  });

  const suggestions: CEOSuggestion[] = [
    {
      type: 'auto_generate_and_dispatch',
      label: '✨ AI 自动生成模板并执行',
      description: `${decision.templateGoal || decision.reasoning}`,
      payload: { workspace: decision.workspace, departmentName: deptName, goal: decision.goal, projectId: result.projectId },
    },
    {
      type: 'create_template',
      label: '✏️ 手动创建新模板',
      description: '打开模板设计器，自定义工作模板',
      payload: { workspace: decision.workspace, departmentName: deptName },
    },
  ];

  const message = `已创建项目「${projectName}」。现有模板不适合此任务，需要创建新模板（需要您审批）：`;

  // Persist CEO decision to project (unresolved — waiting for user action)
  updateProject(result.projectId, {
    ceoDecision: {
      command,
      action: 'create_template',
      reasoning: decision.reasoning,
      departmentName: deptName,
      message,
      suggestions,
      resolved: false,
      decidedAt: new Date().toISOString(),
    },
  });

  return {
    success: true,
    action: 'needs_decision',
    message,
    projectId: result.projectId,
    suggestions,
    event: {
      id: `ceo-evt-${++_eventId}`,
      type: 'warning',
      title: '需要新建模板',
      description: `${decision.reasoning?.slice(0, 100) || '现有模板不适合此任务'}`,
      projectId: result.projectId,
      workspaceUri: decision.workspace,
      timestamp: new Date().toISOString(),
    },
  };
}

function processReportDecision(decision: LLMDecisionReport): CEOCommandResult {
  return {
    success: true,
    action: 'report_to_human',
    message: `${decision.reportTitle || '需要人工处理'}\n${decision.reportDescription || decision.reasoning}`,
    event: {
      id: `ceo-evt-${++_eventId}`,
      type: 'warning',
      title: decision.reportTitle || '无法自动处理',
      description: decision.reportDescription || decision.reasoning,
      timestamp: new Date().toISOString(),
    },
  };
}

async function processMultiDispatchDecision(
  command: string,
  decision: LLMDecisionMulti,
  departments: Map<string, DepartmentConfig>,
  requestedModel?: string,
): Promise<CEOCommandResult> {
  const projectIds: string[] = [];
  const runIds: string[] = [];
  const deptNames: string[] = [];

  for (const d of decision.dispatches) {
    const dept = departments.get(d.workspace);
    if (!dept) continue;

    const load = getDepartmentLoad(d.workspace, departments);
    if (load?.load === 'high') continue;

    const projectName = `${decision.projectName?.slice(0, 15) || '协作任务'} [${dept.name}]`;
    const result = ceoCreateProject({
      name: projectName,
      goal: decision.goal,
      workspace: d.workspace,
      projectType: 'coordinated',
    });
    projectIds.push(result.projectId);
    deptNames.push(dept.name);

    // Persist CEO decision per sub-project
    updateProject(result.projectId, {
      ceoDecision: {
        command,
        action: 'multi_dispatch',
        reasoning: decision.reasoning,
        departmentName: dept.name,
        templateId: d.templateId,
        message: `跨部门协作（${dept.name}）`,
        resolved: true,
        decidedAt: new Date().toISOString(),
      },
    });

    try {
      const dr = await executeDispatch({
        templateId: d.templateId,
        workspace: d.workspace,
        prompt: decision.goal,
        projectId: result.projectId,
        ...(requestedModel ? { model: requestedModel } : {}),
      });
      runIds.push(dr.runId);
    } catch { /* best effort */ }
  }

  if (projectIds.length === 0) {
    return {
      success: false,
      action: 'report_to_human',
      message: '跨部门协作派发失败：没有可用的部门或所有部门负载过高',
    };
  }

  return {
    success: true,
    action: 'multi_create',
    message: `已跨部门协作派发：${deptNames.join(' + ')}（${projectIds.length} 个项目，${runIds.length} 个已启动执行）`,
    projectIds,
    runIds: runIds.length > 0 ? runIds : undefined,
    event: {
      id: `ceo-evt-${++_eventId}`,
      type: 'info',
      title: '跨部门协作任务已派发',
      description: `${decision.projectName} → ${deptNames.join(' + ')}`,
      projectId: projectIds[0],
      timestamp: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Process a CEO command using LLM semantic understanding.
 * Fast paths (status, interventions) use rule detection.
 * Task dispatch decisions use LLM.
 */
export async function processCEOCommand(
  command: string,
  departments: Map<string, DepartmentConfig>,
  options?: { model?: string },
): Promise<CEOCommandResult> {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      success: false,
      action: 'info',
      message: '请输入指令',
    };
  }

  // ── Fast path: Status queries ──
  const statusKeywords = ['状态', '怎么样', '进度', '情况', '汇报'];
  if (statusKeywords.some(kw => trimmed.includes(kw))) {
    const context = buildCompanyContext(departments);
    const activeDepts = context.departments.filter(d => d.activeProjects > 0);
    const summary = activeDepts.length > 0
      ? activeDepts.map(d => `${d.name}: ${d.activeProjects} 活跃 / ${d.completedProjects} 完成`).join('；')
      : '当前无活跃任务';

    return {
      success: true,
      action: 'info',
      message: `公司状态：${context.totalProjects} 个项目，${context.activeProjects} 个活跃。${summary}`,
    };
  }

  // ── Fast path: Intervention intents ──
  const cancelKeywords = ['取消', '停止', '终止', 'cancel', 'stop', 'abort'];
  const pauseKeywords = ['暂停', '挂起', 'pause', 'suspend'];
  const resumeKeywords = ['恢复', '继续', 'resume', 'continue'];
  const retryKeywords = ['重试', '再试', 'retry', '重新执行', '重跑'];
  const skipKeywords = ['跳过', 'skip', '忽略'];

  type IntentType = 'cancel' | 'pause' | 'resume' | 'retry' | 'skip';
  let detectedIntent: IntentType | null = null;

  if (cancelKeywords.some(kw => trimmed.includes(kw))) detectedIntent = 'cancel';
  else if (pauseKeywords.some(kw => trimmed.includes(kw))) detectedIntent = 'pause';
  else if (resumeKeywords.some(kw => trimmed.includes(kw))) detectedIntent = 'resume';
  else if (retryKeywords.some(kw => trimmed.includes(kw))) detectedIntent = 'retry';
  else if (skipKeywords.some(kw => trimmed.includes(kw))) detectedIntent = 'skip';

  if (detectedIntent) {
    const result = await handleInterventionIntent(trimmed, detectedIntent, departments);
    if (result) return result;
    // If no project/run matched, fall through to LLM decision
  }

  // ── LLM Decision Path ──
  try {
    const decision = await callCEOLLM(trimmed, departments, options);

    switch (decision.action) {
      case 'dispatch':
        return await processDispatchDecision(trimmed, decision, departments, options?.model);

      case 'suggest_add_template':
        return processSuggestAddDecision(trimmed, decision, departments);

      case 'create_template':
        return processCreateTemplateDecision(trimmed, decision, departments);

      case 'report_to_human':
        return processReportDecision(decision);

      case 'multi_dispatch':
        return await processMultiDispatchDecision(trimmed, decision, departments, options?.model);

      default:
        log.warn({ action: (decision as any).action }, 'Unknown LLM decision action');
        return {
          success: false,
          action: 'report_to_human',
          message: `AI CEO 返回了未知的决策类型：${(decision as any).action}`,
        };
    }
  } catch (err: any) {
    log.error({ err: err.message }, 'LLM CEO decision failed');
    return {
      success: false,
      action: 'report_to_human',
      message: `AI CEO 决策失败：${err.message}。请检查 Language Server 连接状态，或手动创建任务。`,
      event: {
        id: `ceo-evt-${++_eventId}`,
        type: 'critical',
        title: 'AI CEO 决策失败',
        description: err.message,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Get the system prompt for LLM-based CEO agent.
 */
export function getCEOSystemPrompt(departments: Map<string, DepartmentConfig>): string {
  const context = buildCompanyContext(departments);
  return buildCEOSystemPrompt(context);
}
