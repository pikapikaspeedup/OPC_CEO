#!/usr/bin/env node
export {};
/**
 * ag-wechat — Helper CLI for cc-connect custom commands.
 *
 * Exposes Antigravity server queries as simple exec commands
 * that cc-connect [[commands]] can call directly.
 *
 * Usage:
 *   npx tsx scripts/ag-wechat.ts models          — List available models
 *   npx tsx scripts/ag-wechat.ts model <name>    — Set model for current session
 *   npx tsx scripts/ag-wechat.ts status           — Show model quota / server status
 */

const AG_URL = process.env.AG_BASE_URL || 'http://127.0.0.1:3000';

async function agApi(path: string): Promise<any> {
  const res = await fetch(`${AG_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Commands ─────────────────────────────────────────────────────────────

async function cmdModels() {
  const data = await agApi('/api/models');
  const configs = data.clientModelConfigs || [];

  if (configs.length === 0) {
    console.log('⚠️ 暂无可用模型');
    return;
  }

  console.log('📋 可用模型:\n');
  for (const m of configs) {
    const alias = m.label || '?';
    const model = m.modelOrAlias?.model || alias;
    const quota = m.quotaInfo?.remainingFraction;
    const tag = m.tagTitle ? ` [${m.tagTitle}]` : '';
    const rec = m.isRecommended ? ' ⭐' : '';
    const bar = quota !== undefined ? ` ${formatQuota(quota)}` : '';
    console.log(`  ${alias.padEnd(20)} ${model}${tag}${rec}${bar}`);
  }
}

async function cmdModel(name: string) {
  // Validate model exists
  const data = await agApi('/api/models');
  const configs = data.clientModelConfigs || [];
  const match = configs.find((m: any) =>
    m.label?.toLowerCase() === name.toLowerCase() ||
    m.modelOrAlias?.model?.toLowerCase() === name.toLowerCase()
  );

  if (!match) {
    console.log(`❌ 模型 "${name}" 未找到。使用 /models 查看可用列表。`);
    process.exit(1);
  }

  // Write model preference to a state file
  const { writeFileSync, mkdirSync } = await import('fs');
  const { join } = await import('path');
  const stateDir = join(process.env.HOME || '~', '.cc-connect', 'antigravity');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'model'), match.label || name, 'utf-8');

  console.log(`✅ 已切换模型: ${match.label} (${match.modelOrAlias?.model || '?'})`);
}

async function cmdStatus() {
  // Models + quota
  const data = await agApi('/api/models');
  const configs = data.clientModelConfigs || [];

  console.log('📊 系统状态\n');

  // Server health
  try {
    const me = await agApi('/api/me');
    console.log(`👤 用户: ${me.name || '(unknown)'}`);
    console.log(`🔑 API Key: ${me.hasApiKey ? '✅' : '❌ 未设置'}`);
  } catch {
    console.log('⚠️ 无法连接到 Antigravity 服务器');
    return;
  }

  // Workspaces
  try {
    const ws = await agApi('/api/workspaces');
    console.log(`📂 工作区: ${ws.workspaces?.length || 0} 个`);
  } catch { /* skip */ }

  // Model quota
  if (configs.length > 0) {
    console.log(`\n🤖 模型余量:\n`);
    for (const m of configs) {
      const quota = m.quotaInfo?.remainingFraction;
      if (quota !== undefined) {
        console.log(`  ${(m.label || '?').padEnd(20)} ${formatQuota(quota)}`);
      }
    }
  }

  // Active conversations
  try {
    const convs = await agApi('/api/conversations');
    const convList = Array.isArray(convs) ? convs : [];
    console.log(`\n💬 对话: ${convList.length} 个`);
  } catch { /* skip */ }
}

function formatQuota(fraction: number): string {
  const pct = Math.round(fraction * 100);
  const blocks = Math.round(fraction * 10);
  const bar = '█'.repeat(blocks) + '░'.repeat(10 - blocks);
  return `[${bar}] ${pct}%`;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  try {
    switch (cmd) {
      case 'models':
        await cmdModels();
        break;
      case 'model':
        if (!args[1]) {
          console.log('用法: /model <模型名称>');
          process.exit(1);
        }
        await cmdModel(args[1]);
        break;
      case 'status':
        await cmdStatus();
        break;
      default:
        console.log('可用命令: models, model <name>, status');
        process.exit(1);
    }
  } catch (e: any) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

main();
