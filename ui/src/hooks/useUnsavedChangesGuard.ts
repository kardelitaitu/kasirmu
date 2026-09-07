import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@/api/tauri';

/**
 * True only inside a Tauri webview. Mirrors the check in `useFullscreen` so
 * the same seam behaves identically in the browser dev preview (:1420) and in
 * the packaged desktop app.
 */
function isTauri(): boolean {
  try {
    return '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}

export interface UnsavedChangesGuard {
  /** Render a confirmation prompt bound to these handlers while true. */
  promptOpen: boolean;
  /** Dismiss the prompt and leave the window open. */
  onKeepEditing: () => void;
  /** Proceed with the close the user originally requested. */
  onDiscardAndClose: () => void;
}

/**
 * Guard unsaved work against the user closing the window.
 *
 * `beforeunload` alone is NOT enough in a desktop build: when the window close
 * button is pressed, Tauri's Rust event loop decides whether the window goes
 * away, and the webview's `beforeunload` prompt is never surfaced. The
 * supported seam is `onCloseRequested` + `event.preventDefault()`.
 *
 * Both are wired here — `beforeunload` still protects tab close and in-app
 * reload in the browser preview, `onCloseRequested` protects the real window.
 *
 * The caller owns the prompt UI. Render a <ConfirmDialog> on `promptOpen` and
 * wire its buttons to `onKeepEditing` / `onDiscardAndClose`; this hook stays
 * free of markup so the app's designed dialog is used rather than a native one.
 */
export function useUnsavedChangesGuard(isDirty: boolean): UnsavedChangesGuard {
  const [promptOpen, setPromptOpen] = useState(false);

  // Read through refs so both listeners register exactly once. A closure over
  // `isDirty` would either need re-registration on every keystroke or go stale
  // and let the window close with unsaved work.
  const dirtyRef = useRef(isDirty);
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  // One-way latch. `win.close()` re-enters onCloseRequested; without this the
  // discard path would intercept its own close and never finish.
  const allowCloseRef = useRef(false);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // WebView2/Chromium need a non-empty returnValue for the dialog to show;
      // the string itself is never displayed.
      e.returnValue = 'unsaved';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowCloseRef.current || !dirtyRef.current) return;
        event.preventDefault();
        setPromptOpen(true);
      })
      .then((fn) => {
        // Registration is async; the component may already be gone.
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const onKeepEditing = useCallback(() => {
    setPromptOpen(false);
  }, []);

  const onDiscardAndClose = useCallback(() => {
    setPromptOpen(false);
    allowCloseRef.current = true;
    void getCurrentWindow().close();
  }, []);

  return { promptOpen, onKeepEditing, onDiscardAndClose };
}
