import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getResultJsonCandidates,
  tryReadResultJson,
  compactCodingResult,
} from './result-parser';
import type { GroupRoleDefinition } from './group-types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-parser-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getResultJsonCandidates
// ---------------------------------------------------------------------------

describe('getResultJsonCandidates', () => {
  it('returns only root result.json when no role config', () => {
    const candidates = getResultJsonCandidates('/tmp/artifacts');
    expect(candidates).toEqual([path.join('/tmp/artifacts', 'result.json')]);
  });

  it('returns architecture path first for architect-author role', () => {
    const role = { id: 'architecture-author' } as GroupRoleDefinition;
    const candidates = getResultJsonCandidates('/tmp/artifacts', role);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe(path.join('/tmp/artifacts', 'architecture', 'result.json'));
    expect(candidates[1]).toBe(path.join('/tmp/artifacts', 'result.json'));
  });

  it('returns specs path first for spec-author role', () => {
    const role = { id: 'spec-author' } as GroupRoleDefinition;
    const candidates = getResultJsonCandidates('/tmp/artifacts', role);
    expect(candidates[0]).toBe(path.join('/tmp/artifacts', 'specs', 'result.json'));
  });

  it('deduplicates candidates', () => {
    const role = { id: 'reviewer-role' } as GroupRoleDefinition;
    const candidates = getResultJsonCandidates('/tmp/artifacts', role);
    expect(candidates).toEqual([path.join('/tmp/artifacts', 'result.json')]);
  });
});

// ---------------------------------------------------------------------------
// tryReadResultJson
// ---------------------------------------------------------------------------

describe('tryReadResultJson', () => {
  it('reads a valid result.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'result.json'), JSON.stringify({
      status: 'completed',
      summary: 'All done',
      changedFiles: ['src/a.ts'],
    }));
    const result = tryReadResultJson(tmpDir);
    expect(result).toBeDefined();
    expect(result!.status).toBe('completed');
    expect(result!.summary).toBe('All done');
    expect(result!.changedFiles).toEqual(['src/a.ts']);
  });

  it('reads blocked result with blockedReason', () => {
    fs.writeFileSync(path.join(tmpDir, 'result.json'), JSON.stringify({
      status: 'blocked',
      summary: 'Needs approval',
      blockedReason: 'Missing credentials',
    }));
    const result = tryReadResultJson(tmpDir);
    expect(result!.status).toBe('blocked');
    expect(result!.blockers).toEqual(['Missing credentials']);
  });

  it('returns null when file does not exist', () => {
    const result = tryReadResultJson(tmpDir);
    expect(result).toBeNull();
  });

  it('skips result.json with missing required fields', () => {
    fs.writeFileSync(path.join(tmpDir, 'result.json'), JSON.stringify({
      status: 'completed',
      // missing summary
    }));
    const result = tryReadResultJson(tmpDir);
    expect(result).toBeNull();
  });

  it('falls back to completed for unknown status', () => {
    fs.writeFileSync(path.join(tmpDir, 'result.json'), JSON.stringify({
      status: 'weird-status',
      summary: 'Something happened',
    }));
    const result = tryReadResultJson(tmpDir);
    expect(result!.status).toBe('completed');
  });

  it('handles malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'result.json'), 'not json{{{');
    const result = tryReadResultJson(tmpDir);
    expect(result).toBeNull();
  });

  it('prefers architecture subdir for architect-author role', () => {
    const archDir = path.join(tmpDir, 'architecture');
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, 'result.json'), JSON.stringify({
      status: 'completed',
      summary: 'Architecture done',
    }));
    fs.writeFileSync(path.join(tmpDir, 'result.json'), JSON.stringify({
      status: 'completed',
      summary: 'Root done',
    }));
    const role = { id: 'architecture-author' } as GroupRoleDefinition;
    const result = tryReadResultJson(tmpDir, role);
    expect(result!.summary).toBe('Architecture done');
  });
});

// ---------------------------------------------------------------------------
// compactCodingResult
// ---------------------------------------------------------------------------

describe('compactCodingResult', () => {
  it('returns completed with summary from DONE planner response', () => {
    const steps = [
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          status: 'DONE',
          modifiedResponse: 'Task completed successfully',
        },
      },
    ];
    const result = compactCodingResult(steps);
    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Task completed successfully');
  });

  it('extracts changed files from CODE_ACTION steps', () => {
    const steps = [
      {
        type: 'CORTEX_STEP_TYPE_CODE_ACTION',
        codeAction: {
          actionSpec: {
            createFile: { absoluteUri: 'file:///src/new.ts' },
          },
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: { status: 'DONE', modifiedResponse: 'Created file' },
      },
    ];
    const result = compactCodingResult(steps);
    expect(result.changedFiles).toContain('/src/new.ts');
  });

  it('marks failed when unrecovered ERROR_MESSAGE exists', () => {
    const steps = [
      { type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE' },
    ];
    const result = compactCodingResult(steps);
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('failed');
  });

  it('marks completed when error is recovered', () => {
    const steps = [
      { type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE' },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: { status: 'DONE', modifiedResponse: 'Recovered and done' },
      },
    ];
    const result = compactCodingResult(steps);
    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Recovered and done');
  });

  it('marks blocked when isBlocking step exists', () => {
    const steps = [
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          isBlocking: true,
          modifiedResponse: 'Need approval for deployment',
        },
      },
    ];
    const result = compactCodingResult(steps);
    expect(result.status).toBe('blocked');
    expect(result.blockers).toHaveLength(1);
  });

  it('collects needsReview URIs', () => {
    const steps = [
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: {
          status: 'DONE',
          modifiedResponse: 'Done',
          reviewAbsoluteUris: ['file:///src/a.ts'],
          pathsToReview: ['/src/b.ts'],
        },
      },
    ];
    const result = compactCodingResult(steps);
    expect(result.needsReview).toContain('file:///src/a.ts');
    expect(result.needsReview).toContain('/src/b.ts');
  });

  it('falls back to last planner response when no DONE status', () => {
    const steps = [
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: { modifiedResponse: 'First response' },
      },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: { modifiedResponse: 'Last response' },
      },
    ];
    const result = compactCodingResult(steps);
    expect(result.summary).toBe('Last response');
  });

  it('uses result.json when artifactAbsDir provided', () => {
    fs.writeFileSync(path.join(tmpDir, 'result.json'), JSON.stringify({
      status: 'completed',
      summary: 'From JSON',
      changedFiles: ['a.ts'],
    }));
    const result = compactCodingResult([], tmpDir);
    expect(result.status).toBe('completed');
    expect(result.summary).toBe('From JSON');
  });

  it('falls back to step parsing when result.json missing', () => {
    const steps = [
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: { status: 'DONE', modifiedResponse: 'From steps' },
      },
    ];
    const result = compactCodingResult(steps, tmpDir);
    expect(result.summary).toBe('From steps');
  });

  it('returns default summary when no planner responses exist', () => {
    const result = compactCodingResult([]);
    expect(result.status).toBe('completed');
    expect(result.summary).toContain('no summary extracted');
  });
});
