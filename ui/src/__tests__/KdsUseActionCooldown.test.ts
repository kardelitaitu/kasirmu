// Unit tests for createCooldownWrapper — pure factory that creates a
// cooldown-gated callback wrapper (no React hook needed).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCooldownWrapper } from '@/features/kds/hooks/useActionCooldown';

describe('createCooldownWrapper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the action on first invocation', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action, 200);
    wrapped();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('suppresses calls within the cooldown window', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action, 200);
    wrapped();
    wrapped(); // within 200ms
    wrapped(); // within 200ms
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('allows calls after the cooldown window', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action, 200);
    wrapped();
    vi.advanceTimersByTime(201);
    wrapped();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('passes arguments through to the action', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action, 100);
    wrapped('a', 42);
    expect(action).toHaveBeenCalledWith('a', 42);
  });

  it('uses default cooldown of 200ms when not specified', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action);
    wrapped();
    vi.advanceTimersByTime(199);
    wrapped(); // suppressed
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    wrapped(); // allowed
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('resets cooldown after each allowed call', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action, 100);
    wrapped(); // t=0
    vi.advanceTimersByTime(100);
    wrapped(); // t=100, allowed
    vi.advanceTimersByTime(50);
    wrapped(); // t=150, suppressed (only 50ms since last)
    expect(action).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(50);
    wrapped(); // t=200, allowed
    expect(action).toHaveBeenCalledTimes(3);
  });

  it('handles rapid successive calls correctly', () => {
    const action = vi.fn();
    const wrapped = createCooldownWrapper(action, 50);
    for (let i = 0; i < 100; i++) {
      wrapped();
    }
    expect(action).toHaveBeenCalledTimes(1);
  });
});
