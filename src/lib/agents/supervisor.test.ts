import { describe, it, expect } from 'vitest';
import { summarizeStepForSupervisor } from './supervisor';

describe('summarizeStepForSupervisor', () => {
  it('summarizes CODE_ACTION create', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_CODE_ACTION',
      codeAction: { actionSpec: { createFile: { absoluteUri: '/repo/src/index.ts' } } },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[CODE_ACTION] create index.ts');
  });

  it('summarizes CODE_ACTION edit', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_CODE_ACTION',
      codeAction: { actionSpec: { editFile: { absoluteUri: '/repo/src/utils.ts' } } },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[CODE_ACTION] edit utils.ts');
  });

  it('summarizes CODE_ACTION delete', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_CODE_ACTION',
      codeAction: { actionSpec: { deleteFile: { absoluteUri: '/repo/old.ts' } } },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[CODE_ACTION] delete old.ts');
  });

  it('summarizes VIEW_FILE', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_VIEW_FILE',
      viewFile: { absoluteUri: '/repo/README.md' },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[VIEW_FILE] README.md');
  });

  it('summarizes GREP_SEARCH', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_GREP_SEARCH',
      grepSearch: { query: 'TODO' },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[GREP_SEARCH] "TODO"');
  });

  it('summarizes GREP_SEARCH with searchPattern fallback', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_GREP_SEARCH',
      grepSearch: { searchPattern: 'FIXME' },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[GREP_SEARCH] "FIXME"');
  });

  it('summarizes RUN_COMMAND with truncation', () => {
    const longCmd = 'npm run build -- --verbose --production ' + 'x'.repeat(100);
    const step = {
      type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
      runCommand: { command: longCmd },
    };
    const result = summarizeStepForSupervisor(step);
    expect(result).toContain('[RUN_COMMAND]');
    expect(result.length).toBeLessThanOrEqual('[RUN_COMMAND] '.length + 80);
  });

  it('summarizes SEARCH_WEB', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_SEARCH_WEB',
      searchWeb: { query: 'vitest mock esm' },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[SEARCH_WEB] "vitest mock esm"');
  });

  it('summarizes FIND', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_FIND',
      find: { pattern: '*.ts', searchDirectory: '/repo/src' },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[FIND] pattern="*.ts" in src');
  });

  it('summarizes LIST_DIRECTORY', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_LIST_DIRECTORY',
      listDirectory: { path: '/repo/src/lib' },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[LIST_DIR] lib');
  });

  it('summarizes PLANNER_RESPONSE with truncation', () => {
    const longText = 'A'.repeat(200);
    const step = {
      type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
      plannerResponse: { modifiedResponse: longText },
    };
    const result = summarizeStepForSupervisor(step);
    expect(result).toContain('[PLANNER_RESPONSE]');
    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual('[PLANNER_RESPONSE] '.length + 120 + 3);
  });

  it('summarizes USER_INPUT', () => {
    const step = { type: 'CORTEX_STEP_TYPE_USER_INPUT' };
    expect(summarizeStepForSupervisor(step)).toBe('[USER_INPUT]');
  });

  it('summarizes ERROR_MESSAGE', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
      errorMessage: { message: 'Module not found' },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[ERROR] Module not found');
  });

  it('handles unknown step type', () => {
    const step = { type: 'CORTEX_STEP_TYPE_CUSTOM_THING' };
    expect(summarizeStepForSupervisor(step)).toBe('[CUSTOM_THING]');
  });

  it('handles empty step', () => {
    expect(summarizeStepForSupervisor({})).toBe('[]');
  });

  it('handles CODE_ACTION with no files', () => {
    const step = {
      type: 'CORTEX_STEP_TYPE_CODE_ACTION',
      codeAction: { actionSpec: {} },
    };
    expect(summarizeStepForSupervisor(step)).toBe('[CODE_ACTION] edit ?');
  });
});
