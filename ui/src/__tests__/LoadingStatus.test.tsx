/**
 * Tests for `LoadingStatus` — the shared accessible loading wrapper (LOAD-05).
 *
 * Contract: `role="status"` + `aria-live="polite"` region with a visible
 * value-bearing label, decorative children kept `aria-hidden`, optional
 * `aria-busy` for refresh-over-data, and a className passthrough.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoadingStatus } from '@/components/LoadingStatus';

describe('LoadingStatus', () => {
  it('renders the label inside a status region', () => {
    const { container } = render(<LoadingStatus label="Loading sales…" />);
    const region = container.querySelector('.loading-status');
    expect(region).toBeTruthy();
    expect(region!.getAttribute('role')).toBe('status');
    expect(region!.getAttribute('aria-live')).toBe('polite');
    expect(region!.textContent).toContain('Loading sales…');
  });

  it('defaults aria-busy to false', () => {
    const { container } = render(<LoadingStatus label="Loading…" />);
    const region = container.querySelector('.loading-status')!;
    expect(region.getAttribute('aria-busy')).toBe('false');
  });

  it('sets aria-busy=true for refresh-over-data', () => {
    const { container } = render(<LoadingStatus label="Refreshing…" busy />);
    const region = container.querySelector('.loading-status')!;
    expect(region.getAttribute('aria-busy')).toBe('true');
  });

  it('hides decorative children from assistive technology', () => {
    const { container } = render(
      <LoadingStatus label="Loading…">
        <span data-testid="skeleton" />
      </LoadingStatus>,
    );
    const visual = container.querySelector('.loading-status__visual')!;
    expect(visual.getAttribute('aria-hidden')).toBe('true');
    expect(visual.querySelector('[data-testid="skeleton"]')).toBeTruthy();
  });

  it('renders no visual wrapper when children are absent', () => {
    const { container } = render(<LoadingStatus label="Loading…" />);
    expect(container.querySelector('.loading-status__visual')).toBeNull();
  });

  it('keeps the label out of the aria-hidden visual region', () => {
    const { container } = render(
      <LoadingStatus label="Loading…">
        <span>decor</span>
      </LoadingStatus>,
    );
    const visual = container.querySelector('.loading-status__visual')!;
    // The label is a sibling, not inside the hidden region.
    expect(visual.textContent).not.toContain('Loading…');
    expect(container.querySelector('.loading-status__label')!.textContent).toBe('Loading…');
  });

  it('passes through an extra className', () => {
    const { container } = render(<LoadingStatus label="Loading…" className="my-loader" />);
    const region = container.querySelector('.loading-status')!;
    expect(region.classList.contains('loading-status')).toBe(true);
    expect(region.classList.contains('my-loader')).toBe(true);
  });
});
