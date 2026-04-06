/**
 * CEO Agent — System Prompts & Context Builder (Phase 6: LLM Decision Mode)
 *
 * Builds the context payload (departments + templates + load) and
 * the system prompt for the AI CEO agent to make dispatch decisions.
 */

import { listProjects } from './project-registry';
import { AssetLoader } from './asset-loader';
import type { DepartmentConfig } from '../types';

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface TemplateSummary {
  id: string;
  title: string;
  description: string;
  stageCount: number;
  groupSummaries: string[];   // e.g. ["product-spec: 产品规格", "architecture-advisory: 架构顾问"]
  hasFanOut: boolean;
  hasGate: boolean;
  hasLoop: boolean;
}

export interface DepartmentSummary {
  workspaceUri: string;
  name: string;
  type: string;
  description?: string;
  templateIds?: string[];     // templates assigned to this department
  skills: Array<{ name: string; category: string }>;
  activeProjects: number;
  completedProjects: number;
  failedProjects: number;
  loadLevel: 'low' | 'medium' | 'high';
}

export interface CompanyContext {
  departments: DepartmentSummary[];
  allTemplates: TemplateSummary[];
  totalProjects: number;
  activeProjects: number;
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

/**
 * Build a CompanyContext snapshot from current state.
 * Includes all departments, their load, AND all available templates.
 */
export function buildCompanyContext(
  departments: Map<string, DepartmentConfig>,
): CompanyContext {
  const allProjects = listProjects();
  const deptEntries: DepartmentSummary[] = [];

  for (const [uri, config] of departments) {
    const wsProjects = allProjects.filter(p => p.workspace === uri);
    const active = wsProjects.filter(p => p.status === 'active').length;
    const completed = wsProjects.filter(p => p.status === 'completed').length;
    const failed = wsProjects.filter(p => p.status === 'failed').length;

    deptEntries.push({
      workspaceUri: uri,
      name: config.name,
      type: config.type,
      ...(config.description ? { description: config.description } : {}),
      ...(config.templateIds?.length ? { templateIds: config.templateIds } : {}),
      skills: config.skills.map(s => ({
        name: s.name,
        category: s.category,
      })),
      activeProjects: active,
      completedProjects: completed,
      failedProjects: failed,
      loadLevel: active >= 5 ? 'high' : active >= 2 ? 'medium' : 'low',
    });
  }

  // Build template summaries
  const templates = AssetLoader.loadAllTemplates();
  const templateSummaries: TemplateSummary[] = templates.map(t => {
    const stageSummaries = (t.graphPipeline?.nodes ?? t.pipeline ?? []).map(
      (stage: any) => {
        const stageId = 'id' in stage ? stage.id : stage.stageId;
        return `${stageId}: ${stage.title || stage.label || stage.description || stageId}`;
      },
    );

    let stageCount = 0;
    let hasFanOut = false;
    let hasGate = false;
    let hasLoop = false;

    if (t.graphPipeline?.nodes) {
      stageCount = t.graphPipeline.nodes.length;
      hasFanOut = t.graphPipeline.nodes.some((n: any) => n.kind === 'fan-out');
      hasGate = t.graphPipeline.nodes.some((n: any) => n.kind === 'gate');
      hasLoop = t.graphPipeline.nodes.some((n: any) => n.kind === 'loop-start');
    } else if (t.pipeline) {
      stageCount = t.pipeline.length;
      hasFanOut = t.pipeline.some((s: any) => s.stageType === 'fan-out' || s.fanOutSource);
    }

    return {
      id: t.id,
      title: t.title || t.id,
      description: t.description || '',
      stageCount,
      groupSummaries: stageSummaries,
      hasFanOut,
      hasGate,
      hasLoop,
    };
  });

  return {
    departments: deptEntries,
    allTemplates: templateSummaries,
    totalProjects: allProjects.length,
    activeProjects: allProjects.filter(p => p.status === 'active').length,
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Generate the system prompt for the AI CEO agent.
 * The LLM will analyze the command, departments, and templates,
 * then return a structured JSON decision.
 */
export function buildCEOSystemPrompt(context: CompanyContext): string {
  // Departments section
  const deptList = context.departments.map(d => {
    const skills = d.skills.map(s => s.name).join(', ') || '无';
    const templates = d.templateIds?.join(', ') || '无';
    return `  - ${d.name}（${d.type}）
    工作区: ${d.workspaceUri}
    简介: ${d.description || '无'}
    技能: ${skills}
    已关联模板: ${templates}
    负载: ${d.loadLevel}（${d.activeProjects} 活跃 / ${d.completedProjects} 完成 / ${d.failedProjects} 失败）`;
  }).join('\n');

  // Templates section
  const tplList = context.allTemplates.map(t => {
    const features = [
      t.hasFanOut ? '并行' : null,
      t.hasGate ? '审批关卡' : null,
      t.hasLoop ? '迭代' : null,
    ].filter(Boolean).join(', ');
    return `  - ${t.id}: "${t.title}" — ${t.description || '无描述'}
    阶段数: ${t.stageCount} ${features ? `（${features}）` : ''}
    包含角色: ${t.groupSummaries.join('; ') || '无'}`;
  }).join('\n');

  return `你是一家 AI 公司的 CEO Agent。人类 CEO 会向你下达自然语言指令，你需要分析指令并做出派发决策。

## 公司现状
- 共 ${context.totalProjects} 个项目，${context.activeProjects} 个活跃

### 部门列表
${deptList || '（暂无部门）'}

### 可用模板列表
${tplList || '（暂无模板）'}

## 你的决策权限

你必须返回一个 JSON 对象，action 为以下 5 种之一：

### 1. dispatch — 直接派发任务
当部门和模板都已匹配时使用。
\`\`\`json
{
  "action": "dispatch",
  "workspace": "<workspaceUri>",
  "templateId": "<template-id>",
  "projectName": "<项目名称（简短）>",
  "goal": "<任务目标描述>",
  "priority": "normal|urgent|high|low",
  "model": "<可选模型ID>",
  "reasoning": "<决策理由>"
}
\`\`\`

### 2. suggest_add_template — 建议为某部门添加现有模板
当任务适合某个部门执行，但该部门尚未关联任何合适的模板，而全局模板列表中存在合适模板时使用。
\`\`\`json
{
  "action": "suggest_add_template",
  "workspace": "<workspaceUri>",
  "templateId": "<建议添加的template-id>",
  "departmentName": "<部门名称>",
  "projectName": "<项目名称>",
  "goal": "<任务目标>",
  "reasoning": "<为什么建议添加这个模板>"
}
\`\`\`

### 3. create_template — 需要创建新模板
当现有模板都不适合时使用。需要用户审批后才能继续。
\`\`\`json
{
  "action": "create_template",
  "workspace": "<workspaceUri>",
  "departmentName": "<部门名称>",
  "projectName": "<项目名称>",
  "goal": "<任务目标>",
  "templateGoal": "<对新模板的设计需求描述>",
  "reasoning": "<为什么现有模板不适合>"
}
\`\`\`

### 4. report_to_human — 无法自动处理
当指令不明确、没有合适的部门、或需要人类决策时使用。
\`\`\`json
{
  "action": "report_to_human",
  "reportTitle": "<标题>",
  "reportDescription": "<详细说明>",
  "reasoning": "<为什么无法自动处理>"
}
\`\`\`

### 5. multi_dispatch — 跨部门协作
当任务需要多个部门同时参与时使用。
\`\`\`json
{
  "action": "multi_dispatch",
  "dispatches": [
    { "workspace": "<workspaceUri1>", "templateId": "<template-id1>" },
    { "workspace": "<workspaceUri2>", "templateId": "<template-id2>" }
  ],
  "projectName": "<项目名称>",
  "goal": "<任务目标>",
  "reasoning": "<为什么需要多部门协作>"
}
\`\`\`

## 决策优先级

1. **优先选择部门已关联的模板**：如果部门的 templateIds 中有适合的，直接 dispatch。
2. **其次看全局模板**：如果全局模板中有合适的但部门没关联，使用 suggest_add_template。
3. **最后创建新模板**：只有当确实没有合适模板时才用 create_template。
4. **部门选择**：根据部门的 type、skills、description 语义匹配任务内容。
5. **负载控制**：如果部门 loadLevel 为 high（5+ 活跃任务），优先选择低负载部门，除非用户明确指定。
6. **模型选择**：除非用户明确提到模型名称，否则不要设置 model 字段。

## 约束
- 如果用户明确指定了部门名称（如"让研发部做..."），必须路由到该部门
- 如果没有任何部门注册，使用 report_to_human
- 不要编造不存在的部门或模板 ID
- projectName 应简短（不超过 20 个字），从指令中提取核心主题

## 输出格式
只返回一个有效的 JSON 对象，不要包含任何其他文本、解释或 markdown 标记。`;
}
