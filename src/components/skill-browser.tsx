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
      </div>
      {Array.from(grouped.entries()).map(([category, categorySkills]) => (
        <div key={category} className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/40">
            <span>{getSkillCategoryIcon(category)}</span>
            <span className="uppercase tracking-wider">{category}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {categorySkills.map((skill) => (
              <div
                key={skill.skillId}
                className="flex flex-col gap-1 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 min-w-[120px] max-w-[180px]"
              >
                <span className="text-[12px] font-medium text-white/70 truncate">
                  {skill.name}
                </span>
                {skill.difficulty && (
                  <span className={cn(
                    'self-start rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                    difficultyColors[skill.difficulty] || 'bg-white/5 text-white/40',
                  )}>
                    {skill.difficulty}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
