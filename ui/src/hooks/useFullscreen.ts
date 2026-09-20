import { useEffect, useCallback, useRef } from 'react';
import { getCurrentWindow, isTauriWebview } from '@/api/tauri';

async function tauriToggleFS(): Promise<boolean> {
  const win = getCurrentWindow();
  const fs = await win.isFullscreen();
  const newState = !fs;
  await win.setFullscreen(newState);
  return newState;
}

function browserToggleFS(): Promise<boolean> {
  if (document.fullscreenElement) {
    return document.exitFullscreen().then(() => false);
  }
  return document.documentElement.requestFullscreen().then(() => true);
}

/**
 * Hook that provides a toggleFullscreen function and sets up a global F11
 * keydown listener to toggle fullscreen mode.
 *
 * Uses the Tauri window API when running inside the native window, otherwise
 * falls back to the browser Fullscreen API for dev mode.
 *
 * @param onToggle Optional callback fired after the fullscreen state changes.
 *   Receives `true` when entering fullscreen, `false` when exiting.
 * @param options.enabled Whether the global F11 listener is active (default
 *   `true`). Pass `false` when another surface owns F11 — e.g. the retail POS
 *   assigns F11 to Quick Return, so the shell disables the global fullscreen
 *   binding while the store-pos workspace is active (KEY-01). The returned
 *   `toggleFullscreen` function remains available regardless, for buttons.
 */
export function useFullscreen(
  onToggle?: (isFullscreen: boolean) => void,
  options?: { enabled?: boolean },
) {
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  const toggle = useCallback(async () => {
    try {
      const newState = isTauriWebview() ? await tauriToggleFS() : await browserToggleFS();
      onToggleRef.current?.(newState);
    } catch (err) {
      console.warn('[useFullscreen] toggle failed:', err);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    toggle();
  }, [toggle]);

  const enabled = options?.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggle, enabled]);

  return { toggleFullscreen };
}
