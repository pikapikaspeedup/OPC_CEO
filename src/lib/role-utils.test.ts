import { describe, it, expect } from 'vitest';
import { resolveRoleAvatar, resolveRoleDisplayName, resolveRoleStatusText, hashRoleToName, resolveCharacterName } from './role-utils';

describe('resolveRoleAvatar', () => {
  it.each([
    ['pm', '📋'], ['product_manager', '📋'],
    ['developer', '💻'], ['senior_engineer', '💻'],
    ['qa', '🧪'], ['test_lead', '🧪'],
    ['designer', '🎨'], ['ui_ux', '🎨'],
    ['architect', '👔'], ['lead_reviewer', '👔'],
    ['researcher', '🔍'], ['analyst', '🔍'],
    ['devops', '⚙️'], ['ops_monitor', '⚙️'],
    ['production_monitor', '⚙️'],
    ['unknown_xyz', '🤖'],
  ])('maps %s → %s', (roleKey, expected) => {
    expect(resolveRoleAvatar(roleKey)).toBe(expected);
  });
});

describe('resolveRoleDisplayName', () => {
  it.each([
    ['developer', 'Developer'],
    ['senior_developer', 'Senior Developer'],
    ['qaLead', 'Qa Lead'],
    ['pm', 'Pm'],
  ])('formats %s → %s', (input, expected) => {
    expect(resolveRoleDisplayName(input)).toBe(expected);
  });
});

describe('resolveRoleStatusText', () => {
  it('returns short status text without stageTitle', () => {
    expect(resolveRoleStatusText('running', 'zh')).toBe('工作中...');
    expect(resolveRoleStatusText('completed', 'en')).toBe('Done');
  });

  it('returns stage-aware text when WithStage key exists', () => {
    expect(resolveRoleStatusText('running', 'zh', '需求评审')).toBe('正在需求评审...');
    expect(resolveRoleStatusText('completed', 'en', 'Code Review')).toBe('Code Review done');
  });

  it('falls back to short key when WithStage key does not exist', () => {
    expect(resolveRoleStatusText('pending', 'zh', '需求评审')).toBe('等待中');
    expect(resolveRoleStatusText('blocked', 'en', 'Deploy')).toBe('Blocked');
  });

  it('returns raw key for unknown status', () => {
    expect(resolveRoleStatusText('unknown_status', 'zh')).toBe('role.status.unknown_status');
  });
});

describe('hashRoleToName', () => {
  it('returns a name from the pool', () => {
    const name = hashRoleToName('developer');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('is deterministic — same input always gives same output', () => {
    expect(hashRoleToName('pm')).toBe(hashRoleToName('pm'));
    expect(hashRoleToName('qa_lead')).toBe(hashRoleToName('qa_lead'));
  });

  it('different roleIds give different names (high probability)', () => {
    const names = new Set(['developer', 'designer', 'pm', 'qa', 'devops', 'researcher', 'architect', 'writer'].map(r => hashRoleToName(r)));
    // With 8 distinct roles and 20 names, collision chance is low
    expect(names.size).toBeGreaterThan(1);
  });

  it('salt changes the result', () => {
    const withoutSalt = hashRoleToName('pm');
    const withSalt = hashRoleToName('pm', '/workspace/project-a');
    const withOtherSalt = hashRoleToName('pm', '/workspace/project-b');
    // At least one salt variant should differ
    expect([withSalt, withOtherSalt].some(n => n !== withoutSalt || withSalt !== withOtherSalt)).toBe(true);
  });

  it('returns a Chinese name (CJK characters)', () => {
    const name = hashRoleToName('developer');
    expect(/^[\u4e00-\u9fff\u3400-\u4dbf]+$/.test(name)).toBe(true);
  });
});

describe('resolveCharacterName', () => {
  it('falls back to hashRoleToName when no roster', () => {
    expect(resolveCharacterName('developer')).toBe(hashRoleToName('developer'));
    expect(resolveCharacterName('pm', '/ws/a')).toBe(hashRoleToName('pm', '/ws/a'));
  });

  it('returns roster displayName when pattern matches', () => {
    const roster = [
      { rolePattern: 'pm|product', displayName: '张三', title: '产品经理' },
      { rolePattern: 'dev|engineer', displayName: '李四' },
    ];
    expect(resolveCharacterName('pm', undefined, roster)).toBe('张三');
    expect(resolveCharacterName('product_manager', undefined, roster)).toBe('张三');
    expect(resolveCharacterName('developer', undefined, roster)).toBe('李四');
    expect(resolveCharacterName('senior_engineer', undefined, roster)).toBe('李四');
  });

  it('falls back to hash when no roster pattern matches', () => {
    const roster = [{ rolePattern: 'pm', displayName: '张三' }];
    expect(resolveCharacterName('qa_lead', '/ws', roster)).toBe(hashRoleToName('qa_lead', '/ws'));
  });

  it('skips invalid regex patterns and continues to next entry', () => {
    const roster = [
      { rolePattern: '[invalid(regex', displayName: '错误' },
      { rolePattern: 'pm', displayName: '张三' },
    ];
    expect(resolveCharacterName('pm', undefined, roster)).toBe('张三');
  });

  it('is case-insensitive for roster pattern matching', () => {
    const roster = [{ rolePattern: 'PM', displayName: '张三' }];
    expect(resolveCharacterName('pm', undefined, roster)).toBe('张三');
    expect(resolveCharacterName('PM_Lead', undefined, roster)).toBe('张三');
  });
});
