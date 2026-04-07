import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getWorkspaces } from '@/lib/bridge/gateway';

export const dynamic = 'force-dynamic';

function resolveWorkspace(req: Request): string | null {
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace');
  return workspace ? workspace.replace(/^file:\/\//, '') : null;
}

/** Only allow registered workspace paths to prevent path traversal */
function isRegisteredWorkspace(uri: string): boolean {
  const registered = getWorkspaces() as Array<{ uri: string }>;
  return registered.some(w => w.uri.replace(/^file:\/\//, '') === uri);
}

// GET /api/departments?workspace=<encoded_uri>
export async function GET(req: Request) {
  const uri = resolveWorkspace(req);
  if (!uri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  if (!isRegisteredWorkspace(uri)) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const configPath = path.join(uri, '.department', 'config.json');

  if (!fs.existsSync(configPath)) {
    return NextResponse.json({
      name: path.basename(uri),
      type: 'build',
      skills: [],
      okr: null,
    });
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({ error: 'Invalid .department/config.json format' }, { status: 422 });
  }
}

// PUT /api/departments?workspace=<encoded_uri>
export async function PUT(req: Request) {
  const uri = resolveWorkspace(req);
  if (!uri) return NextResponse.json({ error: 'Missing workspace' }, { status: 400 });
  if (!isRegisteredWorkspace(uri)) return NextResponse.json({ error: 'Unknown workspace' }, { status: 403 });

  const config = await req.json();

  const dir = path.join(uri, '.department');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));

  // --- Sync to Antigravity IDE .agents/rules ---
  try {
    const rulesDir = path.join(uri, '.agents', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    let ruleContent = `---
name: department-identity
description: 本部门/工作区的人设与基础属性
trigger: always_on
---

# 🏢 当前部门记忆 (Department Context)

你是 **${config.name || path.basename(uri)}**。
`;

    if (config.description) {
      ruleContent += `\n**你的整体使命与介绍**：\n${config.description}\n`;
    }

    if (config.skills && config.skills.length > 0) {
      ruleContent += `\n**你拥有的专门技能 (Skills)**：\n`;
      config.skills.forEach((skill: any) => {
        ruleContent += `- **${skill.name}**\n`;
      });
    }

    if (config.okr) {
      ruleContent += `\n**当前核心 OKR (目标与关键结果)**：\n`;
      if (config.okr.objective) ruleContent += `🎯 Objective: ${config.okr.objective}\n`;
      if (config.okr.keyResults && config.okr.keyResults.length > 0) {
        config.okr.keyResults.forEach((kr: any) => {
          ruleContent += `   - [${kr.progress || 0}%] ${kr.description}\n`;
        });
      }
    }

    const ruleFile = path.join(rulesDir, 'department-identity.md');
    fs.writeFileSync(ruleFile, ruleContent);
  } catch (err: any) {
    console.warn('[Department Sync Error]', err.message);
  }

  return NextResponse.json({ ok: true });
}
