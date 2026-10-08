import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { Kpi } from '@/features/analytics/cards/shared/Kpi';
import { DeltaChip } from '@/features/analytics/cards/shared/DeltaChip';
import analyticsFtl from '@/locales/analytics.ftl?raw';

/* The three shared primitives every analytics card renders. They were reached
 * only THROUGH AnalyticsScreen.test.tsx, which asserts the screen's card
 * GRID (drag, collapse, ordering — 49 class assertions) but never the pill
 * LOGIC itself: no test named Kpi, DeltaChip or RankedList, and none of the
 * 106 screen tests touched formatCurrency, tone or delta. A component reached
 * transitively still has its own contract, and these three have real branches.
 *
 * Each case below pins a branch that a refactor could plausibly invert.
 */
describe('analytics shared primitives', () => {
  describe('Kpi', () => {
    it('renders its value and label with no tone modifier by default', () => {
      renderWithFluentSync(<Kpi value="Rp 1.2M" label="Revenue" />, analyticsFtl);
      const el = screen.getByText('Rp 1.2M');
      expect(el).toHaveClass('analytics-kpi-value');
      // Default must NOT be a modifier: 'analytics-kpi-value--' is a distinct
      // class from the base, and a stray suffix would also fail the
      // dynamicClassPrefixes claim in screenExtraction.
      expect(el.className).toBe('analytics-kpi-value');
      expect(screen.getByText('Revenue')).toBeInTheDocument();
    });

    it('appends the tone modifier when one is given', () => {
      renderWithFluentSync(<Kpi value="Rp 4.0M" label="Target" tone="good" />, analyticsFtl);
      expect(screen.getByText('Rp 4.0M')).toHaveClass('analytics-kpi-value--good');
    });

    it('does not confuse the good and bad modifiers', () => {
      renderWithFluentSync(<Kpi value="Rp 2.0M" label="Variance" tone="bad" />, analyticsFtl);
      const el = screen.getByText('Rp 2.0M');
      expect(el).toHaveClass('analytics-kpi-value--bad');
      expect(el).not.toHaveClass('analytics-kpi-value--good');
    });
  });

  describe('DeltaChip', () => {
    it('marks a positive delta up and shows the ▲ glyph', () => {
      renderWithFluentSync(<DeltaChip value={12.5} />, analyticsFtl);
      const el = screen.getByText(/12\.5%/);
      expect(el).toHaveClass('analytics-delta--up');
      expect(el.textContent).toContain('▲');
    });

    it('marks a negative delta down and shows the absolute value with ▼', () => {
      renderWithFluentSync(<DeltaChip value={-8.2} />, analyticsFtl);
      const el = screen.getByText(/8\.2%/);
      expect(el).toHaveClass('analytics-delta--down');
      expect(el.textContent).toContain('▼');
      // The MINUS SIGN is dropped in favour of the glyph; printing "-8.2%" next
      // to "▼" would read as a double negative.
      expect(el.textContent).not.toContain('-8.2');
    });

    it('treats exactly zero as up — the >= boundary, not >', () => {
      renderWithFluentSync(<DeltaChip value={0} />, analyticsFtl);
      expect(screen.getByText(/0\.0%/)).toHaveClass('analytics-delta--up');
    });

    // The whole reason the tone prop exists: for voids, refunds and restock
    // cost, a rise is BAD. The colour follows the semantic direction while the
    // glyph still follows the sign, so the two can disagree by design.
    it('inverts the COLOUR but not the GLYPH when tone is bad and the delta rose', () => {
      renderWithFluentSync(<DeltaChip value={15} tone="bad" />, analyticsFtl);
      const el = screen.getByText(/15\.0%/);
      expect(el).toHaveClass('analytics-delta--down');
      expect(el).not.toHaveClass('analytics-delta--up');
      expect(el.textContent).toContain('▲');
    });

    it('leaves a falling bad-tone delta marked up in colour', () => {
      renderWithFluentSync(<DeltaChip value={-15} tone="bad" />, analyticsFtl);
      const el = screen.getByText(/15\.0%/);
      expect(el).toHaveClass('analytics-delta--up');
      expect(el.textContent).toContain('▼');
    });

    it('adds the comparison suffix only when compare is set', () => {
      const { unmount } = renderWithFluentSync(<DeltaChip value={5} compare />, analyticsFtl);
      expect(screen.getByText(/vs prev/)).toBeInTheDocument();
      unmount();
      renderWithFluentSync(<DeltaChip value={5} />, analyticsFtl);
      expect(screen.queryByText(/vs prev/)).not.toBeInTheDocument();
    });
  });
});
