import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tempRoot: string;
let previousHome: string | undefined;
let previousCwd: string;

async function loadModule() {
  return import('./cc-connect-local');
}

describe('cc-connect local helpers', () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-connect-local-'));
    previousHome = process.env.HOME;
    previousCwd = process.cwd();
    process.env.HOME = path.join(tempRoot, 'home');
    fs.mkdirSync(process.env.HOME, { recursive: true });

    const repoRoot = path.join(tempRoot, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'scripts', 'antigravity-acp.ts'), '// test');
    fs.writeFileSync(
      path.join(repoRoot, 'cc-connect.config.toml'),
      [
        'language = "zh"',
        '',
        '[[projects]]',
        'name = "antigravity"',
        '',
        '[projects.agent]',
        'type = "acp"',
        '',
        '[projects.agent.options]',
        'work_dir = "/path/to/your/project"',
        'command = "npx"',
        'args = ["tsx", "/path/to/Antigravity-Mobility-CLI/scripts/antigravity-acp.ts"]',
        'display_name = "Antigravity Agent"',
        '',
        '[[projects.platforms]]',
        'type = "weixin"',
        '',
        '[projects.platforms.options]',
        'allow_from = "*"',
      ].join('\n'),
      'utf-8',
    );
    process.chdir(repoRoot);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes a normalized config from template', async () => {
    const mod = await loadModule();
    const result = mod.ensureCcConnectConfig();
    const content = fs.readFileSync(result.configPath, 'utf-8');

    expect(result.changed).toBe(true);
    expect(content).toContain(`work_dir = "${process.cwd()}"`);
    expect(content).toContain(`args = ["tsx", "${path.join(process.cwd(), 'scripts', 'antigravity-acp.ts').replace(/\\/g, '\\\\')}"]`);
    expect(content).toContain('[management]');
    expect(content).toContain('enabled = true');
  });

  it('keeps token/platform config while appending management block', async () => {
    const configPath = path.join(process.env.HOME!, '.cc-connect', 'config.toml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        'language = "zh"',
        '',
        '[[projects]]',
        'name = "antigravity"',
        '',
        '[projects.agent.options]',
        `work_dir = "${process.cwd()}"`,
        'command = "npx"',
        `args = ["tsx", "${path.join(process.cwd(), 'scripts', 'antigravity-acp.ts').replace(/\\/g, '\\\\')}"]`,
        '',
        '[[projects.platforms]]',
        'type = "weixin"',
        '',
        '[projects.platforms.options]',
        'token = "abc@im.bot"',
        'base_url = "https://ilinkai.weixin.qq.com"',
        'account_id = "abc@im.bot"',
      ].join('\n'),
      'utf-8',
    );

    const mod = await loadModule();
    mod.ensureCcConnectConfig();
    const content = fs.readFileSync(configPath, 'utf-8');

    expect(content).toContain('token = "abc@im.bot"');
    expect(content).toContain('[management]');
    expect(content).toContain('enabled = true');
  });
});
