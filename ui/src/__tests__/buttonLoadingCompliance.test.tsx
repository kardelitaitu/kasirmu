//! BUTTON-LOADING-01: button loading/spinner exit-animation compliance gate.
//!
//! This suite pins the T6 spinner exit-animation contract on Button:
//!
//!   1. Spinner present while state="processing"
//!   2. Spinner gets .btn__spinner--exiting class when processing ends
//!      (not immediately unmounted)
//!   3. Spinner is gone after the 150ms exit timer fires
//!   4. aria-busy cleared on exit
//!   5. Label preserved (sr-only) while processing
//!   6. Rapid processing→ready→processing cycle doesn't leak a stale timer
//!   7. Unmount while exiting doesn't call setState (no thrown errors)
//!
//! Uses vi.useFakeTimers() for deterministic timer control.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Button } from '@/components/Button';

// animDuration reads window.matchMedia — stub it so reduced-motion is OFF,
// meaning animDuration(150) returns 150 (not 0).
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, // prefers-reduced-motion: no-preference
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BUTTON-LOADING-01 — spinner entry', () => {
  it('renders .btn__spinner while state="processing"', () => {
    render(<Button state="processing">Save</Button>);
    expect(document.querySelector('.btn__spinner')).not.toBeNull();
  });

  it('button is disabled and aria-busy while processing', () => {
    render(<Button state="processing">Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('label preserved as sr-only span while processing', () => {
    render(<Button state="processing">Save</Button>);
    expect(screen.getByText('Save')).toHaveClass('sr-only');
  });
});

describe('BUTTON-LOADING-01 — spinner exit animation', () => {
  it('spinner gets --exiting class immediately when processing ends (not unmounted yet)', () => {
    const { rerender } = render(<Button state="processing">Save</Button>);
    expect(document.querySelector('.btn__spinner')).not.toBeNull();

    // Transition to ready.
    rerender(<Button state="ready">Save</Button>);

    // The spinner should still be mounted with --exiting class.
    const spinner = document.querySelector('.btn__spinner');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveClass('btn__spinner--exiting');
  });

  it('spinner unmounts after the 150ms exit timer fires', () => {
    const { rerender } = render(<Button state="processing">Save</Button>);
    rerender(<Button state="ready">Save</Button>);

    // Mid-exit: spinner still present.
    expect(document.querySelector('.btn__spinner')).not.toBeNull();

    // Advance past exit duration.
    act(() => { vi.advanceTimersByTime(150); });

    // After timer: spinner gone.
    expect(document.querySelector('.btn__spinner')).toBeNull();
  });

  it('aria-busy cleared after spinner unmounts', () => {
    const { rerender } = render(<Button state="processing">Save</Button>);
    rerender(<Button state="ready">Save</Button>);
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });

  it('label returns to visible (not sr-only) after processing ends', () => {
    const { rerender } = render(<Button state="processing">Save</Button>);
    rerender(<Button state="ready">Save</Button>);
    act(() => { vi.advanceTimersByTime(150); });
    const label = screen.getByText('Save');
    expect(label).not.toHaveClass('sr-only');
  });
});

describe('BUTTON-LOADING-01 — rapid state cycling', () => {
  it('processing→ready→processing cancels the exit timer and shows spinner again', () => {
    const { rerender } = render(<Button state="processing">Save</Button>);
    rerender(<Button state="ready">Save</Button>);

    // Re-enter processing before exit timer fires — cancels stale timer.
    rerender(<Button state="processing">Save</Button>);

    // Spinner should not have --exiting class now.
    const spinner = document.querySelector('.btn__spinner');
    expect(spinner).not.toBeNull();
    expect(spinner).not.toHaveClass('btn__spinner--exiting');

    // Advance past old timer — spinner should STILL be present (not unmounted).
    act(() => { vi.advanceTimersByTime(150); });
    expect(document.querySelector('.btn__spinner')).not.toBeNull();
  });

  it('unmounting while exiting does not throw (no setState on unmounted component)', () => {
    const { rerender, unmount } = render(<Button state="processing">Save</Button>);
    rerender(<Button state="ready">Save</Button>);

    // Unmount mid-animation — cleanup effect should cancel the timer.
    expect(() => {
      unmount();
      act(() => { vi.advanceTimersByTime(150); });
    }).not.toThrow();
  });
});
