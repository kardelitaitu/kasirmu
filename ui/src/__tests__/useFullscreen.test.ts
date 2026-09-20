import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullscreen } from '@/hooks/useFullscreen';

// ── Mocks ────────────────────────────────────────────────────────

const mockIsFullscreen = vi.fn<() => Promise<boolean>>();
const mockSetFullscreen = vi.fn<(arg: boolean) => Promise<void>>();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: () => mockIsFullscreen(),
    setFullscreen: (fs: boolean) => mockSetFullscreen(fs),
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────

function setBrowserMode() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__;
}

function setTauriMode() {
  // `isTauriWebview()` keys on `invoke` being callable, not on the key merely
  // existing — the dev preview's `index.html` stub has no `invoke`. A bare
  // `{}` here reads as "browser" and every Tauri case below would silently
  // exercise the browser branch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_INTERNALS__ = { invoke: () => Promise.resolve() };
}

// ── Tests ────────────────────────────────────────────────────────

describe('useFullscreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let requestSpy: any;

  beforeEach(() => {
    setBrowserMode();

    // jsdom may lack fullscreenElement, exitFullscreen, requestFullscreen — define them first.
    if (!('fullscreenElement' in document)) {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });
    }
    if (!('exitFullscreen' in document)) {
      Object.defineProperty(document, 'exitFullscreen', {
        value: vi.fn(() => Promise.resolve()),
        writable: true,
        configurable: true,
      });
    }
    if (!('requestFullscreen' in document.documentElement)) {
      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        value: vi.fn(() => Promise.resolve()),
        writable: true,
        configurable: true,
      });
    }

    exitSpy = vi.spyOn(document, 'exitFullscreen').mockResolvedValue();
    requestSpy = vi
      .spyOn(document.documentElement, 'requestFullscreen')
      .mockResolvedValue();
  });

  afterEach(() => {
    exitSpy?.mockRestore();
    requestSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns toggleFullscreen function', () => {
    const { result } = renderHook(() => useFullscreen());
    expect(typeof result.current.toggleFullscreen).toBe('function');
  });

  // ── Browser mode ───────────────────────────────────────────────

  it('enters fullscreen in browser mode when not already fullscreen', async () => {
    // fullscreenElement is null → browserToggleFS calls requestFullscreen
    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits fullscreen in browser mode when already fullscreen', async () => {
    // Mock fullscreenElement as truthy → browserToggleFS calls exitFullscreen
    const fsElDef = vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue({} as Element);

    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(exitSpy).toHaveBeenCalledTimes(1);
    fsElDef.mockRestore();
  });

  it('fires onToggle with true when entering browser fullscreen', async () => {
    const onToggle = vi.fn();

    const { result } = renderHook(() => useFullscreen(onToggle));

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('fires onToggle with false when exiting browser fullscreen', async () => {
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue({} as Element);
    const onToggle = vi.fn();

    const { result } = renderHook(() => useFullscreen(onToggle));

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('logs warning on browser fullscreen error', async () => {
    const error = new Error('Fullscreen denied');
    requestSpy.mockRejectedValue(error);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[useFullscreen] toggle failed:',
      error,
    );
  });

  // ── Tauri mode ─────────────────────────────────────────────────

  it('enters fullscreen in Tauri mode when not already fullscreen', async () => {
    setTauriMode();
    mockIsFullscreen.mockResolvedValue(false);

    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(mockSetFullscreen).toHaveBeenCalledWith(true);
    // Browser APIs should not be called.
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('exits fullscreen in Tauri mode when already fullscreen', async () => {
    setTauriMode();
    mockIsFullscreen.mockResolvedValue(true);

    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(mockSetFullscreen).toHaveBeenCalledWith(false);
  });

  it('fires onToggle with true when entering Tauri fullscreen', async () => {
    setTauriMode();
    mockIsFullscreen.mockResolvedValue(false);
    const onToggle = vi.fn();

    const { result } = renderHook(() => useFullscreen(onToggle));

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('fires onToggle with false when exiting Tauri fullscreen', async () => {
    setTauriMode();
    mockIsFullscreen.mockResolvedValue(true);
    const onToggle = vi.fn();

    const { result } = renderHook(() => useFullscreen(onToggle));

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('logs warning on Tauri fullscreen error', async () => {
    setTauriMode();
    const error = new Error('Window API failed');
    mockIsFullscreen.mockRejectedValue(error);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      result.current.toggleFullscreen();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[useFullscreen] toggle failed:',
      error,
    );
    warnSpy.mockRestore();
  });

  // ── F11 key listener ───────────────────────────────────────────

  it('toggles fullscreen on F11 keydown', async () => {
    setTauriMode();
    mockIsFullscreen.mockResolvedValue(false);
    const onToggle = vi.fn();

    renderHook(() => useFullscreen(onToggle));

    const event = new KeyboardEvent('keydown', { key: 'F11', bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    await act(async () => {
      document.dispatchEvent(event);
    });

    // Advance microtasks for async toggle inside handler.
    await act(async () => {
      await Promise.resolve();
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(mockSetFullscreen).toHaveBeenCalledWith(true);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('does not toggle on non-F11 keydown', async () => {
    renderHook(() => useFullscreen());

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(requestSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('removes keydown listener on unmount', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useFullscreen());
    unmount();

    expect(removeSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    );
  });
});
