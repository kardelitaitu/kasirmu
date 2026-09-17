// ── Tooltip edge-compliance tests ───────────────────────────────────
//
// Pins the contract that portal tooltips remain fully inside the
// viewport even when the trigger sits near an edge. The Tooltip
// component clamps its rendered position to the viewport margins via
// a layout effect, so bubbles never get clipped by the screen edge.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Tooltip from '@/app/Tooltip';

const MARGIN = 8;

function renderTooltip(props: Partial<React.ComponentProps<typeof Tooltip>> = {}) {
  return render(
    <Tooltip content="Edge case check" portal position="top" {...props}>
      <button type="button" data-testid="trigger">Hover me</button>
    </Tooltip>,
  );
}

function showTooltip(): HTMLElement {
  const trigger = screen.getByTestId('trigger');
  const wrapper = trigger.closest('.tooltip-wrapper')!;
  fireEvent.mouseEnter(wrapper);
  act(() => vi.advanceTimersByTime(400));
  return document.querySelector<HTMLElement>('.tooltip-content')!;
}

// ── Suite ──────────────────────────────────────────────────────────

describe('Tooltip edge compliance (portal)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no layout: getBoundingClientRect returns all zeros. With a
    // zero trigger + zero bubble, the clamp forces the bubble to the
    // viewport margin (0 + 0 is < margin, so left/top clamp to 8px).
  });

  afterEach(() => {
    cleanup(); // properly unmount React tree (incl. portals) before reset
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows the tooltip on hover', () => {
    renderTooltip();
    const tooltip = showTooltip();
    expect(tooltip.classList.contains('tooltip-content--visible')).toBe(true);
  });

  it('clamps the tooltip left position to at least the viewport margin', () => {
    renderTooltip();
    const tooltip = showTooltip();

    const left = Number.parseFloat(tooltip.style.left);
    expect(Number.isNaN(left)).toBe(false);
    expect(left).toBeGreaterThanOrEqual(MARGIN);
  });

  it('clamps the tooltip top position to at least the viewport margin', () => {
    renderTooltip();
    const tooltip = showTooltip();

    const top = Number.parseFloat(tooltip.style.top);
    expect(Number.isNaN(top)).toBe(false);
    expect(top).toBeGreaterThanOrEqual(MARGIN);
  });

  it('keeps the right edge within the viewport', () => {
    renderTooltip();
    const tooltip = showTooltip();

    const left = Number.parseFloat(tooltip.style.left);
    const width = tooltip.getBoundingClientRect().width || 200; // jsdom returns 0
    expect(left + width).toBeLessThanOrEqual(window.innerWidth - MARGIN);
  });

  it('sets a viewport-safe max-width on the portal tooltip', () => {
    renderTooltip();
    showTooltip(); // triggers rendering with clamped style + maxWidth
    const tooltip = document.querySelector<HTMLElement>('.tooltip-content--portal')!;
    expect(tooltip).toBeInTheDocument();
    const mw = tooltip.style.maxWidth;
    expect(mw).toBeTruthy();
  });

  it('neutralizes the CSS bottom so the fixed bubble does not stretch', () => {
    // Regression: portal "top" tooltips use `bottom:` in CSS for positioning.
    // When we clamp with inline `top`, the CSS `bottom` must be cleared
    // (bottom: auto), otherwise both top+bottom are set on the fixed element
    // and the bubble stretches vertically (wrong height).
    renderTooltip();
    showTooltip();
    const tooltip = document.querySelector<HTMLElement>('.tooltip-content--portal')!;
    // The clamped inline style must explicitly clear the CSS bottom.
    expect(tooltip.style.bottom).toBe('auto');
    const top = Number.parseFloat(tooltip.style.top);
    expect(Number.isNaN(top)).toBe(false);
  });
});