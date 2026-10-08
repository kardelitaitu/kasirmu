import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { RankedList } from '@/features/analytics/cards/shared/RankedList';
import { CardLoading, CardError, CardEmpty } from '@/features/analytics/cards/shared/CardStates';
import analyticsFtl from '@/locales/analytics.ftl?raw';

/* The other two analytics shared primitives, held to the same standard as the
 * Kpi/DeltaChip file: reached only through AnalyticsScreen.test.tsx, which
 * asserts the card grid and never their own branches.
 *
 * Two of the cases below are not cosmetic.
 *   * RankedList computes `Math.max(...values, 1)` — the ", 1" is the guard that
 *     keeps an all-zero or empty list from producing NaN widths. Removing it
 *     does not throw; it silently emits `width: NaN%`, which is exactly the
 *     class of failure a render test should catch and a type-check cannot.
 *   * CardError's docstring makes a SECURITY claim (ERR-05): "Only the
 *     localized user-safe copy is rendered, never the raw backend message."
 *     The case below asserts that directly by passing a recognisable secret.
 */
describe('analytics shared primitives — RankedList and card states', () => {
  const rows = [
    { name: 'Nasi Goreng', value: 80, display: 'Rp 800k', delta: 12.5 },
    { name: 'Mie Ayam', value: 40, display: 'Rp 400k', delta: -4.0 },
  ];

  describe('RankedList', () => {
    it('numbers rows from 1 and names them by aria-label', () => {
      renderWithFluentSync(<RankedList rows={rows} ariaLabel="Top items" />, analyticsFtl);
      expect(screen.getByRole('list', { name: 'Top items' })).toBeInTheDocument();
      // Position is the VISIBLE rank, not the array index.
      expect(screen.getAllByText('1')[0]).toBeInTheDocument();
      expect(screen.getByText('Nasi Goreng')).toBeInTheDocument();
    });

    it('scales each bar against the largest value in the list', () => {
      const { container } = renderWithFluentSync(<RankedList rows={rows} ariaLabel="Top items" />, analyticsFtl);
      const bars = [...container.querySelectorAll<HTMLElement>('.analytics-rank-bar')];
      expect(bars[0]!.style.width).toBe('100%');   // the max row
      expect(bars[1]!.style.width).toBe('50%');    // half of 80
    });

    // The ", 1" guard in `Math.max(...values, 1)`. Without it an empty list
    // gives Math.max() === -Infinity and an all-zero list divides by zero; both
    // surface as a NaN width rather than a thrown error.
    // The ", 1" guard in `Math.max(...values, 1)`. Without it an all-zero list
    // divides by zero and computes `width: NaN%`.
    //
    // Asserted this way ON PURPOSE, after the first version of this case passed
    // with the guard removed. React DROPS a style declaration whose value is
    // invalid, so `width: NaN%` does not render as the string "NaN%" — it
    // renders as NO style attribute at all, and `style.width` reads "".
    // An assertion that only rejected the literal text "NaN" was therefore
    // vacuous: an empty string contains no "NaN" either. The falsifiable
    // signal is the ABSENCE of the declaration, so that is what is checked.
    it('still emits a bar width when every value is zero (the ", 1" guard)', () => {
      const zeros = [
        { name: 'A', value: 0, display: '0' },
        { name: 'B', value: 0, display: '0' },
      ];
      const { container } = renderWithFluentSync(<RankedList rows={zeros} ariaLabel="Empty metrics" />, analyticsFtl);
      const bars = [...container.querySelectorAll<HTMLElement>('.analytics-rank-bar')];
      expect(bars).toHaveLength(2);
      for (const b of bars) {
        expect(b.style.width, 'a zero row must still carry a width, not a dropped NaN declaration').not.toBe('');
        expect(b.style.width).toBe('0%');
      }
    });

    it('renders an empty list without throwing', () => {
      const { container } = renderWithFluentSync(<RankedList rows={[]} ariaLabel="Nothing" />, analyticsFtl);
      expect(container.querySelectorAll('.analytics-rank-row')).toHaveLength(0);
    });

    it('honours limit by slicing, and shows every row when it is undefined', () => {
      const three = [...rows, { name: 'Es Teh', value: 10, display: 'Rp 100k' }];
      const { container, unmount } = renderWithFluentSync(
        <RankedList rows={three} ariaLabel="Top" limit={2} />, analyticsFtl,
      );
      expect(container.querySelectorAll('.analytics-rank-row')).toHaveLength(2);
      unmount();
      const full = renderWithFluentSync(<RankedList rows={three} ariaLabel="Top" />, analyticsFtl);
      expect(full.container.querySelectorAll('.analytics-rank-row')).toHaveLength(3);
    });

    it('omits the delta pill entirely when a row has no delta', () => {
      const noDelta = [{ name: 'Only', value: 5, display: 'Rp 50k' }];
      const { container } = renderWithFluentSync(<RankedList rows={noDelta} ariaLabel="Top" />, analyticsFtl);
      expect(container.querySelector('.analytics-rank-delta')).toBeNull();
    });

    it('marks the delta pill up or down by sign, glyph and colour agreeing', () => {
      const { container } = renderWithFluentSync(<RankedList rows={rows} ariaLabel="Top" />, analyticsFtl);
      const pills = [...container.querySelectorAll<HTMLElement>('.analytics-rank-delta')];
      expect(pills[0]).toHaveClass('analytics-rank-delta--up');
      expect(pills[0]!.textContent).toContain('▲');
      expect(pills[1]).toHaveClass('analytics-rank-delta--down');
      expect(pills[1]!.textContent).toContain('▼');
    });
  });

  describe('CardLoading', () => {
    it('renders the skeleton bars the shimmer rule styles', () => {
      const { container } = renderWithFluentSync(<CardLoading />, analyticsFtl);
      expect(container.querySelector('.analytics-card-skeleton')).not.toBeNull();
      expect(container.querySelectorAll('.skeleton-bar')).toHaveLength(3);
    });
  });

  describe('CardError', () => {
    it('announces as an alert and shows the localized copy', () => {
      renderWithFluentSync(<CardError error={new Error('boom')} />, analyticsFtl);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Couldn't load this chart/)).toBeInTheDocument();
    });

    // ERR-05, asserted rather than assumed: an unrecognized error's own message
    // must never reach the DOM. The string below is chosen to be unmistakable.
    it('never renders the raw backend message of an unrecognized error', () => {
      renderWithFluentSync(
        <CardError error={new Error('SECRET_TENANT_ID=acme-internal-9f3')} />, analyticsFtl,
      );
      expect(screen.queryByText(/SECRET_TENANT_ID/)).not.toBeInTheDocument();
      expect(screen.getByText(/Couldn't load this chart/)).toBeInTheDocument();
    });

    it('renders the localized copy for a non-Error throw too', () => {
      renderWithFluentSync(<CardError error={{ raw: 'opaque' }} />, analyticsFtl);
      expect(screen.getByRole('alert').textContent).not.toContain('opaque');
    });
  });

  describe('CardEmpty', () => {
    it('renders as a status with the caller-supplied message', () => {
      renderWithFluentSync(<CardEmpty message="No sales in this period" />, analyticsFtl);
      expect(screen.getByRole('status')).toHaveTextContent('No sales in this period');
    });
  });
});
