import { AssetLoader } from './asset-loader';
import { createScheduledJob, getNextRunAt, listScheduledJobs } from './scheduler';
import { listProjects } from './project-registry';
import type { DepartmentConfig } from '../types';

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
    | 'report_to_human'
    | 'info'
    | 'needs_decision';
  message: string;
  jobId?: string;
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

  if (/(模板|pipeline|流水线|派发|dispatch)/i.test(command)) {
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

  return {
    kind: 'create-project',
    label: `${department.config.name} 定时任务`,
    departmentWorkspaceUri: department.workspaceUri,
    goal,
    skillHint,
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

export async function processCEOCommand(
  command: string,
  departments: Map<string, DepartmentConfig>,
  _options?: { model?: string },
): Promise<CEOCommandResult> {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      success: false,
      action: 'info',
      message: '请输入 CEO 指令。',
    };
  }

  if (isStatusIntent(trimmed) && !isScheduleIntent(trimmed)) {
    return {
      success: true,
      action: 'info',
      message: summarizeProjects(),
    };
  }

  if (!isScheduleIntent(trimmed)) {
    return {
      success: false,
      action: 'report_to_human',
      message: '当前 CEO 命令兼容层优先支持状态查询和自然语言定时任务创建。更复杂的调度请在 CEO Office 会话里继续。',
    };
  }

  const schedule = parseSchedule(trimmed);
  if (!schedule) {
    return {
      success: false,
      action: 'needs_decision',
      message: '我识别到你想创建定时任务，但还缺少明确的触发周期。请补充例如“每天 9 点”“每周一 10 点”或“明天上午 9 点”。',
    };
  }

  const preview = buildSchedulerIntentPreview(trimmed, departments);
  if (!preview.schedule) {
    return {
      success: false,
      action: 'needs_decision',
      message: '我识别到你想创建定时任务，但还缺少明确的触发周期。请补充例如“每天 9 点”“每周一 10 点”或“明天上午 9 点”。',
    };
  }

  if (!preview.actionDraft) {
    return {
      success: false,
      action: 'needs_decision',
      message: preview.error || '当前无法确定定时任务的目标对象。',
      suggestions: preview.suggestions,
    };
  }

  const scheduleSpec = preview.schedule;
  const actionDraft = preview.actionDraft;
  const name = preview.jobName || `${actionDraft.label} · ${scheduleSpec.label}`;
  const job = createScheduledJob({
    name,
    type: scheduleSpec.type,
    ...(scheduleSpec.type === 'cron' ? { cronExpression: scheduleSpec.cronExpression } : {}),
    ...(scheduleSpec.type === 'interval' ? { intervalMs: scheduleSpec.intervalMs } : {}),
    ...(scheduleSpec.type === 'once' ? { scheduledAt: scheduleSpec.scheduledAt } : {}),
    enabled: true,
    createdBy: 'ceo-command',
    intentSummary: trimmed,
    action: actionDraft.kind === 'health-check'
      ? {
          kind: 'health-check',
          projectId: actionDraft.projectId,
        }
      : actionDraft.kind === 'dispatch-pipeline'
      ? {
          kind: 'dispatch-pipeline',
          workspace: actionDraft.workspace,
          prompt: actionDraft.prompt,
          templateId: actionDraft.templateId,
          ...(actionDraft.stageId ? { stageId: actionDraft.stageId } : {}),
          ...(actionDraft.projectId ? { projectId: actionDraft.projectId } : {}),
        }
      : {
          kind: 'create-project',
        },
    ...(actionDraft.kind === 'create-project'
      ? {
          departmentWorkspaceUri: actionDraft.departmentWorkspaceUri,
          opcAction: {
            type: 'create_project' as const,
            projectType: 'adhoc' as const,
            goal: actionDraft.goal,
            ...(actionDraft.skillHint ? { skillHint: actionDraft.skillHint } : {}),
          },
        }
      : {}),
  });

  return {
    success: true,
    action: 'create_scheduler_job',
    jobId: job.jobId,
    nextRunAt: getNextRunAt(job),
    message: `已创建定时任务“${job.name}”。下一次执行时间：${getNextRunAt(job) || '待计算'}。当前系统共有 ${listScheduledJobs().length} 个定时任务。`,
  };
}