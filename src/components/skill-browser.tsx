'use client';

import type { DepartmentSkill } from '@/lib/types';
import { getSkillCategoryIcon, groupSkillsByCategory } from '@/lib/skill-utils';
import { cn } from '@/lib/utils';

interface SkillBrowserProps {
  skills: DepartmentSkill[];
}

const difficultyColors: Record<string, string> = {
  junior: 'bg-emerald-500/15 text-emerald-400',
  mid: 'bg-sky-500/15 text-sky-400',
  senior: 'bg-amber-500/15 text-amber-400',
};

function normalizeWorkflowRef(workflowRef?: string): string {
  const trimmed = workflowRef?.trim() || '';
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export default function SkillBrowser({ skills }: SkillBrowserProps) {
  if (skills.length === 0) {
    return (
      <div className="text-center text-sm text-white/30 py-6">
        暂无技能定义
      </div>
    );
  }

  const grouped = groupSkillsByCategory(skills);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/40">
        <span>🛠</span>
        <span>Skills</span>
        <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-white/35">
          skill → workflowRef → skillRefs
        </span>
      </div>
      {Array.from(grouped.entries()).map(([category, categorySkills]) => (
        <div key={category} className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/40">
            <span>{getSkillCategoryIcon(category)}</span>
            <span className="uppercase tracking-wider">{category}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {categorySkills.map((skill) => (
              <div
                key={skill.skillId}
                className="space-y-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-white/80 truncate">
                      {skill.name}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-medium text-white/45">
                        {skill.category}
                      </span>
                      {skill.deliverableSpec?.format && (
                        <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-medium text-white/45">
                          {skill.deliverableSpec.format}
                        </span>
                      )}
                    </div>
                  </div>
                  {skill.difficulty && (
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize',
                      difficultyColors[skill.difficulty] || 'bg-white/5 text-white/40',
                    )}>
                      {skill.difficulty}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/28">Execution order</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/60">
                      skill
                    </span>
                    <span className="text-white/20">→</span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px]',
                        skill.workflowRef
                          ? 'border-sky-500/25 bg-sky-500/10 text-sky-200'
                          : 'border-white/8 bg-white/[0.02] text-white/35',
                      )}
                      title={skill.workflowRef ? normalizeWorkflowRef(skill.workflowRef) : '未绑定 workflow'}
                    >
                      {skill.workflowRef ? `workflow: ${normalizeWorkflowRef(skill.workflowRef)}` : 'workflow: none'}
                    </span>
                    <span className="text-white/20">→</span>
                    {skill.skillRefs?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {skill.skillRefs.map(ref => (
                          <span
                            key={ref}
                            className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/55"
                            title={ref}
                          >
                            {ref}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="rounded-full border border-white/8 bg-white/[0.02] px-2 py-0.5 text-[10px] text-white/35">
                        fallback: none
                      </span>
                    )}
                  </div>
                </div>

                {skill.deliverableSpec?.qualityCriteria?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {skill.deliverableSpec.qualityCriteria.slice(0, 3).map((criterion) => (
                      <span
                        key={criterion}
                        className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/40"
                        title={criterion}
                      >
                        {criterion}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
