/**
 * useUnsavedChangesGuard — desktop close semantics.
 *
 * Background (UX audit): SettingsPage protected unsaved work with a
 * `beforeunload` listener alone. In a Tauri window the OS close button does
 * not surface that handler — the webview is torn down when the Rust event loop
 * accepts the close — so the protection was inert in the desktop app and only
 * worked in the browser dev preview. The supported seam is
 * `getCurrentWindow().onCloseRequested()` + `event.preventDefault()`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';

// ── Tauri window mock ──────────────────────────────────────────────

interface FakeCloseEvent {
  prevented: boolean;
  preventDefault: () => void;
  isPreventDefault: () => boolean;
}

const m = vi.hoisted(() => {
  const handlers: Array<(e: FakeCloseEvent) => void> = [];
  const unlisten = vi.fn();
  const close = vi.fn();
  const onCloseRequested = vi.fn((h: (e: FakeCloseEvent) => void) => {
    handlers.push(h);
    return Promise.resolve(unlisten);
  });
  return { handlers, unlisten, close, onCloseRequested };
});

vi.mock('@/api/tauri', () => ({
  getCurrentWindow: () => ({ onCloseRequested: m.onCloseRequested, close: m.close }),
}));

/** Toggle the seam `isTauri()` probes. Bracket notation is required by the
 *  repo's noPropertyAccessFromIndexSignature rule. */
function setTauri(on: boolean): void {
  const w = window as unknown as Record<string, unknown>;
  if (on) w['__TAURI_INTERNALS__'] = {};
  else delete w['__TAURI_INTERNALS__'];
}

function makeCloseEvent(): FakeCloseEvent {
  const e: FakeCloseEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    isPreventDefault: () => e.prevented,
  };
  return e;
}

/** Fire the close request the way the Tauri runtime would. */
function requestClose(): FakeCloseEvent {
  const e = makeCloseEvent();
  const h = m.handlers[m.handlers.length - 1];
  if (!h) throw new Error('no onCloseRequested handler registered');
  act(() => {
    h(e);
  });
  return e;
}

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    m.handlers.length = 0;
    m.unlisten.mockClear();
    m.close.mockClear();
    m.onCloseRequested.mockClear();
    setTauri(true);
  });

  afterEach(() => {
    setTauri(false);
  });

  it('registers a Tauri close handler when running under Tauri', () => {
    renderHook(() => useUnsavedChangesGuard(false));
    expect(m.onCloseRequested).toHaveBeenCalledTimes(1);
  });

  it('does not register a Tauri handler in the browser', () => {
    setTauri(false);
    renderHook(() => useUnsavedChangesGuard(true));
    expect(m.onCloseRequested).not.toHaveBeenCalled();
  });

  it('lets the window close when there are no unsaved changes', () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(false));
    const e = requestClose();
    expect(e.prevented).toBe(false);
    expect(result.current.promptOpen).toBe(false);
  });

  it('blocks the close and opens the designed prompt when dirty', () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    const e = requestClose();
    expect(e.prevented).toBe(true);
    expect(result.current.promptOpen).toBe(true);
    // The window must not have been closed underneath the user.
    expect(m.close).not.toHaveBeenCalled();
  });

  it('re-reads dirty state at close time rather than at registration', () => {
    // The listener is registered once; flipping isDirty must take effect
    // without re-registering (a stale closure here would silently let the
    // window close with unsaved work).
    const { result, rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useUnsavedChangesGuard(dirty),
      { initialProps: { dirty: false } },
    );
    expect(requestClose().prevented).toBe(false);

    rerender({ dirty: true });
    expect(m.onCloseRequested).toHaveBeenCalledTimes(1); // still one listener
    expect(requestClose().prevented).toBe(true);
    expect(result.current.promptOpen).toBe(true);
  });

  it('discarding closes the window and does not re-prompt on the way out', async () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    requestClose();
    expect(result.current.promptOpen).toBe(true);

    await act(async () => {
      result.current.onDiscardAndClose();
    });
    expect(m.close).toHaveBeenCalledTimes(1);
    expect(result.current.promptOpen).toBe(false);

    // Our own win.close() re-enters onCloseRequested. Without a one-way latch
    // this would preventDefault again and the window could never be closed.
    const e = requestClose();
    expect(e.prevented).toBe(false);
  });

  it('keeping editing dismisses the prompt without closing', () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    requestClose();
    act(() => {
      result.current.onKeepEditing();
    });
    expect(result.current.promptOpen).toBe(false);
    expect(m.close).not.toHaveBeenCalled();

    // A later close attempt must prompt again — the latch is one-way only
    // after an explicit discard.
    expect(requestClose().prevented).toBe(true);
  });

  it('unsubscribes the Tauri listener on unmount', async () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));
    await act(async () => {}); // onCloseRequested resolves asynchronously
    unmount();
    expect(m.unlisten).toHaveBeenCalledTimes(1);
  });

  // The browser path is still needed: the dev preview at :1420 and any
  // tab-level navigation are plain webviews where beforeunload does work.
  it('keeps the beforeunload guard for browser contexts', () => {
    setTauri(false);
    renderHook(() => useUnsavedChangesGuard(true));

    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not block beforeunload when clean', () => {
    setTauri(false);
    renderHook(() => useUnsavedChangesGuard(false));

    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
