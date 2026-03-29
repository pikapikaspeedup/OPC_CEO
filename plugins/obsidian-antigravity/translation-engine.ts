/**
 * Translation Engine — Block-level multilingual translation with caching.
 *
 * Core responsibilities:
 * 1. Split markdown into translatable blocks (preserving structure)
 * 2. Hash blocks for incremental change detection
 * 3. Translate via Copilot API with format preservation
 * 4. Cache translations in IndexedDB for fast retrieval
 * 5. Detect stale blocks and retranslate only what changed
 */

import { App } from 'obsidian';
import { callCopilot } from './copilot-api';
import type { CopilotCredentials } from './copilot-auth';
import { logger } from './logger';

const LOG_SRC = 'Translation';

// ── Types ──

export type SupportedLang = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de';

export const LANG_LABELS: Record<SupportedLang, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

export interface TranslatedBlock {
  index: number;
  sourceHash: string;
  sourceText: string;
  translatedText: string;
  isStale: boolean;
}

export interface TranslationEntry {
  sourcePath: string;
  sourceContentHash: string;
  targetLang: SupportedLang;
  blocks: TranslatedBlock[];
  fullTranslation: string;
  lastTranslated: number;
  staleBlockCount: number;
}

// ── Block Splitting ──

interface ContentBlock {
  index: number;
  text: string;
  translatable: boolean;
}

export function splitIntoBlocks(content: string): ContentBlock[] {
  if (!content) return [];

  const blocks: ContentBlock[] = [];
  const lines = content.split('\n');
  let current: string[] = [];
  let inCodeFence = false;
  let inFrontmatter = false;
  let blockIndex = 0;

  const flush = (translatable: boolean) => {
    if (current.length > 0) {
      blocks.push({
        index: blockIndex++,
        text: current.join('\n'),
        translatable,
      });
      current = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line === '---') {
      inFrontmatter = true;
      current.push(line);
      continue;
    }
    if (inFrontmatter) {
      current.push(line);
      if (line === '---') {
        inFrontmatter = false;
        flush(false);
      }
      continue;
    }

    if (line.startsWith('```')) {
      if (!inCodeFence) {
        flush(true);
        inCodeFence = true;
        current.push(line);
      } else {
        current.push(line);
        inCodeFence = false;
        flush(false);
      }
      continue;
    }

    if (inCodeFence) {
      current.push(line);
      continue;
    }

    if (line.trim() === '') {
      flush(true);
      blocks.push({ index: blockIndex++, text: '', translatable: false });
      continue;
    }

    if (line.startsWith('#') && current.length > 0) {
      flush(true);
    }

    current.push(line);
  }

  if (inCodeFence) {
    flush(false);
  } else {
    flush(true);
  }

  return blocks;
}

export function assembleBlocks(blocks: { text: string }[]): string {
  return blocks.map((block) => block.text).join('\n');
}

// ── Hashing ──

export function hashString(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// ── Translation Cache (IndexedDB) ──

const DB_NAME = 'antigravity-translations';
const DB_VERSION = 1;
const STORE_NAME = 'translations';

function cacheKey(path: string, lang: SupportedLang): string {
  return `${lang}::${path}`;
}

export class TranslationCache {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async get(path: string, lang: SupportedLang): Promise<TranslationEntry | null> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey(path, lang));
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async put(entry: TranslationEntry): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const key = cacheKey(entry.sourcePath, entry.targetLang);
      const req = store.put({ key, data: entry });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(path: string, lang: SupportedLang): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(cacheKey(path, lang));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deleteAllForPath(path: string): Promise<void> {
    await this.open();
    const tx = this.db!.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if ((cursor.value.key as string).includes(`::${path}`)) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

// ── Language Detection ──

export function detectLanguage(text: string): SupportedLang {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
  const jp = text.match(/[\u3040-\u309f\u30a0-\u30ff]/g)?.length ?? 0;
  const kr = text.match(/[\uac00-\ud7af\u1100-\u11ff]/g)?.length ?? 0;
  const total = text.length || 1;

  if (jp / total > 0.05) return 'ja';
  if (kr / total > 0.05) return 'ko';
  if (cjk / total > 0.1) return 'zh';
  return 'en';
}

// ── Translation Engine ──

const TRANSLATION_SYSTEM_PROMPT = `You are a professional document translator. Your task:
1. Translate the given markdown text to the target language.
2. PRESERVE ALL markdown formatting exactly: headings (#), bold (**), italic (*), links ([]()), images (![]()),  lists (- / 1.), blockquotes (>), tables, inline code (\`\`), and wikilinks ([[...]]).
3. Do NOT translate: code blocks, file paths, URLs, variable names, frontmatter keys, tag names (#tag).
4. Translate naturally — not word-by-word. Adapt idioms and phrasing for the target language.
5. Output ONLY the translated text. No explanations, no wrapping.`;

export class TranslationEngine {
  private cache: TranslationCache;
  private getCredentials: () => CopilotCredentials | null;
  private onCredentialsRefreshed: (c: CopilotCredentials) => void;
  private translatingPaths = new Set<string>();

  constructor(
    private app: App,
    getCredentials: () => CopilotCredentials | null,
    onCredentialsRefreshed: (c: CopilotCredentials) => void,
  ) {
    this.cache = new TranslationCache();
    this.getCredentials = getCredentials;
    this.onCredentialsRefreshed = onCredentialsRefreshed;
  }

  getCache(): TranslationCache { return this.cache; }

  async getCachedTranslation(path: string, targetLang: SupportedLang): Promise<TranslationEntry | null> {
    return this.cache.get(path, targetLang);
  }

  async isCacheFresh(path: string, targetLang: SupportedLang, currentContent: string): Promise<boolean> {
    const entry = await this.cache.get(path, targetLang);
    if (!entry) return false;
    return entry.sourceContentHash === hashString(currentContent);
  }

  async translateFile(
    path: string,
    content: string,
    targetLang: SupportedLang,
    onProgress?: (done: number, total: number) => void,
  ): Promise<string | null> {
    if (this.translatingPaths.has(path)) {
      logger.warn(LOG_SRC, 'Translation already in progress', { path });
      return null;
    }

    this.translatingPaths.add(path);
    try {
      return await this.doTranslate(path, content, targetLang, onProgress);
    } finally {
      this.translatingPaths.delete(path);
    }
  }

  private async doTranslate(
    path: string,
    content: string,
    targetLang: SupportedLang,
    onProgress?: (done: number, total: number) => void,
  ): Promise<string | null> {
    const contentHash = hashString(content);
    const blocks = splitIntoBlocks(content);
    const existing = await this.cache.get(path, targetLang);

    const prevBlockMap = new Map<string, string>();
    if (existing) {
      for (const block of existing.blocks) {
        if (!block.isStale) {
          prevBlockMap.set(block.sourceHash, block.translatedText);
        }
      }
    }

    const translatedBlocks: TranslatedBlock[] = [];
    const toTranslate: { block: ContentBlock; hash: string }[] = [];

    for (const block of blocks) {
      const blockHash = hashString(block.text);
      if (!block.translatable || block.text.trim() === '') {
        translatedBlocks.push({
          index: block.index,
          sourceHash: blockHash,
          sourceText: block.text,
          translatedText: block.text,
          isStale: false,
        });
      } else if (prevBlockMap.has(blockHash)) {
        translatedBlocks.push({
          index: block.index,
          sourceHash: blockHash,
          sourceText: block.text,
          translatedText: prevBlockMap.get(blockHash)!,
          isStale: false,
        });
      } else {
        toTranslate.push({ block, hash: blockHash });
        translatedBlocks.push({
          index: block.index,
          sourceHash: blockHash,
          sourceText: block.text,
          translatedText: '',
          isStale: true,
        });
      }
    }

    const totalToTranslate = toTranslate.length;
    logger.info(LOG_SRC, `Translating ${path} -> ${targetLang}`, {
      totalBlocks: blocks.length,
      cachedBlocks: blocks.length - totalToTranslate,
      toTranslate: totalToTranslate,
    });

    if (totalToTranslate === 0) {
      const full = assembleBlocks(translatedBlocks.map((block) => ({ text: block.translatedText })));
      const entry: TranslationEntry = {
        sourcePath: path,
        sourceContentHash: contentHash,
        targetLang,
        blocks: translatedBlocks,
        fullTranslation: full,
        lastTranslated: Date.now(),
        staleBlockCount: 0,
      };
      await this.cache.put(entry);
      return full;
    }

    const batches = this.buildBatches(toTranslate);
    let done = 0;

    for (const batch of batches) {
      const batchText = batch.map((item) => item.block.text).join('\n\n---BLOCK_SEP---\n\n');
      const langName = LANG_LABELS[targetLang];

      try {
        const result = await callCopilot(
          this.getCredentials,
          this.onCredentialsRefreshed,
          TRANSLATION_SYSTEM_PROMPT,
          `Translate to ${langName}:\n\n${batchText}`,
          { model: 'gpt-4o', maxTokens: 4096, temperature: 0.1, maxContentChars: 12000 },
        );

        const parts = batch.length > 1
          ? result.split(/---BLOCK_SEP---/g).map((part) => part.trim())
          : [result.trim()];

        for (let i = 0; i < batch.length; i++) {
          const translated = parts[i] ?? parts[parts.length - 1] ?? batch[i].block.text;
          const blockEntry = translatedBlocks.find((block) => block.index === batch[i].block.index);
          if (blockEntry) {
            blockEntry.translatedText = translated;
            blockEntry.isStale = false;
          }
        }

        done += batch.length;
        onProgress?.(done, totalToTranslate);
      } catch (e) {
        logger.error(LOG_SRC, 'Block translation failed', { error: (e as Error).message });
        for (const item of batch) {
          const blockEntry = translatedBlocks.find((block) => block.index === item.block.index);
          if (blockEntry) {
            blockEntry.translatedText = item.block.text;
            blockEntry.isStale = true;
          }
        }
        done += batch.length;
        onProgress?.(done, totalToTranslate);
      }
    }

    const staleCount = translatedBlocks.filter((block) => block.isStale).length;
    const full = assembleBlocks(translatedBlocks.map((block) => ({ text: block.translatedText })));

    const entry: TranslationEntry = {
      sourcePath: path,
      sourceContentHash: contentHash,
      targetLang,
      blocks: translatedBlocks,
      fullTranslation: full,
      lastTranslated: Date.now(),
      staleBlockCount: staleCount,
    };
    await this.cache.put(entry);

    logger.info(LOG_SRC, `Translation complete: ${path}`, { staleCount });
    return full;
  }

  private buildBatches(items: { block: ContentBlock; hash: string }[]): typeof items[] {
    const batches: typeof items[] = [];
    let currentBatch: typeof items = [];
    let currentLen = 0;
    const maxBatchChars = 3000;

    for (const item of items) {
      if (currentLen + item.block.text.length > maxBatchChars && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentLen = 0;
      }
      currentBatch.push(item);
      currentLen += item.block.text.length;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);
    return batches;
  }

  async getStaleSummary(path: string, content: string, targetLang: SupportedLang): Promise<{
    hasCached: boolean;
    totalBlocks: number;
    staleBlocks: number;
    freshBlocks: number;
  }> {
    const blocks = splitIntoBlocks(content);
    const existing = await this.cache.get(path, targetLang);

    if (!existing) {
      const translatableCount = blocks.filter((block) => block.translatable && block.text.trim() !== '').length;
      return { hasCached: false, totalBlocks: blocks.length, staleBlocks: translatableCount, freshBlocks: 0 };
    }

    const prevHashSet = new Set(existing.blocks.filter((block) => !block.isStale).map((block) => block.sourceHash));
    let stale = 0;
    let fresh = 0;

    for (const block of blocks) {
      if (!block.translatable || block.text.trim() === '') continue;
      const hash = hashString(block.text);
      if (prevHashSet.has(hash)) {
        fresh++;
      } else {
        stale++;
      }
    }

    return { hasCached: true, totalBlocks: blocks.length, staleBlocks: stale, freshBlocks: fresh };
  }

  async onFileRenamed(oldPath: string, newPath: string): Promise<void> {
    for (const lang of Object.keys(LANG_LABELS) as SupportedLang[]) {
      const entry = await this.cache.get(oldPath, lang);
      if (entry) {
        entry.sourcePath = newPath;
        await this.cache.put(entry);
        await this.cache.delete(oldPath, lang);
      }
    }
  }

  async onFileDeleted(path: string): Promise<void> {
    await this.cache.deleteAllForPath(path);
  }

  async clearCache(path: string, targetLang: SupportedLang): Promise<void> {
    await this.cache.delete(path, targetLang);
  }

  isTranslating(path: string): boolean {
    return this.translatingPaths.has(path);
  }
}