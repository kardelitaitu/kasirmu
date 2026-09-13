import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { useCanvasChart } from '@/hooks/useCanvasChart';

// ── Mocks ──────────────────────────────────────────────────────────────

let rafCallbacks: FrameRequestCallback[] = [];

function mockRequestAnimationFrame(cb: FrameRequestCallback) {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('useCanvasChart', () => {
  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    rafCallbacks = [];

    // Create real DOM structure: container > canvas
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    canvas = document.createElement('canvas');
    container.appendChild(canvas);

    mockCtx = {
      scale: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx);
    // parentElement naturally returns container because canvas is a child
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    });

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(mockRequestAnimationFrame);
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('returns canvasRef, redraw, and getCssVar', () => {
    const draw = vi.fn();
    const { result } = renderHook(() => useCanvasChart(draw, []));

    expect(result.current.canvasRef).toBeDefined();
    expect(typeof result.current.redraw).toBe('function');
    expect(typeof result.current.getCssVar).toBe('function');
  });

  it('redraw calls requestAnimationFrame which triggers the draw', async () => {
    const draw = vi.fn();
    const { result } = renderHook(() => useCanvasChart(draw, []));

    // Assign canvas ref manually
    (result.current.canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas;

    // Mount effect calls redraw which queues a RAF
    await act(async () => {
      const cb = rafCallbacks.shift();
      cb?.(performance.now());
    });

    expect(draw).toHaveBeenCalled();
  });

  it('scales canvas by DPR when enableHiDpi is true', async () => {
    const draw = vi.fn();
    const { result } = renderHook(() => useCanvasChart(draw, [], { enableHiDpi: true }));

    (result.current.canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas;

    await act(async () => {
      const cb = rafCallbacks.shift();
      cb?.(performance.now());
    });

    expect(mockCtx.scale).toHaveBeenCalledWith(2, 2);
  });

  it('does not scale canvas when enableHiDpi is false', async () => {
    const draw = vi.fn();
    const { result } = renderHook(() => useCanvasChart(draw, [], { enableHiDpi: false }));

    (result.current.canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas;

    await act(async () => {
      const cb = rafCallbacks.shift();
      cb?.(performance.now());
    });

    expect(mockCtx.scale).not.toHaveBeenCalled();
  });

  it('coalesces multiple redraw calls into one frame', async () => {
    const draw = vi.fn();
    const { result } = renderHook(() => useCanvasChart(draw, []));

    (result.current.canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas;

    // Flush mount frame
    await act(async () => {
      const cb = rafCallbacks.shift();
      cb?.(performance.now());
    });

    // Call redraw multiple times in same frame
    act(() => {
      result.current.redraw();
      result.current.redraw();
      result.current.redraw();
    });

    await act(async () => {
      // Only one RAF callback should be pending (coalesced)
      const cb = rafCallbacks.shift();
      cb?.(performance.now());
    });

    // draw called once for mount + once for the coalesced redraw
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('redraw() triggers on subsequent frames', async () => {
    const draw = vi.fn();
    const { result } = renderHook(() => useCanvasChart(draw, []));

    (result.current.canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas;

    // Mount frame
    await act(async () => {
      const cb = rafCallbacks.shift();
      cb?.(performance.now());
    });
    expect(draw).toHaveBeenCalledTimes(1);

    // Explicit redraw
    act(() => {
      result.current.redraw();
    });
    await act(async () => {
      const cb = rafCallbacks.shift();
      cb?.(performance.now());
    });
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('getCssVar returns fallback when no CSS variable is set', () => {
    const draw = vi.fn();
    const { result } = renderHook(() => useCanvasChart(draw, []));

    const value = result.current.getCssVar('--my-color', '#ff0000');
    expect(value).toBe('#ff0000');
  });

  it('getCssVar returns default fallback', () => {
    const draw = vi.fn();
    const { result } = renderHook(() => useCanvasChart(draw, []));

    const value = result.current.getCssVar('--nonexistent');
    expect(value).toBe('#888');
  });
});
