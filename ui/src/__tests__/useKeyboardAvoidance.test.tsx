import type React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useKeyboardAvoidance } from '@/hooks/useKeyboardAvoidance';

// ── Wrapper: renders the hook inside a real DOM container ──────────────

function TestHarness({ options }: { options?: { selector?: string; scrollPadding?: number } }) {
  const { containerRef } = useKeyboardAvoidance(options);
  return <div ref={containerRef as React.RefObject<HTMLDivElement>} data-testid="container" />;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('useKeyboardAvoidance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders a container element', () => {
    const { getByTestId } = render(<TestHarness />);
    expect(getByTestId('container')).toBeDefined();
  });

  it('sets scrollMargin on focus of an input element', () => {
    render(<TestHarness options={{ scrollPadding: 24 }} />);

    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    expect(input.style.scrollMargin).toBe('24px');

    document.body.removeChild(input);
  });

  it('restores original scrollMargin on focusout', () => {
    render(<TestHarness />);

    const input = document.createElement('input');
    input.style.scrollMargin = '8px';
    document.body.appendChild(input);

    // Focus
    act(() => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(input.style.scrollMargin).toBe('16px'); // default padding

    // Blur
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.style.scrollMargin).toBe('8px'); // restored

    document.body.removeChild(input);
  });

  it('ignores non-matching elements', () => {
    render(<TestHarness />);

    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      div.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    expect(div.style.scrollMargin).toBe('');

    document.body.removeChild(div);
  });

  it('respects custom selector', () => {
    render(<TestHarness options={{ selector: '.custom-input' }} />);

    const input = document.createElement('input');
    document.body.appendChild(input);

    const custom = document.createElement('input');
    custom.className = 'custom-input';
    document.body.appendChild(custom);

    // Regular input should be ignored
    act(() => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(input.style.scrollMargin).toBe('');

    // Custom input should be picked up
    act(() => {
      custom.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(custom.style.scrollMargin).toBe('16px');

    document.body.removeChild(input);
    document.body.removeChild(custom);
  });

  it('scrolls element into view after keyboard delay', () => {
    render(<TestHarness />);

    const input = document.createElement('input');
    document.body.appendChild(input);

    // Make the input appear "below visible area"
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      top: 800,
      bottom: 832,
      left: 0,
      right: 100,
      width: 100,
      height: 32,
      x: 0,
      y: 800,
      toJSON: vi.fn(),
    });

    act(() => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    // The setTimeout fires at 350ms — advance past it
    act(() => {
      vi.advanceTimersByTime(400);
    });

    // Should not throw
    document.body.removeChild(input);
  });
});
