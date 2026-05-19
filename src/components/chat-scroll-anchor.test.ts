import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  vi.resetModules();
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

vi.mock('@/components/locale-provider', () => ({
  useI18n: () => ({ locale: 'zh', t: (key: string) => key, setLocale: () => undefined }),
  LocaleProvider: ({ children }: { children: unknown }) => children,
}));

describe('chat scroll anchor helpers', () => {
  it('round-trips a scroll position keyed by conversation id', async () => {
    const { __chatScrollAnchorTestApi } = await import('./chat');
    const { readScrollAnchor, writeScrollAnchor } = __chatScrollAnchorTestApi;

    expect(readScrollAnchor('thread-a')).toBeNull();
    writeScrollAnchor('thread-a', 412);
    expect(readScrollAnchor('thread-a')).toBe(412);
  });

  it('isolates scroll positions across conversations', async () => {
    const { __chatScrollAnchorTestApi } = await import('./chat');
    const { readScrollAnchor, writeScrollAnchor } = __chatScrollAnchorTestApi;

    writeScrollAnchor('thread-a', 100);
    writeScrollAnchor('thread-b', 320);

    expect(readScrollAnchor('thread-a')).toBe(100);
    expect(readScrollAnchor('thread-b')).toBe(320);
  });

  it('rounds and clamps negative values to zero', async () => {
    const { __chatScrollAnchorTestApi } = await import('./chat');
    const { readScrollAnchor, writeScrollAnchor } = __chatScrollAnchorTestApi;

    writeScrollAnchor('thread-x', -50);
    expect(readScrollAnchor('thread-x')).toBe(0);

    writeScrollAnchor('thread-x', 134.7);
    expect(readScrollAnchor('thread-x')).toBe(135);
  });

  it('returns null for a corrupted stored value', async () => {
    const { __chatScrollAnchorTestApi } = await import('./chat');
    const { readScrollAnchor, storageKey } = __chatScrollAnchorTestApi;

    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage
      .setItem(`${storageKey}:thread-broken`, 'not-a-number');

    expect(readScrollAnchor('thread-broken')).toBeNull();
  });

  it('silently ignores write failures when sessionStorage throws', async () => {
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

    const { __chatScrollAnchorTestApi } = await import('./chat');
    expect(() => __chatScrollAnchorTestApi.writeScrollAnchor('thread-y', 12)).not.toThrow();
  });
});
