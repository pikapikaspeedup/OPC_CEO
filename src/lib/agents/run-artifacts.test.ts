import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readDeliveryPacket,
  buildWriteScopeAudit,
  scanArtifactManifest,
  buildResultEnvelope,
  writeEnvelopeFile,
} from './run-artifacts';
import type { AgentRunState, ArtifactManifest } from './group-types';
import type { DevelopmentWorkPackage } from './development-template-types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-artifacts-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readDeliveryPacket
// ---------------------------------------------------------------------------

describe('readDeliveryPacket', () => {
  it('reads a valid completed delivery packet', () => {
    const deliveryDir = path.join(tmpDir, 'delivery');
    fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'delivery-packet.json'), JSON.stringify({
      status: 'completed',
      summary: 'All tasks done',
      taskId: 'task-1',
      changedFiles: ['src/a.ts'],
    }));

    const result = readDeliveryPacket(tmpDir, 'test1234');
    expect(result).toBeDefined();
    expect(result!.status).toBe('completed');
    expect(result!.taskId).toBe('task-1');
    expect(result!.changedFiles).toEqual(['src/a.ts']);
  });

  it('reads a valid blocked delivery packet', () => {
    const deliveryDir = path.join(tmpDir, 'delivery');
    fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'delivery-packet.json'), JSON.stringify({
      status: 'blocked',
      summary: 'Missing dependency',
      taskId: 'task-2',
      changedFiles: [],
      blockedReason: 'API not available',
    }));

    const result = readDeliveryPacket(tmpDir, 'test5678');
    expect(result).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(result!.blockedReason).toBe('API not available');
  });

  it('returns undefined when file not found', () => {
    const result = readDeliveryPacket(tmpDir, 'missing1');
    expect(result).toBeUndefined();
  });

  it('returns undefined for missing required fields', () => {
    const deliveryDir = path.join(tmpDir, 'delivery');
    fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'delivery-packet.json'), JSON.stringify({
      status: 'completed',
      // missing summary, taskId, changedFiles
    }));

    const result = readDeliveryPacket(tmpDir, 'bad12345');
    expect(result).toBeUndefined();
  });

  it('returns undefined for invalid status', () => {
    const deliveryDir = path.join(tmpDir, 'delivery');
    fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'delivery-packet.json'), JSON.stringify({
      status: 'in-progress',
      summary: 'Still going',
      taskId: 'task-x',
      changedFiles: [],
    }));

    const result = readDeliveryPacket(tmpDir, 'badstat1');
    expect(result).toBeUndefined();
  });

  it('returns undefined for blocked without blockedReason', () => {
    const deliveryDir = path.join(tmpDir, 'delivery');
    fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'delivery-packet.json'), JSON.stringify({
      status: 'blocked',
      summary: 'Blocked but no reason',
      taskId: 'task-b',
      changedFiles: [],
    }));

    const result = readDeliveryPacket(tmpDir, 'blocked1');
    expect(result).toBeUndefined();
  });

  it('returns undefined for taskId mismatch', () => {
    const deliveryDir = path.join(tmpDir, 'delivery');
    fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'delivery-packet.json'), JSON.stringify({
      status: 'completed',
      summary: 'Done',
      taskId: 'task-wrong',
      changedFiles: [],
    }));

    const result = readDeliveryPacket(tmpDir, 'mismtch1', 'task-expected');
    expect(result).toBeUndefined();
  });

  it('returns undefined for non-array changedFiles', () => {
    const deliveryDir = path.join(tmpDir, 'delivery');
    fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'delivery-packet.json'), JSON.stringify({
      status: 'completed',
      summary: 'Done',
      taskId: 'task-1',
      changedFiles: 'not-array',
    }));

    const result = readDeliveryPacket(tmpDir, 'notarr01');
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildWriteScopeAudit
// ---------------------------------------------------------------------------

describe('buildWriteScopeAudit', () => {
  it('returns undefined when no work package', () => {
    const result = buildWriteScopeAudit(tmpDir, undefined, { changedFiles: [] } as any, undefined, 'test1234');
    expect(result).toBeUndefined();
  });

  it('returns undefined when allowedWriteScope is empty', () => {
    const wp = { taskId: 't1', allowedWriteScope: [] } as any;
    const result = buildWriteScopeAudit(tmpDir, wp, { changedFiles: [] } as any, undefined, 'test1234');
    expect(result).toBeUndefined();
  });

  it('detects all files within scope', () => {
    const wp = {
      taskId: 't1',
      allowedWriteScope: [{ path: 'src/lib' }],
    } as any;
    const taskResult = { changedFiles: ['src/lib/index.ts'] } as any;

    const result = buildWriteScopeAudit(tmpDir, wp, taskResult, undefined, 'scope123');
    expect(result).toBeDefined();
    expect(result!.withinScope).toBe(true);
    expect(result!.outOfScopeFiles).toHaveLength(0);
  });

  it('detects out-of-scope files', () => {
    const wp = {
      taskId: 't1',
      allowedWriteScope: [{ path: 'src/lib' }],
    } as any;
    const taskResult = { changedFiles: ['tests/foo.test.ts'] } as any;

    const result = buildWriteScopeAudit(tmpDir, wp, taskResult, undefined, 'scope456');
    expect(result).toBeDefined();
    expect(result!.withinScope).toBe(false);
    expect(result!.outOfScopeFiles).toContain('tests/foo.test.ts');
  });

  it('merges observed and reported changed files', () => {
    const wp = {
      taskId: 't1',
      allowedWriteScope: [{ path: 'src' }],
    } as any;
    const taskResult = { changedFiles: ['src/a.ts'] } as any;
    const deliveryPacket = { changedFiles: ['src/b.ts'] } as any;

    const result = buildWriteScopeAudit(tmpDir, wp, taskResult, deliveryPacket, 'merge123');
    expect(result).toBeDefined();
    expect(result!.effectiveChangedFiles).toContain('src/a.ts');
    expect(result!.effectiveChangedFiles).toContain('src/b.ts');
  });

  it('writes scope-audit.json to delivery directory', () => {
    const wp = {
      taskId: 't1',
      allowedWriteScope: [{ path: 'src' }],
    } as any;
    const taskResult = { changedFiles: ['src/x.ts'] } as any;

    buildWriteScopeAudit(tmpDir, wp, taskResult, undefined, 'write123');

    const auditPath = path.join(tmpDir, 'delivery', 'scope-audit.json');
    expect(fs.existsSync(auditPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
    expect(written.taskId).toBe('t1');
  });
});

// ---------------------------------------------------------------------------
// scanArtifactManifest
// ---------------------------------------------------------------------------

describe('scanArtifactManifest', () => {
  it('returns empty manifest for non-existent dirs', () => {
    const manifest = scanArtifactManifest('run-1', 'tpl-1', tmpDir);
    expect(manifest.items).toHaveLength(0);
    expect(manifest.runId).toBe('run-1');
    expect(manifest.templateId).toBe('tpl-1');
  });

  it('scans specs directory', () => {
    const specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'feature.md'), '# Feature');

    const manifest = scanArtifactManifest('run-2', 'tpl-2', tmpDir);
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0].kind).toBe('product.feature');
    expect(manifest.items[0].format).toBe('md');
    expect(manifest.items[0].path).toBe('specs/feature.md');
  });

  it('scans multiple directories recursively', () => {
    // specs
    const specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'api.json'), '{}');
    // review
    const reviewDir = path.join(tmpDir, 'review');
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, 'round-1.md'), '# Review');
    // nested delivery
    const deliveryDir = path.join(tmpDir, 'delivery', 'sub');
    fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'report.txt'), 'done');

    const manifest = scanArtifactManifest('run-3', 'tpl-3', tmpDir);
    expect(manifest.items).toHaveLength(3);
    const kinds = manifest.items.map(i => i.kind).sort();
    expect(kinds).toEqual(['delivery.report', 'product.api', 'review.round-1']);
  });

  it('ignores non-whitelisted extensions', () => {
    const specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'image.png'), 'binary');
    fs.writeFileSync(path.join(specsDir, 'data.csv'), 'a,b,c');
    fs.writeFileSync(path.join(specsDir, 'valid.json'), '{}');

    const manifest = scanArtifactManifest('run-4', 'tpl-4', tmpDir);
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0].kind).toBe('product.valid');
  });

  it('sets sourceRunId on all items', () => {
    const specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'a.md'), '# A');
    fs.writeFileSync(path.join(specsDir, 'b.md'), '# B');

    const manifest = scanArtifactManifest('run-5', 'tpl-5', tmpDir);
    for (const item of manifest.items) {
      expect(item.sourceRunId).toBe('run-5');
    }
  });

  it('scans prompt root artifacts and ignores envelope files', () => {
    fs.writeFileSync(path.join(tmpDir, 'native-codex-ai-bigevent-draft.md'), '# Draft');
    fs.writeFileSync(path.join(tmpDir, 'daily-events-report.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'daily-events-verification.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'result.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'result-envelope.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'task-envelope.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'artifacts.manifest.json'), '{}');

    const manifest = scanArtifactManifest('run-6', undefined, tmpDir, { kind: 'prompt' });
    expect(manifest.items.map(item => item.path).sort()).toEqual([
      'daily-events-report.json',
      'daily-events-verification.json',
      'native-codex-ai-bigevent-draft.md',
    ]);
    expect(manifest.items.every(item => item.kind.startsWith('prompt.'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildResultEnvelope
// ---------------------------------------------------------------------------

describe('buildResultEnvelope', () => {
  it('builds envelope for approved run', () => {
    const run = {
      runId: 'r1',
      templateId: 'tpl-1',
      status: 'completed',
    } as any as AgentRunState;
    const manifest: ArtifactManifest = {
      runId: 'r1',
      templateId: 'tpl-1',
      items: [{ id: 'a1', kind: 'product.spec', title: 'Spec', path: 'specs/spec.md', format: 'md', sourceRunId: 'r1' }],
    };
    const result = { summary: 'Great work' } as any;

    const envelope = buildResultEnvelope(run, manifest, 'approved', result);
    expect(envelope.status).toBe('completed');
    expect(envelope.decision).toBe('approved');
    expect(envelope.summary).toBe('Great work');
    expect(envelope.outputArtifacts).toHaveLength(1);
    expect(envelope.nextAction).toBe('Ready for next phase');
  });

  it('builds envelope for rejected run', () => {
    const run = { runId: 'r2', status: 'rejected' } as any as AgentRunState;
    const manifest: ArtifactManifest = { runId: 'r2', templateId: 'tpl-2', items: [] };

    const envelope = buildResultEnvelope(run, manifest, 'rejected');
    expect(envelope.decision).toBe('rejected');
    expect(envelope.nextAction).toBe('Requires re-evaluation');
  });

  it('uses fallback summary when no result provided', () => {
    const run = { runId: 'r3', status: 'completed', result: { summary: 'Fallback' } } as any as AgentRunState;
    const manifest: ArtifactManifest = { runId: 'r3', templateId: 'tpl-3', items: [] };

    const envelope = buildResultEnvelope(run, manifest, 'approved');
    expect(envelope.summary).toBe('Fallback');
  });
});

// ---------------------------------------------------------------------------
// writeEnvelopeFile
// ---------------------------------------------------------------------------

describe('writeEnvelopeFile', () => {
  it('writes JSON file to artifact directory', () => {
    writeEnvelopeFile(tmpDir, 'test.json', { hello: 'world' });

    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'test.json'), 'utf-8'));
    expect(content.hello).toBe('world');
  });

  it('creates nested directories if needed', () => {
    const nested = path.join(tmpDir, 'nested', 'deep');
    writeEnvelopeFile(nested, 'data.json', { a: 1 });

    expect(fs.existsSync(path.join(nested, 'data.json'))).toBe(true);
  });

  it('handles write errors gracefully', () => {
    // Write to an invalid path (use a file as dir)
    fs.writeFileSync(path.join(tmpDir, 'blocker'), 'x');
    // This should not throw
    expect(() => writeEnvelopeFile(path.join(tmpDir, 'blocker', 'sub'), 'f.json', {})).not.toThrow();
  });
});
