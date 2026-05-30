export const CHAT_SCROLL_STORAGE_KEY = 'ceo-office:chat-scroll';

export function readScrollAnchor(conversationId: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${CHAT_SCROLL_STORAGE_KEY}:${conversationId}`);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeScrollAnchor(conversationId: string, value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${CHAT_SCROLL_STORAGE_KEY}:${conversationId}`, String(Math.max(0, Math.round(value))));
  } catch {
    // sessionStorage may be unavailable (private mode); ignore silently.
  }
}
