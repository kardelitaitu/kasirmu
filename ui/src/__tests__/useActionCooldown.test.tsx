// ── useActionCooldown + createCooldownWrapper tests ──────────────
//
// Covers: cooldown guard (200ms default), custom duration, args
// forwarding, cooldown expiry reset, and the non-hook wrapper variant.
//
// Pure timing logic — no React context mocking required.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActionCooldown, createCooldownWrapper } from '@/features/kds/hooks/useActionCooldown';

// ── useActionCooldown ──────────────────────────────────────────────

describe('useActionCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the action on first invocation', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useActionCooldown(action));

    act(() => {
      result.current.debouncedAction();
    });

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('suppresses rapid successive calls within the default cooldown (200ms)', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useActionCooldown(action));

    act(() => {
      result.current.debouncedAction();
    });
    expect(action).toHaveBeenCalledTimes(1);

    // Fire again 50ms later — should be suppressed.
    act(() => {
      vi.advanceTimersByTime(50);
      result.current.debouncedAction();
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('allows action again after the cooldown window expires', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useActionCooldown(action));

    act(() => {
      result.current.debouncedAction();
    });
    expect(action).toHaveBeenCalledTimes(1);

    // Advance past the 200ms cooldown.
    act(() => {
      vi.advanceTimersByTime(210);
      result.current.debouncedAction();
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('respects a custom cooldown duration', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useActionCooldown(action, 500));

    act(() => {
      result.current.debouncedAction();
    });
    expect(action).toHaveBeenCalledTimes(1);

    // At 400ms — still within the 500ms window.
    act(() => {
      vi.advanceTimersByTime(400);
      result.current.debouncedAction();
    });
    expect(action).toHaveBeenCalledTimes(1);

    // At 510ms — past the window.
    act(() => {
      vi.advanceTimersByTime(110);
      result.current.debouncedAction();
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('forwards arguments to the wrapped action', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useActionCooldown(action));

    act(() => {
      result.current.debouncedAction('a', 42);
    });

    expect(action).toHaveBeenCalledWith('a', 42);
  });

  it('cooldownActive reflects the ref value (snapshot check)', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useActionCooldown(action));

    // Before any invocation, cooldownActive starts as false.
    expect(result.current.cooldownActive).toBe(false);
  });
});

// ── createCooldownWrapper ──────────────────────────────────────────

describe('createCooldownWrapper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the action on first invocation', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action);

    wrapped();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('suppresses calls within the default cooldown window', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action);

    wrapped();
    wrapped(); // immediate — suppressed
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('allows calls after the cooldown window', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action);

    wrapped();
    vi.advanceTimersByTime(210);
    wrapped();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('respects a custom cooldown duration', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action, 100);

    wrapped();
    vi.advanceTimersByTime(50);
    wrapped(); // still within 100ms — suppressed
    expect(action).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60);
    wrapped(); // past the window
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('forwards arguments correctly', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action);

    wrapped('hello', 99);
    expect(action).toHaveBeenCalledWith('hello', 99);
  });

  it('does not interfere with a different wrapper instance', () => {
    const action1 = vi.fn();
    const action2 = vi.fn();
    const wrapped1 = createCooldownWrapper(action1);
    const wrapped2 = createCooldownWrapper(action2);

    wrapped1();
    wrapped2(); // different instance — should fire
    expect(action1).toHaveBeenCalledTimes(1);
    expect(action2).toHaveBeenCalledTimes(1);
  });
});
