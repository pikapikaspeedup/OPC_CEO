'use client';

import { useMemo, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Building2,
  CheckCircle2,
  FolderKanban,
  MessageSquare,
  Settings2,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AgentRun, Project } from '@/lib/types';
import { isAgentRunActive } from '@/lib/agent-run-utils';
import type { AppShellSection } from '@/lib/home-shell';

interface HomeOverviewProps {
  projects: Project[];
  agentRuns: AgentRun[];
  pendingApprovals: number;
  totalDepartmentCount: number;
  configuredDepartmentCount: number;
  onOpenSection: (section: Exclude<AppShellSection, 'overview'>) => void;
  onOpenProject: (projectId: string) => void;
  onOpenSetup: () => void;
  onOpenSettings: () => void;
}

type EntryCard = {
  key: string;
  title: string;
  body: string;
  accent: string;
  icon: ReactNode;
  onClick: () => void;
};

export default function HomeOverview({
  projects,
  agentRuns,
  pendingApprovals,
  totalDepartmentCount,
  configuredDepartmentCount,
  onOpenSection,
  onOpenProject,
  onOpenSetup,
  onOpenSettings,
}: HomeOverviewProps) {
  const activeRuns = useMemo(
    () => agentRuns.filter((run) => isAgentRunActive(run.status)).slice(0, 4),
    [agentRuns],
  );
  const activeProjectCount = useMemo(
    () => projects.filter((project) => project.status === 'active').length,
    [projects],
  );
  const failedProjectCount = useMemo(
    () => projects.filter((project) => project.status === 'failed').length,
    [projects],
  );
  const recentProjects = useMemo(
    () => [...projects].sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )).slice(0, 4),
    [projects],
  );
  const departmentsReady = totalDepartmentCount > 0 && configuredDepartmentCount >= totalDepartmentCount;

  const entryCards: EntryCard[] = [
    {
      key: 'ceo',
      title: 'CEO Office',
      body: '审批、决策、模板和公司级控制入口。',
      accent: 'from-amber-400/18 to-amber-500/5',
      icon: <Bot className="h-4 w-4" />,
      onClick: () => onOpenSection('ceo'),
    },
    {
      key: 'projects',
      title: 'OPC',
      body: '进入项目工作台、项目树和执行链路。',
      accent: 'from-sky-400/18 to-sky-500/5',
      icon: <FolderKanban className="h-4 w-4" />,
      onClick: () => onOpenSection('projects'),
    },
    {
      key: 'conversations',
      title: 'Chats',
      body: '按工作区开始或继续普通对话。',
      accent: 'from-emerald-400/18 to-emerald-500/5',
      icon: <MessageSquare className="h-4 w-4" />,
      onClick: () => onOpenSection('conversations'),
    },
    {
      key: 'knowledge',
      title: 'Knowledge',
      body: '查看知识沉淀、产物和部门记忆。',
      accent: 'from-violet-400/18 to-violet-500/5',
      icon: <BookOpen className="h-4 w-4" />,
      onClick: () => onOpenSection('knowledge'),
    },
    {
      key: 'operations',
      title: 'Ops',
      body: '调度器、MCP、配额和系统运行态。',
      accent: 'from-cyan-400/18 to-cyan-500/5',
      icon: <Wrench className="h-4 w-4" />,
      onClick: () => onOpenSection('operations'),
    },
    {
      key: 'settings',
      title: 'Settings',
      body: 'Profile、Provider、API keys 和系统配置。',
      accent: 'from-white/14 to-white/[0.03]',
      icon: <Settings2 className="h-4 w-4" />,
      onClick: onOpenSettings,
    },
  ];

  return (
    <div className="app-shell-stage relative flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 agent-grid opacity-20" />
      <div className="relative mx-auto flex h-full w-full max-w-[1560px] flex-col gap-6 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
        <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(135deg,rgba(16,26,42,0.88),rgba(10,17,28,0.96))] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Company Home</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">首页先做入口分流，不再直接充当超级工作台。</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/60">
                从这里先决定你现在要做的是配置公司、继续项目、进入 CEO 决策、开始普通对话，还是进入 Ops。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px] xl:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Active Runs</div>
                <div className="mt-2 text-2xl font-semibold text-white">{activeRuns.length}</div>
                <div className="mt-1 text-xs text-white/45">当前仍在执行的任务</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Approvals</div>
                <div className="mt-2 text-2xl font-semibold text-white">{pendingApprovals}</div>
                <div className="mt-1 text-xs text-white/45">待审批的系统信号</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Projects</div>
                <div className="mt-2 text-2xl font-semibold text-white">{activeProjectCount}</div>
                <div className="mt-1 text-xs text-white/45">进行中的项目</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Departments</div>
                <div className="mt-2 text-2xl font-semibold text-white">{configuredDepartmentCount}/{totalDepartmentCount}</div>
                <div className="mt-1 text-xs text-white/45">已完成初始化的部门</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {entryCards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={cn(
                'group rounded-[28px] border border-white/8 bg-[linear-gradient(140deg,rgba(14,21,34,0.92),rgba(8,14,24,0.98))] p-5 text-left transition-all hover:border-white/14 hover:bg-white/[0.04]',
                'shadow-[0_18px_56px_rgba(0,0,0,0.2)]',
              )}
              onClick={card.onClick}
            >
              <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br text-white', card.accent)}>
                {card.icon}
              </div>
              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{card.title}</div>
                  <div className="mt-2 text-sm leading-6 text-white/55">{card.body}</div>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-white/35 transition-transform group-hover:translate-x-0.5 group-hover:text-white/70" />
              </div>
            </button>
          ))}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,24,36,0.78),rgba(10,16,26,0.94))] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Setup Status</div>
                <div className="mt-2 text-xl font-semibold text-white">
                  {departmentsReady ? '公司初始化已完成' : '仍有部门初始化缺口'}
                </div>
              </div>
              {departmentsReady ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-amber-300" />
              )}
            </div>
            <div className="mt-3 text-sm leading-6 text-white/60">
              {departmentsReady
                ? '首页保留 setup 状态展示，但不再用一次性弹层充当唯一入口。'
                : `目前已配置 ${configuredDepartmentCount} / ${totalDepartmentCount} 个部门。继续完成设置后，CEO 才能更稳定地匹配部门和工作流。`}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {!departmentsReady ? (
                <Button onClick={onOpenSetup} className="rounded-full">
                  继续完成设置
                </Button>
              ) : (
                <Button variant="outline" onClick={() => onOpenSection('projects')} className="rounded-full border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.08] hover:text-white">
                  打开 OPC
                </Button>
              )}
              <Button
                variant="outline"
                onClick={onOpenSettings}
                className="rounded-full border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.08] hover:text-white"
              >
                打开 Settings
              </Button>
            </div>
            {failedProjectCount > 0 ? (
              <div className="mt-4 rounded-2xl border border-red-500/18 bg-red-500/[0.06] px-4 py-3 text-sm text-red-100/85">
                当前仍有 {failedProjectCount} 个失败项目，建议优先回到 OPC 处理。
              </div>
            ) : null}
          </section>

          <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,24,36,0.78),rgba(10,16,26,0.94))] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Continue Work</div>
                <div className="mt-2 text-xl font-semibold text-white">把继续工作入口显性化</div>
              </div>
              <Building2 className="h-5 w-5 text-white/35" />
            </div>
            <div className="mt-4 space-y-3">
              {activeRuns.length > 0 ? activeRuns.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  className="flex w-full items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.05]"
                  onClick={() => {
                    if (run.projectId) {
                      onOpenProject(run.projectId);
                      return;
                    }
                    onOpenSection('conversations');
                  }}
                >
                  <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-sky-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{run.prompt || run.stageId || run.runId}</div>
                    <div className="mt-1 text-xs leading-5 text-white/45">
                      {run.projectId ? `继续项目 ${run.projectId}` : '继续普通对话'} · {run.status}
                    </div>
                  </div>
                </button>
              )) : null}

              {recentProjects.length > 0 ? recentProjects.map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  className="flex w-full items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-left transition-colors hover:bg-white/[0.05]"
                  onClick={() => onOpenProject(project.projectId)}
                >
                  <FolderKanban className="mt-0.5 h-4 w-4 shrink-0 text-violet-300/85" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{project.name}</div>
                    <div className="mt-1 text-xs leading-5 text-white/45">{project.status} · {project.goal || 'Project workbench'}</div>
                  </div>
                </button>
              )) : null}

              {!activeRuns.length && !recentProjects.length ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/45">
                  还没有可继续的任务。可以先完成 setup，或直接进入 CEO / OPC / Chats。
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
