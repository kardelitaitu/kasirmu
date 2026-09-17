// ── Tooltip contract tests ─────────────────────────────────────────
//
// Pins the contract for the Tooltip component at
// `@/app/Tooltip`. Covers show/hide timing,
// focus/blur behavior, positioning, accessibility, and more.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import Tooltip from '@/app/Tooltip';

// Read the stylesheet so CSS contracts (pointer-events gating) can be
// asserted without a real browser.
const tooltipCss = readFileSync(
  join(__dirname, '..', 'app', 'Tooltip.css'),
  'utf-8',
);

// ── Helpers ─────────────────────────────────────────────────────

function renderTooltip(props: Partial<React.ComponentProps<typeof Tooltip>> = {}) {
  const content = props.content ?? 'Helpful hint';
  return render(
    <Tooltip content={content} {...props}>
      <button type="button" data-testid="trigger">
        Hover me
      </button>
    </Tooltip>,
  );
}

/** Fire a blur event with an optional relatedTarget. */
function blur(el: HTMLElement, relatedTarget?: HTMLElement | null) {
  fireEvent.blur(el, { relatedTarget });
}

function getTooltipContent() {
  return document.querySelector<HTMLDivElement>('.tooltip-content');
}

function getTooltipWrapper() {
  return document.querySelector<HTMLDivElement>('.tooltip-wrapper');
}

// ── Suite ────────────────────────────────────────────────────────

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // ── Initial state ────────────────────────────────────

  describe('initial state', () => {
    it('renders the trigger element', () => {
      renderTooltip();
      expect(screen.getByTestId('trigger')).toBeInTheDocument();
    });

    it('renders the tooltip content div with role="tooltip"', () => {
      renderTooltip();
      const tooltip = getTooltipContent();
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveAttribute('role', 'tooltip');
    });

    it('hides the tooltip by default (aria-hidden, no visible class)', () => {
      renderTooltip();
      const tooltip = getTooltipContent();
      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
      expect(tooltip?.classList.contains('tooltip-content--visible')).toBe(false);
    });

    it('does not set aria-describedby on the trigger when hidden', () => {
      renderTooltip();
      const trigger = screen.getByTestId('trigger');
      expect(trigger).not.toHaveAttribute('aria-describedby');
    });
  });

  // ── Show on mouseEnter ──────────────────────────────

  describe('show on mouseEnter', () => {
    it('shows the tooltip after the default showDelay (400ms)', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;
      fireEvent.mouseEnter(wrapper);

      // Before delay: still hidden
      act(() => vi.advanceTimersByTime(399));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(false);

      // After 400ms: visible
      act(() => vi.advanceTimersByTime(1));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);
    });

    it('shows the tooltip after a custom showDelay', () => {
      renderTooltip({ showDelay: 200 });
      const wrapper = getTooltipWrapper()!;
      fireEvent.mouseEnter(wrapper);

      act(() => vi.advanceTimersByTime(199));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(false);

      act(() => vi.advanceTimersByTime(1));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);
    });

    it('sets aria-hidden="false" and aria-describedby when visible', () => {
      renderTooltip();
      fireEvent.mouseEnter(getTooltipWrapper()!);
      act(() => vi.advanceTimersByTime(400));

      const tooltip = getTooltipContent();
      expect(tooltip).toHaveAttribute('aria-hidden', 'false');
      expect(tooltip?.id).toBeTruthy();

      const trigger = screen.getByTestId('trigger');
      expect(trigger).toHaveAttribute('aria-describedby', tooltip?.id);
    });

    it('clears the previous hide timer when re-entering before hideDelay expires', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;

      // Show it
      fireEvent.mouseEnter(wrapper);
      act(() => vi.advanceTimersByTime(400));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);

      // Leave (starts 100ms hide timer)
      fireEvent.mouseLeave(wrapper);

      // Re-enter at 50ms (before hide fires)
      act(() => vi.advanceTimersByTime(50));
      fireEvent.mouseEnter(wrapper);

      // Advance past the original hide timer (100ms from leave)
      act(() => vi.advanceTimersByTime(60));
      // Should still be visible because re-enter cancelled the hide timer
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);
    });

    it('cancels a pending show when mouse leaves before delay expires', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;

      fireEvent.mouseEnter(wrapper);
      act(() => vi.advanceTimersByTime(200)); // mid-show-delay

      fireEvent.mouseLeave(wrapper);
      act(() => vi.advanceTimersByTime(500)); // past the original show delay

      // Should still be hidden (show was cancelled)
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(false);
    });
  });

  // ── Show on focus (keyboard) ──────────────────────

  describe('show on focus', () => {
    it('shows the tooltip when the trigger receives focus', () => {
      renderTooltip();
      fireEvent.focus(getTooltipWrapper()!);

      act(() => vi.advanceTimersByTime(400));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);
    });

    it('hides the tooltip when the trigger loses focus (blur)', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;

      fireEvent.focus(wrapper);
      act(() => vi.advanceTimersByTime(400));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);

      // Blur the wrapper (relatedTarget is null — focus left entirely)
      blur(wrapper, null);
      act(() => vi.advanceTimersByTime(100));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(false);
    });
  });

  // ── Hide on mouseLeave ─────────────────────────────

  describe('hide on mouseLeave', () => {
    it('hides the tooltip after the default hideDelay (100ms)', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;

      // Show first
      fireEvent.mouseEnter(wrapper);
      act(() => vi.advanceTimersByTime(400));

      // Leave
      fireEvent.mouseLeave(wrapper);
      act(() => vi.advanceTimersByTime(99));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);

      act(() => vi.advanceTimersByTime(1));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(false);
    });

    it('hides after a custom hideDelay', () => {
      renderTooltip({ hideDelay: 250 });
      const wrapper = getTooltipWrapper()!;

      fireEvent.mouseEnter(wrapper);
      act(() => vi.advanceTimersByTime(400));

      fireEvent.mouseLeave(wrapper);
      act(() => vi.advanceTimersByTime(249));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);

      act(() => vi.advanceTimersByTime(1));
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(false);
    });
  });

  // ── Hovering the tooltip keeps it visible ─────────

  describe('hovering the tooltip', () => {
    it('keeps the tooltip visible when the mouse enters the tooltip during hideDelay', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;

      fireEvent.mouseEnter(wrapper);
      act(() => vi.advanceTimersByTime(400));

      // Mouse leaves the wrapper
      fireEvent.mouseLeave(wrapper);
      // Before hide fires, mouse enters the tooltip
      act(() => vi.advanceTimersByTime(50));
      const tooltip = getTooltipContent()!;
      fireEvent.mouseEnter(tooltip);

      // Advance past the original hide timer
      act(() => vi.advanceTimersByTime(60));
      expect(tooltip.classList.contains('tooltip-content--visible')).toBe(true);
    });

    it('hides after mouse leaves the tooltip and hideDelay expires', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;

      fireEvent.mouseEnter(wrapper);
      act(() => vi.advanceTimersByTime(400));

      // Move mouse from wrapper to tooltip
      fireEvent.mouseLeave(wrapper);
      const tooltip = getTooltipContent()!;
      fireEvent.mouseEnter(tooltip);
      act(() => vi.advanceTimersByTime(50));

      // Leave tooltip
      fireEvent.mouseLeave(tooltip);
      act(() => vi.advanceTimersByTime(99));
      expect(tooltip.classList.contains('tooltip-content--visible')).toBe(true);

      act(() => vi.advanceTimersByTime(1));
      expect(tooltip.classList.contains('tooltip-content--visible')).toBe(false);
    });
  });

  // ── Focus moving to tooltip keeps it visible ──────

  describe('focus blur guard', () => {
    it('does not hide when focus moves from trigger to tooltip', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;
      const tooltip = getTooltipContent()!;

      // Focus the wrapper (shows tooltip)
      fireEvent.focus(wrapper);
      act(() => vi.advanceTimersByTime(400));

      // Blur wrapper with relatedTarget = tooltip
      blur(wrapper, tooltip);
      // scheduleHide is called, but tooltip should stay visible
      act(() => vi.advanceTimersByTime(100));
      expect(tooltip.classList.contains('tooltip-content--visible')).toBe(true);
    });

    it('hides when focus moves from trigger to an unrelated element', () => {
      renderTooltip();
      const wrapper = getTooltipWrapper()!;
      const tooltip = getTooltipContent()!;

      // Add another focusable element
      const other = document.createElement('button');
      other.setAttribute('data-testid', 'other');
      wrapper?.parentElement?.appendChild(other);

      fireEvent.focus(wrapper);
      act(() => vi.advanceTimersByTime(400));

      // Blur wrapper with relatedTarget = other button
      blur(wrapper, other);
      act(() => vi.advanceTimersByTime(100));
      expect(tooltip.classList.contains('tooltip-content--visible')).toBe(false);
    });
  });

  // ── Position class ──────────────────────────────────

  describe('position', () => {
    it('defaults to position="right"', () => {
      renderTooltip();
      expect(getTooltipContent()).toHaveClass('tooltip-content--right');
    });

    it('applies the tooltip-content--top class', () => {
      renderTooltip({ position: 'top' });
      expect(getTooltipContent()).toHaveClass('tooltip-content--top');
    });

    it('applies the tooltip-content--bottom class', () => {
      renderTooltip({ position: 'bottom' });
      expect(getTooltipContent()).toHaveClass('tooltip-content--bottom');
    });

    it('applies the tooltip-content--left class', () => {
      renderTooltip({ position: 'left' });
      expect(getTooltipContent()).toHaveClass('tooltip-content--left');
    });
  });

  // ── Max width ─────────────────────────────────────────

  describe('maxWidth', () => {
    it('applies the default max-width inline style (280px)', () => {
      renderTooltip();
      expect(getTooltipContent()).toHaveStyle({ maxWidth: '280px' });
    });

    it('applies a custom max-width inline style', () => {
      renderTooltip({ maxWidth: '400px' });
      expect(getTooltipContent()).toHaveStyle({ maxWidth: '400px' });
    });

    it('renders multiline content without forcing a single line', () => {
      renderTooltip({ content: 'Line one\nLine two\nLine three' });
      const tooltip = getTooltipContent()!;
      // All three lines should appear in the rendered text
      expect(tooltip.textContent).toContain('Line one');
      expect(tooltip.textContent).toContain('Line two');
      expect(tooltip.textContent).toContain('Line three');
      // white-space is normal (not pre) so \n renders as a space in HTML,
      // but the key point is the content is not clipped or truncated
      expect(tooltip.classList.contains('tooltip-content')).toBe(true);
    });
  });

  // ── Content rendering ───────────────────────────────

  describe('content', () => {
    it('renders text content', () => {
      renderTooltip({ content: 'Save your changes' });
      expect(getTooltipContent()?.textContent).toBe('Save your changes');
    });

    it('renders JSX content', () => {
      renderTooltip({
        content: (
          <span>
            <strong>Bold</strong> text
          </span>
        ),
      });
      expect(getTooltipContent()?.querySelector('strong')).toBeInTheDocument();
      expect(getTooltipContent()?.textContent).toBe('Bold text');
    });

    it('renders numeric content', () => {
      renderTooltip({ content: 42 });
      expect(getTooltipContent()?.textContent).toBe('42');
    });
  });

  // ── Multiple instances ─────────────────────────────

  describe('multiple instances', () => {
    it('gives each tooltip a unique id', () => {
      render(
        <div>
          <Tooltip content="First">
            <button type="button" data-testid="btn1">One</button>
          </Tooltip>
          <Tooltip content="Second">
            <button type="button" data-testid="btn2">Two</button>
          </Tooltip>
        </div>,
      );

      const tooltips = document.querySelectorAll<HTMLDivElement>('.tooltip-content');
      expect(tooltips.length).toBe(2);
      expect(tooltips[0]?.id).not.toBe(tooltips[1]?.id);
    });
  });

  // ── fit prop (layout footprint) ────────────────────
  //
  // The default wrapper is a full-width flex row (correct for sidebar/nav
  // rows). Converting native `title` tooltips on toolbar buttons and inline
  // badges would stretch those triggers without a shrink-to-fit variant.

  describe('fit prop', () => {
    it('defaults to the full-width block wrapper', () => {
      renderTooltip();
      expect(getTooltipWrapper()).toHaveClass('tooltip-wrapper');
      expect(getTooltipWrapper()).not.toHaveClass('tooltip-wrapper--inline');
    });

    it('applies the inline (shrink-to-fit) wrapper class', () => {
      renderTooltip({ fit: 'inline' });
      expect(getTooltipWrapper()).toHaveClass('tooltip-wrapper--inline');
    });

    it('still shows and hides normally when inline', () => {
      renderTooltip({ fit: 'inline' });
      const wrapper = getTooltipWrapper()!;

      fireEvent.mouseEnter(wrapper);
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(true);

      fireEvent.mouseLeave(wrapper);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(getTooltipContent()?.classList.contains('tooltip-content--visible')).toBe(false);
    });

    it('declares the inline variant in the stylesheet', () => {
      expect(tooltipCss).toMatch(/\.tooltip-wrapper--inline\s*\{[^}]*display:\s*inline-flex/);
    });
  });

  // ── Cleanup ─────────────────────────────────────────

  describe('cleanup', () => {
    it('cleans up timers on unmount', () => {
      const { unmount } = renderTooltip();
      const wrapper = getTooltipWrapper()!;

      // Start a show timer
      fireEvent.mouseEnter(wrapper);

      // Unmount mid-delay — should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  // ── Stuck-tooltip regression (settings sidebar) ────
  //
  // The bubble stays mounted at opacity:0 when hidden. If it can
  // intercept the pointer while hidden, an invisible portal bubble
  // hovering over the settings content pane force-shows its tooltip
  // (bubble onMouseEnter → setVisible(true)) with no trigger under the
  // cursor — and no mouseleave ever arrives to hide it. That is the
  // "tooltip stuck after the cursor moves away" bug.
  //
  // NOTE on simulation limits: a real browser cannot even deliver a
  // mouseenter to a pointer-events:none element, so the primary fix is
  // the CSS contract pinned below. jsdom/React synthetic events bypass
  // pointer-events, so the component-level test below pins the JS
  // guard: entering a HIDDEN bubble must not make it visible
  // immediately (the only path that did so pre-fix), even though the
  // React enter-simulation legitimately arms the wrapper's delayed
  // show timer.

  describe('stuck-tooltip regression', () => {
    it('hidden bubble CSS is pointer-events:none (inert) and visible bubble is interactive', () => {
      // Hidden rule: the base .tooltip-content must be pointer-events:none…
      const baseRule = /\.tooltip-content\s*\{[^}]*pointer-events:\s*none/.test(tooltipCss);
      expect(baseRule).toBe(true);
      // …and the visible rule must re-enable pointer interaction so the
      // "hover the bubble to keep it open" affordance still works.
      const visibleRule = /\.tooltip-content--visible\s*\{[^}]*pointer-events:\s*auto/.test(tooltipCss);
      expect(visibleRule).toBe(true);
    });

    it('a mouseEnter on the HIDDEN bubble does not force it visible immediately', () => {
      renderTooltip();
      const tooltip = getTooltipContent()!;

      // Synthetic event on the still-hidden bubble.
      fireEvent.mouseEnter(tooltip);

      // Pre-fix, the bubble's own onMouseEnter force-showed it with no
      // delay. The guard must keep it hidden now. (React's enter
      // simulation still arms the wrapper's 400ms show timer — that is
      // the legitimate trigger path, not the bug.)
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(tooltip.classList.contains('tooltip-content--visible')).toBe(false);
      expect(tooltip.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
