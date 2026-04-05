import type { DepartmentSkill } from './types';

const categoryIcons: Record<string, string> = {
  engineering: '⚙️',
  product: '📋',
  design: '🎨',
  research: '🔍',
  testing: '🧪',
  operations: '📊',
};

export function getSkillCategoryIcon(category: string): string {
  return categoryIcons[category.toLowerCase()] || '📦';
}

export function groupSkillsByCategory(skills: DepartmentSkill[]): Map<string, DepartmentSkill[]> {
  const map = new Map<string, DepartmentSkill[]>();
  for (const skill of skills) {
    const list = map.get(skill.category) || [];
    list.push(skill);
    map.set(skill.category, list);
  }
  return map;
}
