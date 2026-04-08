import { AssetLoader } from './asset-loader';
import { executePrompt } from './prompt-executor';
import { callLLMOneshot } from './llm-oneshot';
import { createScheduledJob, getNextRunAt, listScheduledJobs } from './scheduler';
import { listProjects } from './project-registry';
import type { DepartmentConfig } from '../types';
import { createLogger } from '../logger';

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
    | 'create_scheduler_job'
    | 'dispatch_prompt'
    | 'report_to_human'
    | 'info'
    | 'needs_decision';
  message: string;
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
const TIME_REGEX = /(\d{1,2})\s*(?:[:：]\s*(\d{1,2})|点(?:\s*(\d{1,2})\s*分?)?)/;
const DATE_REGEX = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/;
const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

const CREATE_PROJECT_OPT_OUT_KEYWORDS = ['只创建项目', '先创建项目', '只建项目', '不要执行', '不要派发', '不自动运行', '不要run'];

const CREATE_PROJECT_TEMPLATE_HINTS: Record<string, string[]> = {
  'coding-basic-template': ['开发', '实现', '修复', 'bug', '代码', '编码', '接口', '脚本', '登录'],
  'development-template-1': ['产品', '需求', '架构', '模块', '系统', '完整产研', '开发'],
  'ux-driven-dev-template': ['交互', 'ux', '体验', '设计', '界面'],
  'design-review-template': ['评审', 'review', '体验评审', '设计评审'],
  'template-factory': ['模板', 'workflow', 'pipeline'],
  'universal-batch-template': ['调研', '研究', '报告', '简报', '汇总', '日报', '周报', '月报', 'seo', '竞品', '分析'],
  'morning-brief-template': ['盘前', '简报', '宏观', '策略', 'a股', '股票'],
  'financial-analysis-template': ['财务', '金融', '资金面', '市场', '股票', 'a股'],
  'large-project-template': ['大型', '分解', '并行', '工作包', '复杂', '重构', '多模块'],
  'research-branch-template': ['调研', '研究'],
};

const DISPATCH_TEMPLATE_KEYWORDS = /(pipeline|流水线|派发|dispatch|执行模板|运行模板)/i;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').trim();
}

function formatTimeLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTime(command: string, fallbackHour: number = 9, fallbackMinute: number = 0): { hour: number; minute: number } {
  const match = command.match(TIME_REGEX);
  if (!match) {
    return { hour: fallbackHour, minute: fallbackMinute };
  }

  const hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : match[3] ? parseInt(match[3], 10) : 0;
  return {
    hour: Number.isFinite(hour) ? Math.max(0, Math.min(hour, 23)) : fallbackHour,
    minute: Number.isFinite(minute) ? Math.max(0, Math.min(minute, 59)) : fallbackMinute,
  };
}

function parseSchedule(command: string, now: Date = new Date()): ScheduleSpec | null {
  const normalized = normalizeText(command);
  const { hour, minute } = parseTime(command);
  const timeLabel = formatTimeLabel(hour, minute);

  const intervalMatch = command.match(/每隔\s*(\d+)\s*(分钟|小时|天)/);
  if (intervalMatch) {
    const count = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2];
    const multiplier = unit === '分钟' ? 60_000 : unit === '小时' ? 3_600_000 : 86_400_000;
    return {
      type: 'interval',
      intervalMs: count * multiplier,
      label: `每隔${count}${unit}`,
    };
  }

  if (normalized.includes('每小时')) {
    return {
      type: 'interval',
      intervalMs: 3_600_000,
      label: '每小时',
    };
  }

  const explicitDate = command.match(DATE_REGEX);
  if (explicitDate) {
    const scheduledAt = new Date(
      Number(explicitDate[1]),
      Number(explicitDate[2]) - 1,
      Number(explicitDate[3]),
      hour,
      minute,
      0,
      0,
    );
    return {
      type: 'once',
      scheduledAt: scheduledAt.toISOString(),
      label: `${explicitDate[1]}-${String(explicitDate[2]).padStart(2, '0')}-${String(explicitDate[3]).padStart(2, '0')} ${timeLabel}`,
    };
  }

  if (normalized.includes('明天') || normalized.includes('明早') || normalized.includes('明晚')) {
    const scheduledAt = new Date(now);
    scheduledAt.setDate(scheduledAt.getDate() + 1);
    scheduledAt.setHours(hour, minute, 0, 0);
    return {
      type: 'once',
      scheduledAt: scheduledAt.toISOString(),
      label: `明天 ${timeLabel}`,
    };
  }

  const weeklyMatch = command.match(/每周([一二三四五六日天])/);
  if (weeklyMatch) {
    const weekday = WEEKDAY_MAP[weeklyMatch[1]];
    return {
      type: 'cron',
      cronExpression: `${minute} ${hour} * * ${weekday}`,
      label: `每周${weeklyMatch[1]} ${timeLabel}`,
    };
  }

  if (normalized.includes('工作日') || normalized.includes('周一到周五')) {
    return {
      type: 'cron',
      cronExpression: `${minute} ${hour} * * 1-5`,
      label: `工作日 ${timeLabel}`,
    };
  }

  if (normalized.includes('每天') || normalized.includes('每日')) {
    return {
      type: 'cron',
      cronExpression: `${minute} ${hour} * * *`,
      label: `每天 ${timeLabel}`,
    };
  }

  return null;
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

function matchDepartment(command: string, departments: DepartmentEntry[]): DepartmentEntry | null {
  const normalized = normalizeText(command);
  const matches = departments.filter((entry) => entry.aliases.some((alias) => alias && normalized.includes(alias)));
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0 && departments.length === 1) {
    return departments[0];
  }
  return null;
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

function getTemplateSearchText(template: any): string {
  const pipelineTitles = Array.isArray(template.pipeline)
    ? template.pipeline.map((stage: any) => stage.title || stage.stageId || '').join(' ')
    : '';
  const graphTitles = Array.isArray(template.graphPipeline?.nodes)
    ? template.graphPipeline.nodes.map((node: any) => node.title || node.id || '').join(' ')
    : '';
  return normalizeText([
    template.id,
    template.title || '',
    template.description || '',
    pipelineTitles,
    graphTitles,
  ].join(' '));
}

function scoreTemplateCandidate(template: any, command: string, goal: string, skillHint: string | undefined, departmentType: string): number {
  const normalizedCommand = normalizeText(`${command} ${goal}`);
  const searchText = getTemplateSearchText(template);
  let score = 0;

  if (normalizedCommand.includes(normalizeText(template.id)) || (template.title && normalizedCommand.includes(normalizeText(template.title)))) {
    score += 100;
  }

  for (const keyword of CREATE_PROJECT_TEMPLATE_HINTS[template.id] || []) {
    if (normalizedCommand.includes(normalizeText(keyword))) {
      score += 12;
    }
  }

  if (skillHint === 'reporting') {
    if (template.id === 'universal-batch-template') score += 24;
    if (template.id === 'morning-brief-template' || template.id === 'financial-analysis-template') score += 16;
  }

  if (skillHint === 'seo-analysis' && template.id === 'universal-batch-template') {
    score += 28;
  }

  if (departmentType === 'research' && /research|brief|analysis/.test(`${template.id} ${template.title || ''}`.toLowerCase())) {
    score += 8;
  }

  if (departmentType === 'build' && ['coding-basic-template', 'development-template-1', 'ux-driven-dev-template', 'design-review-template', 'large-project-template'].includes(template.id)) {
    score += 4;
  }

  if ((/日报|周报|月报|报告|简报|调研|研究|分析|seo/i.test(command) || skillHint === 'reporting' || skillHint === 'seo-analysis')
    && (searchText.includes('research') || searchText.includes('analysis') || searchText.includes('brief'))) {
    score += 6;
  }

  return score;
}

function getCreateProjectFallbackTemplateIds(goal: string, skillHint: string | undefined, departmentType: string): string[] {
  if (skillHint === 'reporting' || skillHint === 'seo-analysis' || /日报|周报|月报|报告|简报|调研|研究|分析|seo/i.test(goal)) {
    return ['universal-batch-template', 'morning-brief-template', 'financial-analysis-template', 'research-branch-template'];
  }
  if (/交互|体验|ux|设计|评审/i.test(goal)) {
    return ['ux-driven-dev-template', 'design-review-template', 'development-template-1'];
  }
  if (/大型|分解|并行|工作包|复杂|多模块|重构/i.test(goal)) {
    return ['large-project-template', 'development-template-1'];
  }
  if (/开发|实现|修复|代码|编码|接口|脚本|bug|登录|前端|后端|feature|功能/i.test(goal)) {
    return ['coding-basic-template', 'development-template-1'];
  }
  if (/模板|workflow|pipeline/i.test(goal)) {
    return ['template-factory', 'development-template-1'];
  }
  if (departmentType === 'research') {
    return ['universal-batch-template', 'research-branch-template', 'morning-brief-template'];
  }
  return [];
}

function resolveCreateProjectTemplate(command: string, goal: string, department: DepartmentEntry, skillHint?: string): {
  templateId?: string;
  suggestions?: CEOSuggestion[];
} {
  if (CREATE_PROJECT_OPT_OUT_KEYWORDS.some((keyword) => command.includes(keyword))) {
    return {};
  }

  const allTemplates = AssetLoader.loadAllTemplates();
  const explicitTemplate = matchTemplate(command);
  if (explicitTemplate) {
    return { templateId: explicitTemplate.id };
  }

  const preferredTemplateIds = department.config.templateIds;
  const preferredTemplates = preferredTemplateIds?.length
    ? allTemplates.filter((template) => preferredTemplateIds.includes(template.id))
    : [];
  const candidateTemplates = preferredTemplates.length > 0 ? preferredTemplates : allTemplates;

  if (allTemplates.length === 0) {
    return {};
  }

  if (candidateTemplates.length === 1) {
    return { templateId: candidateTemplates[0].id };
  }

  const pickScoredTemplate = (templates: any[]): string | undefined => {
    const scoredTemplates = templates
      .map((template) => ({
        template,
        score: scoreTemplateCandidate(template, command, goal, skillHint, department.config.type),
      }))
      .sort((left, right) => right.score - left.score);

    const best = scoredTemplates[0];
    const second = scoredTemplates[1];
    if (best && best.score > 0 && (!second || best.score >= second.score + 5)) {
      return best.template.id;
    }
    return undefined;
  };

  const preferredScoredTemplateId = pickScoredTemplate(candidateTemplates);
  if (preferredScoredTemplateId) {
    return { templateId: preferredScoredTemplateId };
  }

  if (candidateTemplates !== allTemplates) {
    const globalScoredTemplateId = pickScoredTemplate(allTemplates);
    if (globalScoredTemplateId) {
      return { templateId: globalScoredTemplateId };
    }
  }

  const fallbackTemplateId = getCreateProjectFallbackTemplateIds(goal, skillHint, department.config.type)
    .find((templateId) => allTemplates.some((template) => template.id === templateId));
  if (fallbackTemplateId) {
    return { templateId: fallbackTemplateId };
  }

  return {
    suggestions: candidateTemplates.slice(0, 5).map((candidate) => ({
      type: 'clarify_template',
      label: candidate.title || candidate.id,
      description: candidate.id,
      payload: { templateId: candidate.id },
    })),
  };
}

function cleanupGoal(command: string): string {
  return command
    .replace(DATE_REGEX, '')
    .replace(TIME_REGEX, '')
    .replace(/每隔\s*\d+\s*(分钟|小时|天)/g, '')
    .replace(/每周[一二三四五六日天]/g, '')
    .replace(/每天|每日|工作日|周一到周五|明天|明早|明晚|自动|定时|cron/gi, '')
    .replace(/让|给|请|帮我/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  return `你是 CEO 指令解析器。将以下自然语言指令解析为严格 JSON。

## 可用部门
${deptList}

## 可用项目
${projList}

## 可用模板
${tmplList}

## 规则
1. **时间理解**：
   - "下午3点" → 15:00，"晚上8点" → 20:00，"早上9点" → 09:00
   - "每月1号" → cron \`0 9 1 * *\`（默认9点）
   - "每周一和周五" → cron \`0 9 * * 1,5\`
   - "每两周" → interval 1209600000 (14天)
   - 没有说具体时间则默认 09:00
2. **意图识别**：
   - 有"每天/每周/每月/工作日/每隔/明天/cron/定时"等词 → isSchedule=true
   - 有"执行/分析/整理/运行/处理/研究/生成/报告"等词且无定时词 → isImmediate=true
   - 有"状态/进度/汇报/怎么样"等词 → isStatusQuery=true
3. **动作类型**：
   - 提到"健康/巡检/health/check" → health-check（需匹配项目）
   - 提到"pipeline/流水线/派发/dispatch" → dispatch-pipeline（需匹配模板）
   - 能唯一匹配到模板 → create-project（带 templateId）
   - 无法匹配模板但有执行意图 → dispatch-prompt
   - 明确说"只创建项目/不要执行" → create-project（不带 templateId）
4. **部门匹配**：尽量匹配最接近的部门名称。部分匹配也可以。
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
  } catch (err: any) {
    log.warn({ err: err.message }, 'LLM parsing failed, falling back to regex');
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

export function buildSchedulerIntentPreview(
  command: string,
  departments: Map<string, DepartmentConfig>,
): {
  schedule: ScheduleSpec | null;
  actionDraft: SchedulerActionDraft | null;
  error?: string;
  suggestions?: CEOSuggestion[];
  jobName?: string;
} {
  const trimmed = command.trim();
  const schedule = parseSchedule(trimmed);
  if (!schedule) {
    return {
      schedule: null,
      actionDraft: null,
      error: 'missing_schedule',
    };
  }

  const departmentEntries = deriveDepartmentEntries(departments);
  const actionDraft = deriveActionDraft(trimmed, departmentEntries);
  if ('error' in actionDraft) {
    return {
      schedule,
      actionDraft: null,
      error: actionDraft.error,
      suggestions: actionDraft.suggestions,
    };
  }

  return {
    schedule,
    actionDraft,
    jobName: `${actionDraft.label} · ${schedule.label}`,
    ...(actionDraft.kind === 'create-project' && actionDraft.suggestions?.length ? { suggestions: actionDraft.suggestions } : {}),
  };
}

function deriveActionDraft(command: string, departments: DepartmentEntry[]): SchedulerActionDraft | { error: string; suggestions?: CEOSuggestion[] } {
  const normalized = normalizeText(command);

  if (/(健康|巡检|health|check)/i.test(command)) {
    const project = matchProject(command);
    if (!project) {
      return {
        error: '我识别到这是健康巡检类定时任务，但没有唯一匹配到项目。请在指令里带上项目名。',
        suggestions: listProjects().slice(0, 5).map((candidate) => ({
          type: 'clarify_project',
          label: candidate.name,
          description: `项目 ${candidate.projectId}`,
          payload: { projectId: candidate.projectId },
        })),
      };
    }

    return {
      kind: 'health-check',
      label: `${project.name} 健康巡检`,
      projectId: project.projectId,
    };
  }

  if (DISPATCH_TEMPLATE_KEYWORDS.test(command)) {
    const department = matchDepartment(command, departments);
    if (!department) {
      return {
        error: '我识别到这是模板派发类定时任务，但没有唯一匹配到部门。请在指令里明确部门名称。',
        suggestions: departments.slice(0, 5).map((entry) => ({
          type: 'clarify_department',
          label: entry.config.name,
          description: entry.workspaceUri,
          payload: { workspaceUri: entry.workspaceUri },
        })),
      };
    }

    const template = matchTemplate(command);
    if (!template) {
      return {
        error: '我识别到这是模板派发类定时任务，但没有唯一匹配到模板。请在指令里明确模板名或模板 ID。',
        suggestions: AssetLoader.loadAllTemplates().slice(0, 5).map((candidate) => ({
          type: 'clarify_template',
          label: candidate.title || candidate.id,
          description: candidate.id,
          payload: { templateId: candidate.id },
        })),
      };
    }

    return {
      kind: 'dispatch-pipeline',
      label: `${department.config.name} 定时派发`,
      workspace: department.workspaceUri,
      prompt: cleanupGoal(command) || command.trim(),
      templateId: template.id,
    };
  }

  const department = matchDepartment(command, departments);
  if (!department) {
    return {
      error: '我识别到这是部门任务类定时任务，但没有唯一匹配到部门。请在指令里明确部门名称。',
      suggestions: departments.slice(0, 5).map((entry) => ({
        type: 'clarify_department',
        label: entry.config.name,
        description: entry.workspaceUri,
        payload: { workspaceUri: entry.workspaceUri },
      })),
    };
  }

  const goal = cleanupGoal(command) || `${department.config.name} 定时任务`;
  const skillHint = /seo/i.test(command) ? 'seo-analysis' : /日报|周报|月报/.test(command) ? 'reporting' : undefined;
  const templateResolution = resolveCreateProjectTemplate(command, goal, department, skillHint);

  // If no unique template and the command has clear execution intent (not project-only),
  // route to Prompt Mode instead of degrading to project-only
  const hasExecutionIntent = !CREATE_PROJECT_OPT_OUT_KEYWORDS.some(kw => command.includes(kw))
    && /执行|运行|完成|处理|分析|整理|汇总|研究|调研|生成|报告|检查|审查|review|do|run|execute/i.test(command);

  if (!templateResolution.templateId && hasExecutionIntent) {
    const playbookRefs: string[] = [];
    const skills: string[] = [];
    if (skillHint) skills.push(skillHint);

    return {
      kind: 'dispatch-prompt',
      label: `${department.config.name} Prompt 任务`,
      workspace: department.workspaceUri,
      prompt: goal,
      ...(playbookRefs.length ? { promptAssetRefs: playbookRefs } : {}),
      ...(skills.length ? { skillHints: skills } : {}),
    };
  }

  return {
    kind: 'create-project',
    label: `${department.config.name} 定时任务`,
    departmentWorkspaceUri: department.workspaceUri,
    goal,
    skillHint,
    ...(templateResolution.templateId ? { templateId: templateResolution.templateId } : {}),
    ...(templateResolution.suggestions?.length ? { suggestions: templateResolution.suggestions } : {}),
  };
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

const IMMEDIATE_EXECUTION_INTENT = /执行|运行|完成|处理|分析|整理|汇总|研究|调研|生成|报告|检查|审查|review|do|run|execute/i;

async function tryImmediatePromptDispatch(
  command: string,
  departments: Map<string, DepartmentConfig>,
): Promise<CEOCommandResult | null> {
  if (!IMMEDIATE_EXECUTION_INTENT.test(command)) return null;

  const departmentEntries = deriveDepartmentEntries(departments);
  const department = matchDepartment(command, departmentEntries);
  if (!department) return null;

  const goal = cleanupGoal(command) || command.trim();
  const skillHint = /seo/i.test(command) ? 'seo-analysis' : /日报|周报|月报/.test(command) ? 'reporting' : undefined;
  const skills: string[] = skillHint ? [skillHint] : [];

  try {
    const result = await executePrompt({
      workspace: department.workspaceUri,
      prompt: goal,
      executionTarget: {
        kind: 'prompt',
        ...(skills.length ? { skillHints: skills } : {}),
      },
    });

    return {
      success: true,
      action: 'dispatch_prompt',
      runId: result.runId,
      message: `已发起即时 Prompt Mode 执行，目标部门「${department.config.name}」，任务：${goal}。运行 ID：${result.runId}`,
    };
  } catch (err: any) {
    return {
      success: false,
      action: 'report_to_human',
      message: `即时 Prompt Mode 执行失败：${err.message}`,
    };
  }
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
      const skills: string[] = parsed.skillHint ? [parsed.skillHint] : [];
      const result = await executePrompt({
        workspace: department.workspaceUri,
        prompt: parsed.goal,
        executionTarget: {
          kind: 'prompt',
          ...(skills.length ? { skillHints: skills } : {}),
        },
      });
      return {
        success: true,
        action: 'dispatch_prompt',
        runId: result.runId,
        message: `已发起即时 Prompt Mode 执行，目标部门「${department.config.name}」，任务：${parsed.goal}。运行 ID：${result.runId}`,
      };
    } catch (err: any) {
      return { success: false, action: 'report_to_human', message: `即时执行失败：${err.message}` };
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
      ? { type: 'interval', intervalMs: parsed.intervalMs!, label: parsed.scheduleLabel || `每隔${Math.round(parsed.intervalMs! / 60000)}分钟` }
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
  const job = createScheduledJob({
    name,
    type: schedule.type,
    ...(schedule.type === 'cron' ? { cronExpression: (schedule as any).cronExpression } : {}),
    ...(schedule.type === 'interval' ? { intervalMs: (schedule as any).intervalMs } : {}),
    ...(schedule.type === 'once' ? { scheduledAt: (schedule as any).scheduledAt } : {}),
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
  departments: Map<string, DepartmentConfig>,
): Promise<CEOCommandResult> {
  if (isStatusIntent(trimmed) && !isScheduleIntent(trimmed)) {
    return { success: true, action: 'info', message: summarizeProjects() };
  }

  if (!isScheduleIntent(trimmed)) {
    const immediateResult = await tryImmediatePromptDispatch(trimmed, departments);
    if (immediateResult) return immediateResult;
    return {
      success: false, action: 'report_to_human',
      message: '当前 CEO 命令兼容层优先支持状态查询、即时任务执行和自然语言定时任务创建。更复杂的调度请在 CEO Office 会话里继续。',
    };
  }

  const preview = buildSchedulerIntentPreview(trimmed, departments);
  if (!preview.schedule) {
    return {
      success: false, action: 'needs_decision',
      message: '我识别到你想创建定时任务，但还缺少明确的触发周期。请补充例如"每天 9 点""每周一 10 点"或"明天上午 9 点"。',
    };
  }

  if (!preview.actionDraft) {
    return {
      success: false, action: 'needs_decision',
      message: preview.error || '当前无法确定定时任务的目标对象。',
      suggestions: preview.suggestions,
    };
  }

  return createScheduledJobFromDraft(trimmed, preview.schedule, preview.actionDraft);
}

export async function processCEOCommand(
  command: string,
  departments: Map<string, DepartmentConfig>,
  _options?: { model?: string },
): Promise<CEOCommandResult> {
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
    return executeLLMParsedCommand(llmResult, trimmed, departments, departmentEntries);
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Fallback to regex-based parsing (when LLM is unavailable)
  // ---------------------------------------------------------------------------
  log.info('Falling back to regex-based CEO command parsing');
  return processWithRegex(trimmed, departments);
}