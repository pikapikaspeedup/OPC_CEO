import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mocks ──

const mockGetRun = vi.fn();
const mockUpdateRun = vi.fn();
vi.mock('./run-registry', () => ({
  getRun: (...args: any[]) => mockGetRun(...args),
  updateRun: (...args: any[]) => mockUpdateRun(...args),
}));

const mockScanArtifactManifest = vi.fn();
const mockBuildResultEnvelope = vi.fn();
const mockWriteEnvelopeFile = vi.fn();
const mockReadDeliveryPacket = vi.fn();
const mockBuildWriteScopeAudit = vi.fn();
vi.mock('./run-artifacts', () => ({
  scanArtifactManifest: (...args: any[]) => mockScanArtifactManifest(...args),
  buildResultEnvelope: (...args: any[]) => mockBuildResultEnvelope(...args),
  writeEnvelopeFile: (...args: any[]) => mockWriteEnvelopeFile(...args),
  readDeliveryPacket: (...args: any[]) => mockReadDeliveryPacket(...args),
  buildWriteScopeAudit: (...args: any[]) => mockBuildWriteScopeAudit(...args),
}));

vi.mock('./department-memory', () => ({
  extractAndPersistMemory: vi.fn(),
}));

vi.mock('../knowledge', () => ({
  persistKnowledgeForRun: vi.fn(),
}));

vi.mock('./gateway-home', () => ({
  ARTIFACT_ROOT_DIR: '.antigravity',
}));

import { finalizeAdvisoryRun, finalizeDeliveryRun } from './finalization';
import type { GroupDefinition, TaskResult } from './group-types';

// ── Helpers ──

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finalization-'));
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeGroup(overrides: Partial<GroupDefinition> = {}): GroupDefinition {
  return {
    id: 'test-group',
    name: 'Test Group',
    templateId: 'test-template',
    roles: [],
    executionMode: 'review-loop',
    capabilities: { emitsManifest: true },
    ...overrides,
  } as GroupDefinition;
}

function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    status: 'completed',
    summary: 'Test summary',
    changedFiles: ['src/a.ts'],
    blockers: [],
    needsReview: [],
    ...overrides,
  };
}

// ── finalizeAdvisoryRun ──

describe('finalizeAdvisoryRun', () => {
  it('scans manifest, builds envelope, and updates run', () => {
    const group = makeGroup();
    const result = makeResult();
    const run = { artifactDir: '.antigravity/runs/run-1/', workspace: 'file:///workspace' };
    mockGetRun.mockReturnValue(run);
    mockScanArtifactManifest.mockReturnValue({ items: [{ path: 'a.ts' }] });
    mockBuildResultEnvelope.mockReturnValue({ runId: 'run-1', status: 'completed' });

    finalizeAdvisoryRun('run-1', group, tmpDir, 'approved', result);

    expect(mockScanArtifactManifest).toHaveBeenCalledWith('run-1', 'test-template', tmpDir);
    expect(mockBuildResultEnvelope).toHaveBeenCalled();
    expect(mockWriteEnvelopeFile).toHaveBeenCalledWith(tmpDir, 'result-envelope.json', expect.any(Object));
    expect(mockUpdateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      artifactManifestPath: expect.stringContaining('artifacts.manifest.json'),
      resultEnvelope: expect.any(Object),
    }));
    // Verify manifest file was written to disk
    expect(fs.existsSync(path.join(tmpDir, 'artifacts.manifest.json'))).toBe(true);
  });

  it('skips when group does not emit manifest', () => {
    const group = makeGroup({ capabilities: {} });
    finalizeAdvisoryRun('run-1', group, tmpDir, 'approved', makeResult());

    expect(mockScanArtifactManifest).not.toHaveBeenCalled();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it('handles errors gracefully (non-fatal)', () => {
    const group = makeGroup();
    mockGetRun.mockReturnValue(null);
    mockScanArtifactManifest.mockImplementation(() => { throw new Error('scan failed'); });

    // Should not throw
    expect(() => finalizeAdvisoryRun('run-1', group, tmpDir, 'approved', makeResult())).not.toThrow();
  });

  it('uses fallback manifest path when artifactDir is missing', () => {
    const group = makeGroup();
    mockGetRun.mockReturnValue({ workspace: 'file:///workspace' }); // no artifactDir
    mockScanArtifactManifest.mockReturnValue({ items: [] });
    mockBuildResultEnvelope.mockReturnValue({ runId: 'run-1' });

    finalizeAdvisoryRun('run-1', group, tmpDir, 'approved', makeResult());

    expect(mockUpdateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      artifactManifestPath: '.antigravity/runs/run-1/artifacts.manifest.json',
    }));
  });
});

// ── finalizeDeliveryRun ──

describe('finalizeDeliveryRun', () => {
  it('reads delivery packet, builds envelope, and updates run', () => {
    const group = makeGroup();
    const result = makeResult();
    const run = { artifactDir: '.antigravity/runs/run-2/', workspace: 'file:///workspace' };
    mockGetRun.mockReturnValue(run);
    mockReadDeliveryPacket.mockReturnValue({
      status: 'completed',
      summary: 'Delivery done',
      taskId: 'task-1',
      changedFiles: ['b.ts'],
    });
    mockBuildWriteScopeAudit.mockReturnValue({ withinScope: true, outOfScopeFiles: [] });
    mockScanArtifactManifest.mockReturnValue({ items: [{ path: 'b.ts' }] });

    finalizeDeliveryRun('run-2', group, tmpDir, result);

    expect(mockReadDeliveryPacket).toHaveBeenCalledWith(tmpDir, 'run-2'.slice(0, 8), undefined);
    expect(mockScanArtifactManifest).toHaveBeenCalled();
    expect(mockWriteEnvelopeFile).toHaveBeenCalled();
    expect(mockUpdateRun).toHaveBeenCalledWith('run-2', expect.objectContaining({
      status: 'completed',
    }));
  });

  it('marks blocked when delivery packet is missing', () => {
    const group = makeGroup();
    const result = makeResult();
    mockGetRun.mockReturnValue({ workspace: 'file:///workspace' });
    mockReadDeliveryPacket.mockReturnValue(null);

    finalizeDeliveryRun('run-2', group, tmpDir, result);

    expect(mockUpdateRun).toHaveBeenCalledWith('run-2', expect.objectContaining({
      status: 'blocked',
      lastError: expect.stringContaining('Delivery contract violated'),
    }));
  });

  it('marks blocked-by-team when delivery packet status is blocked', () => {
    const group = makeGroup();
    const result = makeResult();
    const run = { artifactDir: '.antigravity/runs/run-3/', workspace: 'file:///workspace' };
    mockGetRun.mockReturnValue(run);
    mockReadDeliveryPacket.mockReturnValue({
      status: 'blocked',
      summary: 'Need help',
      blockedReason: 'Missing API key',
    });
    mockBuildWriteScopeAudit.mockReturnValue({ withinScope: true, outOfScopeFiles: [] });
    mockScanArtifactManifest.mockReturnValue({ items: [] });

    finalizeDeliveryRun('run-3', group, tmpDir, result);

    expect(mockUpdateRun).toHaveBeenCalledWith('run-3', expect.objectContaining({
      status: 'blocked',
      lastError: 'Missing API key',
    }));
  });

  it('uses delivered-with-scope-warnings when out-of-scope files exist', () => {
    const group = makeGroup();
    const result = makeResult();
    const run = { artifactDir: '.antigravity/runs/run-4/', workspace: 'file:///workspace' };
    mockGetRun.mockReturnValue(run);
    mockReadDeliveryPacket.mockReturnValue({
      status: 'completed',
      summary: 'Done with extras',
    });
    mockBuildWriteScopeAudit.mockReturnValue({
      withinScope: false,
      outOfScopeFiles: ['extra.ts'],
    });
    mockScanArtifactManifest.mockReturnValue({ items: [] });

    finalizeDeliveryRun('run-4', group, tmpDir, result);

    expect(mockWriteEnvelopeFile).toHaveBeenCalledWith(
      tmpDir, 'result-envelope.json',
      expect.objectContaining({ decision: 'delivered-with-scope-warnings' }),
    );
  });

  it('handles finalization error gracefully', () => {
    const group = makeGroup();
    const result = makeResult();
    mockGetRun.mockReturnValue({ workspace: 'file:///workspace' });
    mockReadDeliveryPacket.mockImplementation(() => { throw new Error('IO error'); });

    finalizeDeliveryRun('run-5', group, tmpDir, result);

    expect(mockUpdateRun).toHaveBeenCalledWith('run-5', expect.objectContaining({
      status: 'blocked',
      lastError: expect.stringContaining('IO error'),
    }));
  });
});
