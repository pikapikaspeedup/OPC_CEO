#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.env.LINUXDO_WATCH_WORKSPACE_ROOT || process.cwd());
const taskKey = 'linuxdo-ai-watch';
const taskTitle = 'Linux Do AI 情报监控';
const outputRoot = path.join(repoRoot, '.department', 'outputs', taskKey);
const briefDir = path.join(outputRoot, 'briefs');
const knowledgeDir = path.join(outputRoot, 'knowledge');
const rawDir = path.join(outputRoot, 'raw');
const cacheDir = path.join(outputRoot, 'cache');
const cachePath = path.join(cacheDir, 'state.json');
const indexPath = path.join(repoRoot, '.department', 'outputs', 'index.json');

function parseArgs(argv) {
  const args = {
    count: '30',
    hours: '2',
    levels: '1,2,3',
    source: 'new',
    minIntervalMinutes: 90,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--force') {
      args.force = true;
    } else if (key === '--count' && next) {
      args.count = next;
      i += 1;
    } else if (key === '--hours' && next) {
      args.hours = next;
      i += 1;
    } else if (key === '--levels' && next) {
      args.levels = next;
      i += 1;
    } else if (key === '--source' && next) {
      args.source = next;
      i += 1;
    } else if (key === '--min-interval-minutes' && next) {
      args.minIntervalMinutes = Number(next) || args.minIntervalMinutes;
      i += 1;
    }
  }
  return args;
}

function ensureDirs() {
  for (const dir of [briefDir, knowledgeDir, rawDir, cacheDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function timestampForFile(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function isoForTitle(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function topicKey(item) {
  return String(item.topic_id || item.topicId || item.id || item.url || item.link || item.title || '');
}

function hashPayload(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function payloadData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function payloadValue(payload, key, fallback) {
  const data = payloadData(payload);
  return data?.[key] ?? payload?.[key] ?? fallback;
}

function safeText(value, fallback = '') {
  return String(value || fallback).replace(/\r/g, '').trim();
}

function singleLine(value, fallback = '') {
  return safeText(value, fallback).replace(/\s+/g, ' ');
}

function truncateText(value, maxLength = 220) {
  const text = singleLine(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function joinList(value, fallback = '未标注') {
  const list = asArray(value).map((entry) => singleLine(entry)).filter(Boolean);
  return list.length > 0 ? list.join('、') : fallback;
}

function runBbBrowser(args) {
  const env = {
    ...process.env,
    PATH: `${process.env.HOME}/.bun/bin:/opt/homebrew/bin:${process.env.PATH || ''}`,
  };
  const outputPath = path.join(cacheDir, `bb-browser-output-${Date.now()}.json`);
  const outputFd = fs.openSync(outputPath, 'w');
  let result;
  try {
    result = spawnSync('bb-browser', [
      'site',
      'linuxdo/ai-watch',
      String(args.count),
      '--hours',
      String(args.hours),
      '--levels',
      String(args.levels),
      '--source',
      String(args.source),
      '--json',
    ], {
      cwd: repoRoot,
      env,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['ignore', outputFd, 'pipe'],
    });
  } finally {
    fs.closeSync(outputFd);
  }

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || fs.readFileSync(outputPath, 'utf-8') || `bb-browser exited ${result.status}`).trim());
  }
  const stdout = fs.readFileSync(outputPath, 'utf-8');
  try {
    const payload = JSON.parse(stdout);
    fs.rmSync(outputPath, { force: true });
    return payload;
  } catch (error) {
    throw new Error(
      `Failed to parse bb-browser JSON output at ${outputPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function candidateList(payload) {
  for (const container of [payload, payloadData(payload)]) {
    if (Array.isArray(container?.items)) return container.items;
    if (Array.isArray(container?.candidates)) return container.candidates;
    if (Array.isArray(container?.topics)) return container.topics;
    if (Array.isArray(container?.results)) return container.results;
  }
  return [];
}

function isDecryptionLikePost(item) {
  const brief = item.brief || {};
  const explicitHaystack = [
    item.title,
    item.safe_excerpt,
    brief.headline,
    ...asArray(item.tags),
  ].map((value) => singleLine(value).toLowerCase()).join(' ');
  if (/解密|加密|寻找答案|答案类|谜题|接码|验证码|challenge|coeeapi/.test(explicitHaystack)) {
    return true;
  }
  return asArray(item.matched_terms).some((term) => /^(token|api[-_ ]?key|key|接码|验证码)$/i.test(singleLine(term)));
}

function safetySummary(item) {
  const safety = item.safety || {};
  const indicators = joinList(safety.restricted_indicators);
  if (safety.contains_raw_steps || asArray(safety.restricted_indicators).length > 0) {
    return `原帖包含受限细节，采集器已按 ${safety.redaction || 'safe-summary'} 处理；受限指标：${indicators}。`;
  }
  return `采集器未标记可执行受限步骤；仍按内部情报复核口径保存摘要。`;
}

function knowledgeRelativePath(item, stamp, index) {
  const key = topicKey(item) || `item-${index + 1}`;
  const stableKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || `item-${index + 1}`;
  const digest = hashPayload([key, item.title, item.url || item.link || item.topic_url]);
  return `.department/outputs/${taskKey}/knowledge/${stamp}-${String(index + 1).padStart(2, '0')}-${stableKey}-${digest}.md`;
}

function knowledgeTags(item) {
  const tags = [
    'department-output',
    'task:linuxdo-ai-watch',
    'audience:ceo',
    'ai-intel',
    'linuxdo',
    'knowledge-base',
    'ai-abuse-watch',
  ];
  for (const signal of asArray(item.signal_types)) {
    const normalized = singleLine(signal).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
    if (normalized) tags.push(`signal:${normalized}`);
  }
  for (const term of asArray(item.matched_terms).slice(0, 6)) {
    const normalized = singleLine(term).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
    if (normalized) tags.push(`term:${normalized}`);
  }
  if (isDecryptionLikePost(item)) tags.push('encrypted-or-puzzle-post');
  if (item.safety?.contains_raw_steps) tags.push('safety:redacted');
  return [...new Set(tags)];
}

function buildKnowledgeMarkdown(item, index, rawRelativePath, now) {
  const brief = item.brief || {};
  const title = singleLine(brief.headline || item.title || `线索 ${index + 1}`);
  const link = item.url || item.link || item.topic_url || '';
  const riskLabel = singleLine(brief.risk_label || 'AI 风险线索');
  const detail = safeText(brief.detail || brief.share_text || item.safe_excerpt || item.excerpt || item.summary, '暂无可分享摘要。');
  const shareText = safeText(brief.share_text || detail);
  const whyWatch = safeText(brief.why_watch || item.reason || '需要人工判断是否形成可报告风险。');
  const targets = joinList(brief.target_hint);
  const signals = joinList(item.signal_types);
  const matchedTerms = joinList(item.matched_terms);
  const topicTags = joinList(item.tags);
  const author = item.author?.username ? `@${item.author.username}` : '未标注';
  const trustLevel = item.author?.trust_level ?? item.trust_level ?? '未标注';
  const encryptedLike = isDecryptionLikePost(item) ? '是' : '否';

  return `${[
    `# ${title}`,
    '',
    '## 基础信息',
    '',
    `- 来源：Linux Do`,
    `- 原帖：${link || '未提供'}`,
    `- 话题 ID：${topicKey(item) || '未标注'}`,
    `- 作者：${author}`,
    `- 作者等级：${trustLevel}`,
    `- 发布时间：${item.created_at || item.createdAt || '未标注'}`,
    `- 采集时间：${now.toISOString()}`,
    `- 信号评分：${item.signal_score ?? '未标注'}`,
    `- 风险标签：${riskLabel}`,
    `- 加密/解密/答案类线索：${encryptedLike}`,
    '',
    '## 信息点解读',
    '',
    `1. 线索主题：该帖被归类为“${riskLabel}”，标题和摘要指向“${title}”。`,
    `2. 涉及对象：目标提示为 ${targets}；论坛标签为 ${topicTags}。`,
    `3. 命中信号：规则信号为 ${signals}；命中词为 ${matchedTerms}。`,
    `4. 内容含义：${detail}`,
    `5. 情报价值：${whyWatch}`,
    `6. 知识库沉淀：后续复核时应记录影响对象、获取方式类别、是否可规模化、是否涉及转售/中转/API 调用，以及是否只是普通产品体验讨论。`,
    '',
    '## 可分享摘要',
    '',
    shareText,
    '',
    '## 复核问题',
    '',
    '- 这个线索影响的是注册、支付、额度、模型访问、中转、插件还是账号体系？',
    '- 是否存在可重复、可规模化或可转售的模式？',
    '- 是否只是正常产品体验、故障讨论或传闻？',
    '- 是否需要进入日报、风险台账或供应商观察列表？',
    '',
    '## 安全处理',
    '',
    safetySummary(item),
    '本知识条目只保留防御性、高层次解读，不保存可执行绕过步骤、密钥、账号、支付路径或具体接口滥用细节。',
    '',
    '## 原始采集',
    '',
    `- 原始 JSON：${rawRelativePath}`,
    '',
  ].join('\n')}\n`;
}

function createKnowledgeRecord(item, index, stamp, rawRelativePath, now) {
  const relativePath = knowledgeRelativePath(item, stamp, index);
  const brief = item.brief || {};
  const title = singleLine(brief.headline || item.title || `Linux Do AI 情报知识 ${index + 1}`);
  const detail = brief.detail || brief.share_text || item.safe_excerpt || item.excerpt || item.summary || '暂无可分享摘要。';
  fs.writeFileSync(path.join(repoRoot, relativePath), buildKnowledgeMarkdown(item, index, rawRelativePath, now), 'utf-8');
  return {
    relativePath,
    title,
    indexItem: {
      id: `${taskKey}:knowledge:${topicKey(item) || hashPayload(item)}`,
      title,
      kind: 'knowledge',
      taskKey,
      taskTitle,
      audience: 'ceo',
      status: 'needs-review',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      summary: truncateText(detail),
      markdownPath: relativePath,
      tags: knowledgeTags(item),
      source: {
        type: 'file',
        artifactPath: relativePath,
      },
    },
  };
}

function formatCandidate(item, index) {
  const brief = item.brief || {};
  const title = brief.headline || item.title || `线索 ${index + 1}`;
  const detail = brief.share_text || brief.detail || item.excerpt || item.summary || '暂无可分享摘要。';
  const why = brief.why_watch || item.reason || '';
  const link = item.url || item.link || item.topic_url || '';
  return [
    `### ${index + 1}. ${title}`,
    '',
    detail,
    '',
    why ? `关注原因：${why}` : '',
    link ? `原帖：${link}` : '',
  ].filter(Boolean).join('\n');
}

function buildMarkdown(payload, freshItems, rawRelativePath, knowledgeRecords, now) {
  const data = payloadData(payload);
  const inspected = payloadValue(payload, 'inspected_topics', payloadValue(payload, 'inspected', 0));
  const skippedPayload = payloadValue(payload, 'skipped', undefined);
  const skipped = skippedPayload ? JSON.stringify(skippedPayload) : '';
  const source = payloadValue(payload, 'source', 'Linux Do');
  const mode = payloadValue(payload, 'mode', payloadValue(payload, 'source', 'new'));
  const hours = payloadValue(payload, 'window_hours', payloadValue(payload, 'hours', '2'));
  const lines = [
    `# Linux Do AI 情报简报 ${isoForTitle(now)}`,
    '',
    `- 来源：${source} /${mode} 话题流`,
    `- 窗口：最近 ${hours} 小时`,
    `- 账号等级：${joinList(data.levels, 'LV1-LV3')}`,
    `- 本轮有效新线索：${freshItems.length}`,
    `- 新增知识条目：${knowledgeRecords.length}`,
    `- 检查话题数：${inspected}`,
    skipped ? `- 过滤情况：${skipped}` : '',
    `- 原始数据：${rawRelativePath}`,
    '',
    '## 本轮可读结论',
    '',
    freshItems.length > 0
      ? freshItems.map(formatCandidate).join('\n\n')
      : '本轮没有发现新的高价值 AI 异常获取或免费额度滥用线索。',
    '',
    '## 知识库条目',
    '',
    knowledgeRecords.length > 0
      ? knowledgeRecords.map((record, index) => `${index + 1}. ${record.title}：${record.relativePath}`).join('\n')
      : '本轮没有新增知识条目。',
    '',
    '## 复核说明',
    '',
    '本简报只保留可分享的安全摘要。涉及具体绕过步骤、密钥、接口、账号或可执行滥用路径的内容已由采集器降级为高层风险描述。',
    '',
  ].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

function updateIndexItems(newItems) {
  const current = readJson(indexPath, { items: [] });
  const items = Array.isArray(current.items) ? current.items : [];
  const newIds = new Set(newItems.map((item) => item.id));
  const nextItems = [...newItems, ...items.filter((existing) => !newIds.has(existing.id))]
    .slice(0, 500);
  writeJson(indexPath, {
    updatedAt: new Date().toISOString(),
    items: nextItems,
  });
}

function main() {
  ensureDirs();
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const state = readJson(cachePath, { seenTopicKeys: [] });
  const lastFetchAt = state.lastFetchAt ? new Date(state.lastFetchAt).getTime() : 0;
  const minIntervalMs = args.minIntervalMinutes * 60 * 1000;

  if (!args.force && lastFetchAt && Date.now() - lastFetchAt < minIntervalMs) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'cache-window',
      lastFetchAt: state.lastFetchAt,
      minIntervalMinutes: args.minIntervalMinutes,
    }, null, 2));
    return;
  }

  const payload = runBbBrowser(args);
  const allItems = candidateList(payload);
  const seen = new Set(Array.isArray(state.seenTopicKeys) ? state.seenTopicKeys : []);
  const freshItems = allItems.filter((item) => {
    const key = topicKey(item);
    return key && !seen.has(key);
  });
  for (const item of allItems) {
    const key = topicKey(item);
    if (key) seen.add(key);
  }

  const stamp = timestampForFile(now);
  const rawRelativePath = `.department/outputs/${taskKey}/raw/${stamp}.json`;
  const briefRelativePath = `.department/outputs/${taskKey}/briefs/${stamp}.md`;
  const rawPath = path.join(repoRoot, rawRelativePath);
  const briefPath = path.join(repoRoot, briefRelativePath);
  writeJson(rawPath, {
    fetchedAt: now.toISOString(),
    args,
    freshCount: freshItems.length,
    payload,
  });
  const knowledgeRecords = freshItems.map((item, index) =>
    createKnowledgeRecord(item, index, stamp, rawRelativePath, now),
  );
  fs.writeFileSync(briefPath, buildMarkdown(payload, freshItems, rawRelativePath, knowledgeRecords, now), 'utf-8');

  const outputId = `${taskKey}:${stamp}:${hashPayload(freshItems.map(topicKey))}`;
  updateIndexItems([{
    id: outputId,
    title: `Linux Do AI 情报简报 ${isoForTitle(now)}`,
    kind: 'brief',
    taskKey,
    taskTitle,
    audience: 'ceo',
    status: freshItems.length > 0 ? 'needs-review' : 'active',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    summary: freshItems.length > 0
      ? `本轮发现 ${freshItems.length} 条新的高价值线索，建议人工复核。`
      : '本轮没有发现新的高价值线索。',
    markdownPath: briefRelativePath,
    tags: ['department-output', 'task:linuxdo-ai-watch', 'audience:ceo', 'ai-intel', 'linuxdo', 'ai-abuse-watch'],
    source: {
      type: 'file',
      artifactPath: briefRelativePath,
    },
  }, ...knowledgeRecords.map((record) => record.indexItem)]);

  writeJson(cachePath, {
    lastFetchAt: now.toISOString(),
    lastOutputPath: briefRelativePath,
    lastRawPath: rawRelativePath,
    lastKnowledgePaths: knowledgeRecords.map((record) => record.relativePath),
    seenTopicKeys: Array.from(seen).slice(-500),
    lastFreshCount: freshItems.length,
    lastKnowledgeCount: knowledgeRecords.length,
  });

  console.log(JSON.stringify({
    ok: true,
    skipped: false,
    outputPath: briefRelativePath,
    rawPath: rawRelativePath,
    knowledgePaths: knowledgeRecords.map((record) => record.relativePath),
    totalCandidates: allItems.length,
    freshCandidates: freshItems.length,
    knowledgeCount: knowledgeRecords.length,
  }, null, 2));
}

main();
