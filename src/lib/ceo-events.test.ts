import { describe, it, expect } from 'vitest';
import { generateCEOEvents } from './ceo-events';
import type { Project, PipelineStageProgressFE } from './types';

describe('generateCEOEvents', () => {
  it('generates critical event for pending gate', () => {
    const stages = [{
      stageId: 'g1', status: 'pending', stageIndex: 0, attempts: 1,
      nodeKind: 'gate', gateApproval: { status: 'pending' },
    }] as PipelineStageProgressFE[];
    const events = generateCEOEvents([], stages);
    expect(events[0].type).toBe('critical');
    expect(events[0].title).toBe('Gate 待审批');
  });

  it('sorts events by priority (critical first)', () => {
    const projects = [{
      projectId: 'p1', name: 'Done', status: 'completed',
      updatedAt: new Date().toISOString(), goal: '', createdAt: '', runIds: [],
    }] as Project[];
    const stages = [{
      stageId: 'g1', status: 'pending', stageIndex: 0, attempts: 1,
      nodeKind: 'gate', gateApproval: { status: 'pending' },
    }] as PipelineStageProgressFE[];
    const events = generateCEOEvents(projects, stages);
    expect(events[0].type).toBe('critical');
  });

  it('returns empty array when no projects or stages', () => {
    expect(generateCEOEvents([], [])).toEqual([]);
  });

  it('generates warning for overdue project', () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const projects = [{
      projectId: 'p1', name: 'Old Project', status: 'active',
      updatedAt: oldDate, goal: '', createdAt: oldDate, runIds: [],
    }] as Project[];
    const events = generateCEOEvents(projects, []);
    expect(events.some(e => e.type === 'warning' && e.title.includes('超时'))).toBe(true);
  });
});
