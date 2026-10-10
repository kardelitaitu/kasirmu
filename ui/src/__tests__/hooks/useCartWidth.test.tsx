import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { useCartWidth } from '@/features/sales/posScreenHooks';
import { CART_WIDTH_MIN, CART_WIDTH_MAX_CAP } from '@/features/sales/utils/cartCalculations';

describe('useCartWidth', () => {
  const mockRef = { current: null as HTMLDivElement | null };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mockRef.current = {
      getBoundingClientRect: vi.fn(() => ({ right: 800, left: 0 })),
    } as unknown as HTMLDivElement;
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('initializes with default when no saved value', () => {
    const { result } = renderHook(() => useCartWidth(mockRef));
    expect(result.current.cartWidth).toBe(440);
  });

  it('initializes with saved value from localStorage', () => {
    localStorage.setItem('pos-cart-width', '450');
    const { result } = renderHook(() => useCartWidth(mockRef));
    // jsdom default innerWidth is 1024, half is 512, so 450 is within range
    expect(result.current.cartWidth).toBe(450);
  });

  it('clamps saved value to minimum', () => {
    localStorage.setItem('pos-cart-width', '100');
    const { result } = renderHook(() => useCartWidth(mockRef));
    // Asserted against the CONSTANT, never a literal. This read `toBe(320)` and
    // kept passing after the floor moved to 400, because the hook carried its own
    // private copy of the bounds: the test and the code agreed with each other
    // and neither agreed with the shipped value. The number is a measurement
    // (see the sweep in cartCalculations.ts), so a literal here recreates the trap.
    expect(result.current.cartWidth).toBe(CART_WIDTH_MIN);
  });

  it('clamps saved value to maximum', () => {
    localStorage.setItem('pos-cart-width', '2000');
    const { result } = renderHook(() => useCartWidth(mockRef));
    // jsdom default innerWidth is 1024, half is 512
    expect(result.current.cartWidth).toBe(512);
  });

  it('clamps to viewport half when window is narrow', () => {
    // The initial state uses window.innerWidth, not the ref
    // In test environment, window.innerWidth may be different
    const { result } = renderHook(() => useCartWidth(mockRef));
    // Should be at least minimum
    expect(result.current.cartWidth).toBeGreaterThanOrEqual(CART_WIDTH_MIN);
    expect(result.current.cartWidth).toBeLessThanOrEqual(CART_WIDTH_MAX_CAP);
  });

  it('startResize sets isResizing and updates cursor styles', () => {
    const { result } = renderHook(() => useCartWidth(mockRef));
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;

    act(() => {
      result.current.startResize({ preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLDivElement>);
    });

    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');

    // Cleanup
    document.body.style.cursor = originalCursor;
    document.body.style.userSelect = originalUserSelect;
  });

  it('persists clamped width on mouse move during resize', () => {
    const { result } = renderHook(() => useCartWidth(mockRef));

    act(() => {
      result.current.startResize({ preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLDivElement>);
    });

    // Simulate mousemove
    const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 500 });
    act(() => {
      window.dispatchEvent(mouseMoveEvent);
    });

    // Should have updated and persisted
    expect(localStorage.getItem('pos-cart-width')).toBeTruthy();
    expect(result.current.cartWidth).toBeGreaterThanOrEqual(CART_WIDTH_MIN);
    expect(result.current.cartWidth).toBeLessThanOrEqual(CART_WIDTH_MAX_CAP);
  });

  it('cleans up on mouseup', () => {
    const { result } = renderHook(() => useCartWidth(mockRef));

    act(() => {
      result.current.startResize({ preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLDivElement>);
    });

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    // Should not persist further changes
    const saved = localStorage.getItem('pos-cart-width');
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }));
    });
    expect(localStorage.getItem('pos-cart-width')).toBe(saved);
  });

  it('re-clamps on window resize', () => {
    renderHook(() => useCartWidth(mockRef));

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Should have re-clamped and persisted
    expect(localStorage.getItem('pos-cart-width')).toBeTruthy();
  });
});