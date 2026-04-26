'use client';

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean((window as TauriWindow).__TAURI_INTERNALS__);
}

export async function selectLocalFolder(title = '选择部门文件夹'): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });

  return typeof selected === 'string' ? selected : null;
}

