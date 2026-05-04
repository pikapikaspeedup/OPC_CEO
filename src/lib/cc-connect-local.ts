import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

function getBaseUrl(): string {
  return process.env.CC_CONNECT_URL || 'http://127.0.0.1:9820';
}

function getToken(): string {
  return process.env.CC_CONNECT_TOKEN || 'ag-mgmt-2026';
}

function getConfigTemplatePath(): string {
  return path.join(process.cwd(), 'cc-connect.config.toml');
}

function getConfigPath(): string {
  return path.join(homedir(), '.cc-connect', 'config.toml');
}

function getScriptPath(): string {
  return path.join(process.cwd(), 'scripts', 'antigravity-acp.ts');
}

function getWorkDir(): string {
  return process.cwd();
}

export interface CcConnectLocalState {
  installed: boolean;
  binaryPath: string | null;
  configPath: string;
  templatePath: string;
  configExists: boolean;
  configPrepared: boolean;
  platformConfigured: boolean;
  tokenConfigured: boolean;
  managementEnabled: boolean;
  managementPort: number;
  running: boolean;
  pid: number | null;
  connectedPlatforms: string[];
  projectsCount: number;
  version: string | null;
  issues: string[];
}

function getManagementPort(): number {
  try {
    const url = new URL(getBaseUrl());
    return url.port ? Number(url.port) : 9820;
  } catch {
    return 9820;
  }
}

function findBinaryPath(): string | null {
  const result = spawnSync('which', ['cc-connect'], { encoding: 'utf-8' });
  const candidate = result.status === 0 ? result.stdout.trim() : '';
  return candidate || null;
}

function readConfigIfExists(configPath: string): string | null {
  try {
    return fs.readFileSync(configPath, 'utf-8');
  } catch {
    return null;
  }
}

function hasPlaceholderPath(value: string | null): boolean {
  if (!value) return true;
  return value.includes('/path/to/')
    || value.includes('/your/')
    || value.includes('PATH_TO')
    || value.trim().length === 0;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function ensureLine(content: string, pattern: RegExp, replacement: string, fallbackSection?: string): string {
  if (pattern.test(content)) {
    return content.replace(pattern, replacement);
  }
  if (fallbackSection && content.includes(fallbackSection)) {
    return content.replace(fallbackSection, `${fallbackSection}\n${replacement}`);
  }
  return `${content.trimEnd()}\n${replacement}\n`;
}

function parseConfigShape(content: string | null): {
  configPrepared: boolean;
  platformConfigured: boolean;
  tokenConfigured: boolean;
  managementEnabled: boolean;
} {
  if (!content) {
    return {
      configPrepared: false,
      platformConfigured: false,
      tokenConfigured: false,
      managementEnabled: false,
    };
  }

  const workDirMatch = content.match(/^\s*work_dir\s*=\s*"([^"]+)"/m);
  const argsMatch = content.match(/^\s*args\s*=\s*\[[^\]]*"([^"]*antigravity-acp\.ts)"[^\]]*\]/m);
  const platformConfigured = /\[\[projects\.platforms\]\]/.test(content);
  const tokenMatch = content.match(/\[projects\.platforms\.options\][\s\S]*?^\s*token\s*=\s*"([^"]+)"/m);
  const managementEnabled = /\[management\][\s\S]*?enabled\s*=\s*true/m.test(content);
  const workDir = workDirMatch?.[1] || null;
  const scriptPath = argsMatch?.[1] || null;
  const workDirReady = typeof workDir === 'string' && !hasPlaceholderPath(workDir) && fs.existsSync(workDir);
  const scriptReady = typeof scriptPath === 'string' && !hasPlaceholderPath(scriptPath) && fs.existsSync(scriptPath);
  return {
    configPrepared: workDirReady && scriptReady,
    platformConfigured,
    tokenConfigured: Boolean(tokenMatch?.[1]?.trim()),
    managementEnabled,
  };
}

function normalizeConfigContent(content: string): string {
  let next = content;
  const workDir = getWorkDir();
  const scriptPath = getScriptPath();
  const token = getToken();
  const workDirMatch = next.match(/^\s*work_dir\s*=\s*"([^"]+)"/m);
  if (hasPlaceholderPath(workDirMatch?.[1] || null)) {
    next = ensureLine(
      next,
      /^\s*work_dir\s*=.*$/m,
      `work_dir = "${escapeTomlString(workDir)}"`,
      '[projects.agent.options]',
    );
  }

  const argsMatch = next.match(/^\s*args\s*=\s*\[[^\]]*"([^"]*antigravity-acp\.ts)"[^\]]*\]/m);
  if (hasPlaceholderPath(argsMatch?.[1] || null)) {
    next = ensureLine(
      next,
      /^\s*args\s*=\s*\[[^\]]*\]\s*$/m,
      `args = ["tsx", "${escapeTomlString(scriptPath)}"]`,
      '[projects.agent.options]',
    );
  }

  next = ensureLine(
    next,
    /^\s*command\s*=\s*"[^"]*"\s*$/m,
    'command = "npx"',
    '[projects.agent.options]',
  );

  if (!/\[management\]/.test(next)) {
    next = `${next.trimEnd()}\n\n[management]\nenabled = true\nport = ${getManagementPort()}\ntoken = "${escapeTomlString(token)}"\ncors_origins = ["http://localhost:3000"]\n`;
  } else {
    next = ensureLine(next, /^\s*enabled\s*=\s*.*$/m, 'enabled = true', '[management]');
    next = ensureLine(next, /^\s*port\s*=\s*\d+\s*$/m, `port = ${getManagementPort()}`, '[management]');
    next = ensureLine(next, /^\s*token\s*=\s*"[^"]*"\s*$/m, `token = "${escapeTomlString(token)}"`, '[management]');
    if (!/^\s*cors_origins\s*=.*$/m.test(next)) {
      next = ensureLine(next, /^\s*cors_origins\s*=.*$/m, 'cors_origins = ["http://localhost:3000"]', '[management]');
    }
  }

  return next;
}

export function ensureCcConnectConfig(): { changed: boolean; configPath: string } {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const existing = readConfigIfExists(configPath);
  const source = existing ?? fs.readFileSync(getConfigTemplatePath(), 'utf-8');
  const normalized = normalizeConfigContent(source);
  if (existing !== normalized) {
    fs.writeFileSync(configPath, normalized, 'utf-8');
    return { changed: true, configPath };
  }
  return { changed: false, configPath };
}

function findListeningPid(port: number): number | null {
  const result = spawnSync('lsof', ['-nP', '-iTCP:' + String(port), '-sTCP:LISTEN', '-t'], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  const value = result.stdout.trim().split('\n')[0];
  return value ? Number(value) : null;
}

async function fetchManagementStatus(): Promise<{
  running: boolean;
  connectedPlatforms: string[];
  projectsCount: number;
  version: string | null;
}> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/v1/status`, {
      headers: { Authorization: `Bearer ${getToken()}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      return { running: false, connectedPlatforms: [], projectsCount: 0, version: null };
    }
    const payload = await res.json() as {
      ok?: boolean;
      data?: {
        connected_platforms?: string[];
        projects_count?: number;
        version?: string;
      };
    };
    return {
      running: true,
      connectedPlatforms: payload.data?.connected_platforms ?? [],
      projectsCount: payload.data?.projects_count ?? 0,
      version: payload.data?.version ?? null,
    };
  } catch {
    return { running: false, connectedPlatforms: [], projectsCount: 0, version: null };
  }
}

export async function getCcConnectLocalState(): Promise<CcConnectLocalState> {
  const binaryPath = findBinaryPath();
  const configPath = getConfigPath();
  const templatePath = getConfigTemplatePath();
  const content = readConfigIfExists(configPath);
  const parsed = parseConfigShape(content);
  const managementPort = getManagementPort();
  const managementStatus = await fetchManagementStatus();
  const pid = findListeningPid(managementPort);
  const running = managementStatus.running && pid !== null;

  const issues: string[] = [];
  if (!binaryPath) issues.push('未安装 cc-connect');
  if (!content) issues.push('未检测到 ~/.cc-connect/config.toml');
  if (content && !parsed.configPrepared) issues.push('配置中的工作目录或 ACP 脚本路径仍是占位值，或对应文件不存在');
  if (content && !parsed.platformConfigured) issues.push('尚未配置会话平台');
  if (content && !parsed.tokenConfigured) issues.push('尚未完成 weixin setup 绑定');
  if (content && !parsed.managementEnabled) issues.push('management API 未启用');
  if (content && parsed.managementEnabled && !running) issues.push('cc-connect 未运行');

  return {
    installed: Boolean(binaryPath),
    binaryPath,
    configPath,
    templatePath,
    configExists: Boolean(content),
    configPrepared: parsed.configPrepared,
    platformConfigured: parsed.platformConfigured,
    tokenConfigured: parsed.tokenConfigured,
    managementEnabled: parsed.managementEnabled,
    managementPort,
    running,
    pid,
    connectedPlatforms: running ? managementStatus.connectedPlatforms : [],
    projectsCount: running ? managementStatus.projectsCount : 0,
    version: running ? managementStatus.version : null,
    issues,
  };
}

async function waitForRunning(timeoutMs = 8000): Promise<CcConnectLocalState> {
  const deadline = Date.now() + timeoutMs;
  let lastState = await getCcConnectLocalState();
  for (;;) {
    if (lastState.running) {
      return lastState;
    }
    if (Date.now() >= deadline) {
      throw new Error(lastState.issues[0] || 'cc-connect 未能在预期时间内启动');
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    lastState = await getCcConnectLocalState();
  }
}

export async function startCcConnect(): Promise<CcConnectLocalState> {
  const state = await getCcConnectLocalState();
  if (!state.installed || !state.binaryPath) {
    throw new Error('cc-connect 未安装，无法启动');
  }
  if (!state.configExists) {
    throw new Error('尚未创建 ~/.cc-connect/config.toml');
  }
  if (!state.configPrepared || !state.managementEnabled) {
    throw new Error('请先修复本地 cc-connect 配置，再执行启动');
  }
  if (!state.platformConfigured || !state.tokenConfigured) {
    throw new Error('请先运行 cc-connect weixin setup --project antigravity 完成绑定');
  }
  if (state.running) {
    return state;
  }

  const child = spawn(state.binaryPath, [], {
    cwd: path.dirname(state.configPath),
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return waitForRunning();
}

export async function stopCcConnect(): Promise<CcConnectLocalState> {
  const state = await getCcConnectLocalState();
  if (state.pid) {
    process.kill(state.pid, 'SIGTERM');
  }

  const deadline = Date.now() + 5000;
  for (;;) {
    const next = await getCcConnectLocalState();
    if (!next.running) {
      return next;
    }
    if (Date.now() >= deadline) {
      return next;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
