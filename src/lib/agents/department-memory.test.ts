import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  readDepartmentMemory,
  appendDepartmentMemory,
  initDepartmentMemory,
  extractAndPersistMemory,
} from './department-memory';

describe('department-memory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join('/tmp', `test-dept-mem-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initDepartmentMemory', () => {
    it('creates memory directory with 3 category files', () => {
      initDepartmentMemory(tmpDir);

      const memDir = path.join(tmpDir, '.department', 'memory');
      expect(fs.existsSync(memDir)).toBe(true);
      expect(fs.existsSync(path.join(memDir, 'knowledge.md'))).toBe(true);
      expect(fs.existsSync(path.join(memDir, 'decisions.md'))).toBe(true);
      expect(fs.existsSync(path.join(memDir, 'patterns.md'))).toBe(true);
    });

    it('does not overwrite existing files', () => {
      const memDir = path.join(tmpDir, '.department', 'memory');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'knowledge.md'), 'Existing content');

      initDepartmentMemory(tmpDir);
      const content = fs.readFileSync(path.join(memDir, 'knowledge.md'), 'utf-8');
      expect(content).toBe('Existing content');
    });
  });

  describe('readDepartmentMemory', () => {
    it('returns empty strings when no memory exists', () => {
      const memory = readDepartmentMemory(tmpDir);
      expect(memory.knowledge).toBe('');
      expect(memory.decisions).toBe('');
      expect(memory.patterns).toBe('');
    });

    it('reads existing memory files', () => {
      const memDir = path.join(tmpDir, '.department', 'memory');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'knowledge.md'), 'TypeScript is great');
      fs.writeFileSync(path.join(memDir, 'decisions.md'), 'Use MCP over exec');

      const memory = readDepartmentMemory(tmpDir);
      expect(memory.knowledge).toBe('TypeScript is great');
      expect(memory.decisions).toBe('Use MCP over exec');
      expect(memory.patterns).toBe('');
    });
  });

  describe('appendDepartmentMemory', () => {
    it('creates memory file and appends entry', () => {
      appendDepartmentMemory(tmpDir, 'knowledge', {
        timestamp: '2026-04-03T12:00:00Z',
        source: 'run:abc12345',
        content: 'The project uses Next.js App Router',
      });

      const filePath = path.join(tmpDir, '.department', 'memory', 'knowledge.md');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('2026-04-03T12:00:00Z');
      expect(content).toContain('run:abc12345');
      expect(content).toContain('Next.js App Router');
    });

    it('appends multiple entries', () => {
      appendDepartmentMemory(tmpDir, 'decisions', {
        timestamp: '2026-04-03T12:00:00Z',
        source: 'manual',
        content: 'Decision 1',
      });
      appendDepartmentMemory(tmpDir, 'decisions', {
        timestamp: '2026-04-03T12:00:01Z',
        source: 'manual',
        content: 'Decision 2',
      });

      const filePath = path.join(tmpDir, '.department', 'memory', 'decisions.md');
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('Decision 1');
      expect(content).toContain('Decision 2');
    });
  });

  describe('extractAndPersistMemory', () => {
    it('skips extraction for short summaries', () => {
      extractAndPersistMemory(tmpDir, 'run-1234', 'Too short', []);
      const memDir = path.join(tmpDir, '.department', 'memory');
      expect(fs.existsSync(memDir)).toBe(false);
    });

    it('records changed files as knowledge', () => {
      const summary = 'Implemented the new authentication system with JWT tokens. Switched to bcrypt for password hashing. Added comprehensive test coverage for the auth module.';
      const files = ['src/auth/login.ts', 'src/auth/jwt.ts', 'src/auth/auth.test.ts'];

      extractAndPersistMemory(tmpDir, 'abcdef12-3456-7890-1234-567890abcdef', summary, files);

      const knowledgeFile = path.join(tmpDir, '.department', 'memory', 'knowledge.md');
      expect(fs.existsSync(knowledgeFile)).toBe(true);

      const content = fs.readFileSync(knowledgeFile, 'utf-8');
      expect(content).toContain('src/auth/login.ts');
      expect(content).toContain('run:abcdef12');
    });

    it('extracts decisions from summary text', () => {
      const summary = 'We decided to use PostgreSQL instead of MongoDB. Chose React Query over SWR for data fetching. Adopted the repository pattern for data access.';

      extractAndPersistMemory(tmpDir, 'abcdef12-3456-7890-1234-567890abcdef', summary, ['src/db.ts']);

      const decisionsFile = path.join(tmpDir, '.department', 'memory', 'decisions.md');
      if (fs.existsSync(decisionsFile)) {
        const content = fs.readFileSync(decisionsFile, 'utf-8');
        expect(content).toContain('decided');
      }
    });
  });
});
