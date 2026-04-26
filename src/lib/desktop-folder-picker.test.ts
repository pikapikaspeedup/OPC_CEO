import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTauriDesktop, selectLocalFolder } from './desktop-folder-picker';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('desktop-folder-picker', () => {
  it('detects non-desktop runtime when window is absent', () => {
    vi.stubGlobal('window', undefined);

    expect(isTauriDesktop()).toBe(false);
  });

  it('detects tauri desktop runtime from injected internals', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });

    expect(isTauriDesktop()).toBe(true);
  });

  it('does not load native dialog bindings outside tauri', async () => {
    vi.stubGlobal('window', {});

    await expect(selectLocalFolder()).resolves.toBeNull();
  });
});

