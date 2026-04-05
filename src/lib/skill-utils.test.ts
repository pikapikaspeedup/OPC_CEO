import { describe, it, expect } from 'vitest';
import { getSkillCategoryIcon, groupSkillsByCategory } from './skill-utils';

describe('getSkillCategoryIcon', () => {
  it.each([
    ['engineering', '⚙️'],
    ['product', '📋'],
    ['design', '🎨'],
    ['unknown', '📦'],
  ])('maps %s → %s', (category, icon) => {
    expect(getSkillCategoryIcon(category)).toBe(icon);
  });
});

describe('groupSkillsByCategory', () => {
  it('groups skills correctly', () => {
    const skills = [
      { skillId: '1', name: 'A', category: 'engineering', workflowRef: '' },
      { skillId: '2', name: 'B', category: 'design', workflowRef: '' },
      { skillId: '3', name: 'C', category: 'engineering', workflowRef: '' },
    ];
    const grouped = groupSkillsByCategory(skills);
    expect(grouped.get('engineering')?.length).toBe(2);
    expect(grouped.get('design')?.length).toBe(1);
  });

  it('handles empty array', () => {
    expect(groupSkillsByCategory([]).size).toBe(0);
  });
});
