import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll } from 'vitest';

const allowRealHome = process.env.AG_ALLOW_REAL_GATEWAY_HOME_IN_TESTS === '1';
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-vitest-'));
const testHome = path.join(testRoot, 'home');
const testGatewayHome = path.join(testRoot, 'gateway');
const testCodexHome = path.join(testRoot, 'codex');
const testClaudeHome = path.join(testRoot, 'claude');

const previousEnv = {
  HOME: process.env.HOME,
  AG_GATEWAY_HOME: process.env.AG_GATEWAY_HOME,
  CODEX_HOME: process.env.CODEX_HOME,
  CLAUDE_HOME: process.env.CLAUDE_HOME,
  AG_ENABLE_SCHEDULER: process.env.AG_ENABLE_SCHEDULER,
  AG_DISABLE_BRIDGE_WORKER: process.env.AG_DISABLE_BRIDGE_WORKER,
  AG_ENABLE_IMPORTERS: process.env.AG_ENABLE_IMPORTERS,
};

process.setMaxListeners(Math.max(process.getMaxListeners(), 50));

fs.mkdirSync(testHome, { recursive: true });
fs.mkdirSync(testGatewayHome, { recursive: true });
fs.mkdirSync(testCodexHome, { recursive: true });
fs.mkdirSync(testClaudeHome, { recursive: true });

if (!allowRealHome) {
  process.env.HOME = testHome;
  process.env.AG_GATEWAY_HOME = testGatewayHome;
  process.env.CODEX_HOME = testCodexHome;
  process.env.CLAUDE_HOME = testClaudeHome;
}

process.env.AG_ENABLE_SCHEDULER = '0';
process.env.AG_DISABLE_BRIDGE_WORKER = '1';
process.env.AG_ENABLE_IMPORTERS = '0';

function restoreEnv(key: keyof typeof previousEnv): void {
  const value = previousEnv[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterAll(() => {
  restoreEnv('HOME');
  restoreEnv('AG_GATEWAY_HOME');
  restoreEnv('CODEX_HOME');
  restoreEnv('CLAUDE_HOME');
  restoreEnv('AG_ENABLE_SCHEDULER');
  restoreEnv('AG_DISABLE_BRIDGE_WORKER');
  restoreEnv('AG_ENABLE_IMPORTERS');

  if (process.env.AG_KEEP_TEST_HOME !== '1') {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});
