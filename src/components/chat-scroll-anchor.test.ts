import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHAT_SCROLL_STORAGE_KEY,
  readScrollAnchor,
  writeScrollAnchor,
} from './chat-scroll-anchor';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

const originalWindow = (globalThis as unknown as { window?: unknown }).window;

beforeEach(() => {
  const storage = new MemoryStorage();
  Object.assign(globalThis, {
    window: { sessionStorage: storage },
    sessionStorage: storage,
  });
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
  } else {
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  }
});

describe('chat scroll anchor helpers', () => {
  it('round-trips a scroll position keyed by conversation id', () => {
    expect(readScrollAnchor('thread-a')).toBeNull();
    writeScrollAnchor('thread-a', 412);
    expect(readScrollAnchor('thread-a')).toBe(412);
  });

  it('isolates scroll positions across conversations', () => {
    writeScrollAnchor('thread-a', 100);
    writeScrollAnchor('thread-b', 320);

    expect(readScrollAnchor('thread-a')).toBe(100);
    expect(readScrollAnchor('thread-b')).toBe(320);
  });

  it('rounds and clamps negative values to zero', () => {
    writeScrollAnchor('thread-x', -50);
    expect(readScrollAnchor('thread-x')).toBe(0);

    writeScrollAnchor('thread-x', 134.7);
    expect(readScrollAnchor('thread-x')).toBe(135);
  });

  it('returns null for a corrupted stored value', () => {
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage
      .setItem(`${CHAT_SCROLL_STORAGE_KEY}:thread-broken`, 'not-a-number');

    expect(readScrollAnchor('thread-broken')).toBeNull();
  });

  it('silently ignores write failures when sessionStorage throws', () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;

    Object.assign(globalThis, {
      window: { sessionStorage: throwingStorage },
      sessionStorage: throwingStorage,
    });

    expect(() => writeScrollAnchor('thread-y', 12)).not.toThrow();
  });
});
