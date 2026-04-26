import * as fs from 'fs';
import * as path from 'path';

import { AssetLoader } from './asset-loader';
import { getCEOWorkspacePath } from './ceo-environment';
import { executeDispatch } from './dispatch-service';
import { executePrompt } from './prompt-executor';
import { callLLMOneshot } from './llm-oneshot';
import { createProject } from './project-registry';
import { createScheduledJob, getNextRunAt, listScheduledJobs } from './scheduler';
import type { DepartmentConfig } from '../types';
import { createLogger } from '../logger';
import { listProjects } from './project-registry';
import { appendCEODecision, updateCEOActiveFocus } from '../organization';
import type { BudgetLedgerEntry } from '../company-kernel/contracts';
import {
  attachRunToBudgetReservation,
  releaseBudgetForRun,
  reserveBudgetForOperation,
} from '../company-kernel/budget-gate';

const log = createLogger('CEO-Agent');

interface CEOSuggestion {
  type: 'schedule_template' | 'clarify_department' | 'clarify_project' | 'clarify_template';
  label: string;
  description: string;
  payload?: Record<string, string>;
}

interface CEOCommandResult {
  success: boolean;
  action:
    | 'create_project'
    | 'create_scheduler_job'
    | 'dispatch_prompt'
    | 'report_to_human'
    | 'info'
    | 'needs_decision';
  message: string;
  projectId?: string;
  jobId?: string;
  runId?: string;
  nextRunAt?: string | null;
  suggestions?: CEOSuggestion[];
}

type DepartmentEntry = {
  workspaceUri: string;
  config: DepartmentConfig;
  aliases: string[];
};

type ScheduleSpec =
  | {
      type: 'cron';
      cronExpression: string;
      label: string;
    }
  | {
      type: 'interval';
      intervalMs: number;
      label: string;
    }
  | {
      type: 'once';
      scheduledAt: string;
      label: string;
    };

type SchedulerActionDraft =
  | {
      kind: 'create-project';
      label: string;
      departmentWorkspaceUri: string;
      goal: string;
      skillHint?: string;
      templateId?: string;
      suggestions?: CEOSuggestion[];
    }
  | {
      kind: 'health-check';
      label: string;
      projectId: string;
    }
  | {
      kind: 'dispatch-pipeline';
      label: string;
      workspace: string;
      prompt: string;
      templateId: string;
      stageId?: string;
      projectId?: string;
    }
  | {
      kind: 'dispatch-prompt';
      label: string;
      workspace: string;
      prompt: string;
      promptAssetRefs?: string[];
      skillHints?: string[];
    };

const STATUS_KEYWORDS = ['状态', '进度', '汇报', '怎么样', '情况'];
const SCHEDULE_KEYWORDS = ['定时', 'cron', '每天', '每日', '每周', '每月', '每隔', '工作日', '自动', '明天', '今晚', '明早'];

const CREATE_PROJECT_OPT_OUT_KEYWORDS = ['只创建项目', '先创建项目', '只建项目', '不要执行', '不要派发', '不自动运行', '不要run'];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').trim();
}

function formatIntervalLabel(intervalMs: number): string {
  if (intervalMs % 86_400_000 === 0) {
    return `每隔${intervalMs / 86_400_000}天`;
  }
  if (intervalMs % 3_600_000 === 0) {
    return `每隔${intervalMs / 3_600_000}小时`;
  }
  if (intervalMs % 60_000 === 0) {
    return `每隔${intervalMs / 60_000}分钟`;
  }
  if (intervalMs % 1_000 === 0) {
    return `每隔${intervalMs / 1_000}秒`;
  }
  return `每隔${intervalMs}毫秒`;
}

function deriveDepartmentEntries(departments: Map<string, DepartmentConfig>): DepartmentEntry[] {
  return Array.from(departments.entries()).map(([workspaceUri, config]) => {
    const basename = workspaceUri.replace(/^file:\/\//, '').split('/').filter(Boolean).pop() || workspaceUri;
    const aliases = [config.name, basename, config.type, config.description || '']
      .filter(Boolean)
      .map(normalizeText);
    return { workspaceUri, config, aliases };
  });
}

function matchProject(command: string) {
  const normalized = normalizeText(command);
  const projects = listProjects();
  const matches = projects.filter((project) => {
    const projectName = normalizeText(project.name);
    return normalized.includes(project.projectId.toLowerCase()) || (projectName && normalized.includes(projectName));
  });
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function matchTemplate(command: string) {
  const normalized = normalizeText(command);
  const templates = AssetLoader.loadAllTemplates();
  const matches = templates.filter((template) => {
    const title = normalizeText(template.title || '');
    return normalized.includes(template.id.toLowerCase()) || (title && normalized.includes(title));
  });
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function getTemplateLabel(templateId: string): string {
  const template = AssetLoader.getTemplate(templateId);
  return template?.title || templateId;
}

function buildImmediateProjectName(department: DepartmentEntry, goal: string): string {
  const cleanedGoal = goal
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  return cleanedGoal
    ? `${department.config.name} · ${cleanedGoal}`
    : `${department.config.name} · 即时任务`;
}

function reserveCEOManualBudget(input: {
  workspace: string;
  goal: string;
  kind: 'prompt' | 'template';
}): BudgetLedgerEntry {
  const budget = reserveBudgetForOperation({
    scope: 'department',
    scopeId: input.workspace,
    estimatedCost: {
      tokens: Math.max(500, Math.ceil(input.goal.length / 2) + 1_000),
      minutes: input.kind === 'template' ? 10 : 5,
    },
    dispatches: 0,
    operationKind: `ceo.manual.${input.kind}`,
    reason: `CEO manual ${input.kind} dispatch`,
  });
  if (!budget.decision.allowed) {
    throw new Error(budget.decision.reasons.join('; ') || 'CEO dispatch blocked by budget gate');
  }
  return budget.ledger;
}

function releaseCEOManualBudget(ledger: BudgetLedgerEntry | null, reason: string): void {
  if (!ledger || ledger.decision !== 'reserved') return;
  releaseBudgetForRun({
    policyId: ledger.policyId,
    scope: ledger.scope,
    scopeId: ledger.scopeId,
    reason,
  });
}

async function executeImmediateDepartmentTask(input: {
  department: DepartmentEntry;
  originalCommand: string;
  goal: string;
  skillHint?: string;
  templateId?: string;
}): Promise<CEOCommandResult> {
  const { department, originalCommand, goal, skillHint } = input;
  const templateId = input.templateId;
  const shouldExecute = !CREATE_PROJECT_OPT_OUT_KEYWORDS.some((keyword) => originalCommand.includes(keyword));

  const project = createProject({
    name: buildImmediateProjectName(department, goal),
    goal,
    workspace: department.workspaceUri,
    ...(templateId ? { templateId } : {}),
    projectType: 'adhoc',
    ...(skillHint ? { skillHint } : {}),
  });

  if (!shouldExecute) {
    return {
      success: true,
      action: 'create_project',
      projectId: project.projectId,
      message: `已创建 Ad-hoc Project「${project.name}」。Project ID：${project.projectId}。根据你的指令，本次只创建项目，不自动执行。`,
    };
  }

  try {
    if (templateId) {
      const budgetLedger = reserveCEOManualBudget({
        workspace: department.workspaceUri,
        goal,
        kind: 'template',
      });
      let dispatchResult: { runId: string };
      try {
        dispatchResult = await executeDispatch({
          workspace: department.workspaceUri,
          projectId: project.projectId,
          templateId,
          prompt: goal,
        });
      } catch (err) {
        releaseCEOManualBudget(budgetLedger, 'CEO template dispatch failed before run attach');
        throw err;
      }
      attachRunToBudgetReservation(budgetLedger, dispatchResult.runId);
      return {
        success: true,
        action: 'create_project',
        projectId: project.projectId,
        runId: dispatchResult.runId,
        message: `已创建 Ad-hoc Project「${project.name}」，并派发模板「${templateId}」。Project ID：${project.projectId}，Run ID：${dispatchResult.runId}。`,
      };
    }

    const skills: string[] = skillHint ? [skillHint] : [];
    const budgetLedger = reserveCEOManualBudget({
      workspace: department.workspaceUri,
      goal,
      kind: 'prompt',
    });
    let promptResult: { runId: string };
    try {
      promptResult = await executePrompt({
        workspace: department.workspaceUri,
        projectId: project.projectId,
        prompt: goal,
        executionTarget: {
          kind: 'prompt',
          ...(skills.length ? { skillHints: skills } : {}),
        },
      });
    } catch (err) {
      releaseCEOManualBudget(budgetLedger, 'CEO prompt dispatch failed before run attach');
      throw err;
    }
    attachRunToBudgetReservation(budgetLedger, promptResult.runId);
    return {
      success: true,
      action: 'create_project',
      projectId: project.projectId,
      runId: promptResult.runId,
      message: `已创建 Ad-hoc Project「${project.name}」，并发起即时执行。Project ID：${project.projectId}，Run ID：${promptResult.runId}。`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      action: 'report_to_human',
      projectId: project.projectId,
      message: `已创建 Ad-hoc Project「${project.name}」（Project ID：${project.projectId}），但执行失败：${message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// LLM-based CEO Command Parser
// ---------------------------------------------------------------------------

/**
 * Structured output from LLM parsing of a CEO command.
 */
interface LLMParsedCommand {
  /** Whether the command has clear scheduling intent */
  isSchedule: boolean;
  /** Whether the command is an immediate execution request */
  isImmediate: boolean;
  /** Whether the command is a status query */
  isStatusQuery: boolean;

  // --- Schedule fields (if isSchedule) ---
  scheduleType?: 'cron' | 'interval' | 'once';
  cronExpression?: string;
  intervalMs?: number;
  scheduledAt?: string;
  scheduleLabel?: string;

  // --- Action fields ---
  actionKind: 'create-project' | 'health-check' | 'dispatch-pipeline' | 'dispatch-prompt';
  departmentName?: string;
  projectName?: string;
  templateId?: string;
  goal: string;
  skillHint?: string;
}

function readCEOPlaybook(filename: string): string {
  const workspacePath = getCEOWorkspacePath();
  const filePath = path.join(workspacePath, '.agents', 'workflows', filename);
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function buildCEOPlaybookContext(): string {
  const ceoPlaybook = readCEOPlaybook('ceo-playbook.md');
  const schedulerPlaybook = readCEOPlaybook('ceo-scheduler-playbook.md');

  return [
    '## CEO Playbooks (source of truth)',
    '',
    '<ceo-playbook>',
    ceoPlaybook || 'MISSING: ceo-playbook.md',
    '</ceo-playbook>',
    '',
    '<ceo-scheduler-playbook>',
    schedulerPlaybook || 'MISSING: ceo-scheduler-playbook.md',
    '</ceo-scheduler-playbook>',
  ].join('\n');
}

/**
 * Build the LLM prompt for parsing a CEO command into structured JSON.
 */
function buildLLMParserPrompt(
  command: string,
  departments: DepartmentEntry[],
): string {
  const deptList = departments.map(d =>
    `- "${d.config.name}" (type: ${d.config.type}, uri: ${d.workspaceUri}${d.config.templateIds?.length ? `, templates: [${d.config.templateIds.join(', ')}]` : ''})`
  ).join('\n');

  const projects = listProjects();
  const projList = projects.slice(0, 20).map(p =>
    `- "${p.name}" (id: ${p.projectId}, status: ${p.status})`
  ).join('\n') || '（暂无项目）';

  const templates = AssetLoader.loadAllTemplates();
  const tmplList = templates.map(t =>
    `- id: "${t.id}", title: "${t.title || t.id}"`
  ).join('\n') || '（暂无模板）';

  const playbookContext = buildCEOPlaybookContext();

  return `你是 CEO 指令解析器。必须严格遵循下方 CEO workspace 中的 playbook，并将以下自然语言指令解析为严格 JSON。

${playbookContext}

## 可用部门
${deptList}

## 可用项目
${projList}

## 可用模板
${tmplList}

## 解析约束
1. 上面的两个 playbook 是业务规则真相源；如果和你自身习惯冲突，必须服从 playbook。
2. 部门分配、是否走 template、是否走 prompt，必须由 playbook、可用部门信息、可用模板信息共同决定，不要自行套额外业务规则。
3. 只有状态查询才返回 info 所需语义；只有定时任务才返回 scheduler 相关语义。

## 技术映射规则
1. **时间理解**：
   - "下午3点" → 15:00，"晚上8点" → 20:00，"早上9点" → 09:00
   - "每月1号" → cron \`0 9 1 * *\`（默认9点）
   - "每周一和周五" → cron \`0 9 * * 1,5\`
   - "每隔5秒" → interval 5000
   - "每两周" → interval 1209600000 (14天)
   - 没有说具体时间则默认 09:00
2. **意图识别**：
   - 有"每天/每周/每月/工作日/每隔/明天/cron/定时"等词 → isSchedule=true
   - 有"执行/分析/整理/运行/处理/研究/生成/报告"等词且无定时词 → isImmediate=true
   - 有"状态/进度/汇报/怎么样"等词 → isStatusQuery=true
3. **动作类型**：
   - \`health-check / dispatch-pipeline / dispatch-prompt / create-project\` 的选择，必须优先服从 playbook，而不是静态关键词表。
4. **部门匹配**：可以做近似匹配，但必须以 playbook 和部门真实配置为准。
5. **goal**：提取出业务目标，去掉时间/调度相关的词语。

## 指令
"${command}"

## 输出
仅返回一个 JSON 对象，不要包含 markdown 代码块，不要有注释。结构如下：
{
  "isSchedule": boolean,
  "isImmediate": boolean,
  "isStatusQuery": boolean,
  "scheduleType": "cron" | "interval" | "once" | null,
  "cronExpression": string | null,
  "intervalMs": number | null,
  "scheduledAt": string | null,
  "scheduleLabel": string | null,
  "actionKind": "create-project" | "health-check" | "dispatch-pipeline" | "dispatch-prompt",
  "departmentName": string | null,
  "projectName": string | null,
  "templateId": string | null,
  "goal": string,
  "skillHint": string | null
}`;
}

/**
 * Parse a CEO command using LLM, with fallback to regex.
 * Returns null if LLM is not available or parsing fails.
 */
async function parseCEOCommandWithLLM(
  command: string,
  departments: DepartmentEntry[],
): Promise<LLMParsedCommand | null> {
  try {
    const prompt = buildLLMParserPrompt(command, departments);

    // Race LLM call against a 15s timeout — CEO commands should feel instant
    const LLM_PARSE_TIMEOUT_MS = 15_000;
    const response = await Promise.race([
      callLLMOneshot(prompt, undefined, 'executive'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM parse timeout (15s)')), LLM_PARSE_TIMEOUT_MS),
      ),
    ]);

    // Extract JSON from response (handle possible markdown wrapping)
    let jsonStr = response.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    // Try to find JSON object boundaries
    const startIdx = jsonStr.indexOf('{');
    const endIdx = jsonStr.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      jsonStr = jsonStr.slice(startIdx, endIdx + 1);
    }

    const parsed = JSON.parse(jsonStr) as LLMParsedCommand;

    // Validate essential fields
    if (typeof parsed.isSchedule !== 'boolean' || typeof parsed.goal !== 'string') {
      log.warn({ parsed }, 'LLM response missing essential fields, falling back to regex');
      return null;
    }

    // Validate cron expression if provided
    if (parsed.cronExpression) {
      const { validateCron } = await import('../cron-utils');
      const cronErr = validateCron(parsed.cronExpression);
      if (cronErr) {
        log.warn({ cron: parsed.cronExpression, err: cronErr }, 'LLM generated invalid cron, falling back to regex');
        return null;
      }
    }

    log.info({ actionKind: parsed.actionKind, isSchedule: parsed.isSchedule, isImmediate: parsed.isImmediate }, 'LLM parsed CEO command');
    return parsed;
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'LLM parsing failed, falling back to regex');
    return null;
  }
}

/**
 * Resolve a department from the LLM-parsed department name.
 */
function resolveDepartmentFromLLM(
  departmentName: string | undefined,
  departments: DepartmentEntry[],
): DepartmentEntry | null {
  if (!departmentName) return departments.length === 1 ? departments[0] : null;
  const normalized = normalizeText(departmentName);
  return departments.find(d => d.aliases.some(a => a && (a.includes(normalized) || normalized.includes(a)))) || null;
}

function isStatusIntent(command: string): boolean {
  return STATUS_KEYWORDS.some((keyword) => command.includes(keyword));
}

function isScheduleIntent(command: string): boolean {
  const normalized = command.toLowerCase();
  return SCHEDULE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function summarizeProjects(): string {
  const projects = listProjects();
  if (projects.length === 0) {
    return '当前没有正在跟踪的项目。';
  }

  const counts = projects.reduce(
    (acc, project) => {
      acc[project.status] = (acc[project.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const latest = projects.slice(0, 5).map((project) => `${project.name}(${project.status})`).join('，');
  return `当前项目共 ${projects.length} 个：进行中 ${counts.active || 0}，已完成 ${counts.completed || 0}，失败 ${counts.failed || 0}，暂停 ${counts.paused || 0}。最近项目：${latest}`;
}

/**
 * Execute a command parsed by the LLM into structured fields.
 */
async function executeLLMParsedCommand(
  parsed: LLMParsedCommand,
  originalCommand: string,
  departments: Map<string, DepartmentConfig>,
  departmentEntries: DepartmentEntry[],
): Promise<CEOCommandResult> {
  // Status query
  if (parsed.isStatusQuery && !parsed.isSchedule) {
    return { success: true, action: 'info', message: summarizeProjects() };
  }

  // Immediate execution (non-scheduled)
  if (parsed.isImmediate && !parsed.isSchedule) {
    const department = resolveDepartmentFromLLM(parsed.departmentName, departmentEntries);
    if (!department) {
      return {
        success: false,
        action: 'needs_decision',
        message: `无法确定执行部门「${parsed.departmentName || '未指定'}」。请明确部门名称。`,
        suggestions: departmentEntries.slice(0, 5).map(e => ({
          type: 'clarify_department' as const,
          label: e.config.name,
          description: e.workspaceUri,
          payload: { workspaceUri: e.workspaceUri },
        })),
      };
    }

    try {
      return executeImmediateDepartmentTask({
        department,
        originalCommand,
        goal: parsed.goal,
        skillHint: parsed.skillHint || undefined,
        templateId: parsed.actionKind === 'dispatch-pipeline' || parsed.actionKind === 'create-project'
          ? (parsed.templateId || undefined)
          : undefined,
      });
    } catch (err: unknown) {
      return {
        success: false,
        action: 'report_to_human',
        message: `即时执行失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Scheduled task — build schedule spec from LLM output
  if (!parsed.isSchedule || !parsed.scheduleType) {
    return {
      success: false,
      action: 'report_to_human',
      message: '当前 CEO 命令兼容层优先支持状态查询、即时任务执行和自然语言定时任务创建。更复杂的调度请在 CEO Office 会话里继续。',
    };
  }

  const schedule: ScheduleSpec = parsed.scheduleType === 'cron'
    ? { type: 'cron', cronExpression: parsed.cronExpression!, label: parsed.scheduleLabel || parsed.cronExpression! }
    : parsed.scheduleType === 'interval'
      ? { type: 'interval', intervalMs: parsed.intervalMs!, label: parsed.scheduleLabel || formatIntervalLabel(parsed.intervalMs!) }
      : { type: 'once', scheduledAt: parsed.scheduledAt!, label: parsed.scheduleLabel || parsed.scheduledAt! };

  // Resolve action target
  const department = resolveDepartmentFromLLM(parsed.departmentName, departmentEntries);
  const actionDraft = buildActionDraftFromLLM(parsed, department, departmentEntries);
  if ('error' in actionDraft) {
    return { success: false, action: 'needs_decision', message: actionDraft.error, suggestions: actionDraft.suggestions };
  }

  return createScheduledJobFromDraft(originalCommand, schedule, actionDraft);
}

/**
 * Build action draft from LLM parsed result.
 */
function buildActionDraftFromLLM(
  parsed: LLMParsedCommand,
  department: DepartmentEntry | null,
  departmentEntries: DepartmentEntry[],
): SchedulerActionDraft | { error: string; suggestions?: CEOSuggestion[] } {
  if (parsed.actionKind === 'health-check') {
    const project = parsed.projectName ? (() => {
      const projects = listProjects();
      return projects.find(p => normalizeText(p.name).includes(normalizeText(parsed.projectName!)));
    })() : matchProject(parsed.goal);
    if (!project) {
      return {
        error: '缺少匹配的项目。请在指令里带上项目名。',
        suggestions: listProjects().slice(0, 5).map(p => ({
          type: 'clarify_project' as const, label: p.name, description: `项目 ${p.projectId}`, payload: { projectId: p.projectId },
        })),
      };
    }
    return { kind: 'health-check', label: `${project.name} 健康巡检`, projectId: project.projectId };
  }

  if (!department) {
    return {
      error: `无法确定目标部门「${parsed.departmentName || '未指定'}」。请明确部门名称。`,
      suggestions: departmentEntries.slice(0, 5).map(e => ({
        type: 'clarify_department' as const, label: e.config.name, description: e.workspaceUri, payload: { workspaceUri: e.workspaceUri },
      })),
    };
  }

  if (parsed.actionKind === 'dispatch-pipeline') {
    const templateId = parsed.templateId || matchTemplate(parsed.goal)?.id;
    if (!templateId) {
      return {
        error: '需要指定模板。',
        suggestions: AssetLoader.loadAllTemplates().slice(0, 5).map(t => ({
          type: 'clarify_template' as const, label: t.title || t.id, description: t.id, payload: { templateId: t.id },
        })),
      };
    }
    return {
      kind: 'dispatch-pipeline', label: `${department.config.name} 定时派发`,
      workspace: department.workspaceUri, prompt: parsed.goal, templateId,
    };
  }

  if (parsed.actionKind === 'dispatch-prompt') {
    return {
      kind: 'dispatch-prompt', label: `${department.config.name} Prompt 任务`,
      workspace: department.workspaceUri, prompt: parsed.goal,
      ...(parsed.skillHint ? { skillHints: [parsed.skillHint] } : {}),
    };
  }

  // create-project
  return {
    kind: 'create-project',
    label: `${department.config.name} 定时任务`,
    departmentWorkspaceUri: department.workspaceUri,
    goal: parsed.goal,
    skillHint: parsed.skillHint || undefined,
    templateId: parsed.templateId || undefined,
  };
}

/**
 * Create a scheduler job from schedule spec + action draft.
 * Shared by both LLM and regex paths.
 */
function createScheduledJobFromDraft(
  originalCommand: string,
  schedule: ScheduleSpec,
  actionDraft: SchedulerActionDraft,
): CEOCommandResult {
  const name = `${actionDraft.label} · ${schedule.label}`;
  const scheduleFields = schedule.type === 'cron'
    ? { cronExpression: schedule.cronExpression }
    : schedule.type === 'interval'
      ? { intervalMs: schedule.intervalMs }
      : { scheduledAt: schedule.scheduledAt };
  const job = createScheduledJob({
    name,
    type: schedule.type,
    ...scheduleFields,
    enabled: true,
    createdBy: 'ceo-command',
    intentSummary: originalCommand,
    action: actionDraft.kind === 'health-check'
      ? { kind: 'health-check', projectId: actionDraft.projectId }
      : actionDraft.kind === 'dispatch-pipeline'
      ? {
          kind: 'dispatch-pipeline', workspace: actionDraft.workspace,
          prompt: actionDraft.prompt, templateId: actionDraft.templateId,
        }
      : actionDraft.kind === 'dispatch-prompt'
      ? {
          kind: 'dispatch-prompt', workspace: actionDraft.workspace, prompt: actionDraft.prompt,
          ...(actionDraft.promptAssetRefs?.length ? { promptAssetRefs: actionDraft.promptAssetRefs } : {}),
          ...(actionDraft.skillHints?.length ? { skillHints: actionDraft.skillHints } : {}),
        }
      : { kind: 'create-project' },
    ...(actionDraft.kind === 'create-project'
      ? {
          departmentWorkspaceUri: actionDraft.departmentWorkspaceUri,
          opcAction: {
            type: 'create_project' as const, projectType: 'adhoc' as const,
            goal: actionDraft.goal,
            ...(actionDraft.skillHint ? { skillHint: actionDraft.skillHint } : {}),
            ...(actionDraft.templateId ? { templateId: actionDraft.templateId } : {}),
          },
        }
      : {}),
  });

  const nextRunAt = getNextRunAt(job);
  const kindMessage = actionDraft.kind === 'create-project'
    ? actionDraft.templateId
      ? `触发时会自动创建一个 Ad-hoc 项目，并派发模板「${getTemplateLabel(actionDraft.templateId)}」。`
      : '触发时会自动创建一个 Ad-hoc 项目。当前没有唯一确定 auto-run 模板，因此这条定时任务不会直接启动 run。'
    : actionDraft.kind === 'dispatch-prompt'
      ? '触发时会以 Prompt Mode 执行任务，由 AI 按业务 prompt 主导完成。'
      : actionDraft.kind === 'health-check'
        ? '触发时会执行一次项目健康巡检。'
        : '触发时会派发指定模板。';

  return {
    success: true,
    action: 'create_scheduler_job',
    jobId: job.jobId,
    nextRunAt,
    message: `已创建定时任务"${job.name}"。${kindMessage}下一次执行时间：${nextRunAt || '待计算'}。当前系统共有 ${listScheduledJobs().length} 个定时任务。`,
  };
}

/**
 * Regex-based fallback for processing CEO commands.
 * Used when LLM is not available.
 */
async function processWithRegex(
  trimmed: string,
  _departments: Map<string, DepartmentConfig>,
): Promise<CEOCommandResult> {
  void _departments;
  if (isStatusIntent(trimmed) && !isScheduleIntent(trimmed)) {
    return { success: true, action: 'info', message: summarizeProjects() };
  }

  return {
    success: false,
    action: 'report_to_human',
    message: 'CEO playbook 解析当前不可用。为了避免用硬编码规则替你决定部门、Template 或 Prompt，我没有自动派发。请恢复 LLM/playbook 解析后重试。',
  };
}

export async function processCEOCommand(
  command: string,
  departments: Map<string, DepartmentConfig>,
  _options?: { model?: string },
): Promise<CEOCommandResult> {
  void _options;
  const trimmed = command.trim();
  if (!trimmed) {
    return { success: false, action: 'info', message: '请输入 CEO 指令。' };
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Try LLM-based parsing (AI understands natural language)
  // ---------------------------------------------------------------------------
  const departmentEntries = deriveDepartmentEntries(departments);
  const llmResult = await parseCEOCommandWithLLM(trimmed, departmentEntries);

  if (llmResult) {
    const result = await executeLLMParsedCommand(llmResult, trimmed, departments, departmentEntries);
    recordCEOOutcome(trimmed, result, llmResult.goal || trimmed);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Fallback to regex-based parsing (when LLM is unavailable)
  // ---------------------------------------------------------------------------
  log.info('Falling back to regex-based CEO command parsing');
  const result = await processWithRegex(trimmed, departments);
  recordCEOOutcome(trimmed, result, trimmed);
  return result;
}

function recordCEOOutcome(command: string, result: CEOCommandResult, focusSeed: string): void {
  try {
    const focus = focusSeed
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    if (focus) {
      updateCEOActiveFocus([focus]);
    }

    appendCEODecision({
      timestamp: new Date().toISOString(),
      summary: result.message,
      source: 'ceo',
      command,
      action: result.action,
      projectId: result.projectId,
      runId: result.runId,
    });
  } catch (error) {
    log.debug({ err: error instanceof Error ? error.message : String(error) }, 'Failed to persist CEO outcome');
  }
}
