/**
 * @vitest-environment jsdom
 *
 * Focus management for the three shift dialogs on the POS till.
 *
 * All three declare `aria-modal="true"` and none installed `useFocusTrap`. Round 30
 * fixed the Enter hazard in two of them (Enter in a field committed the action); this
 * covers the other half — focus was never moved into the dialog, and Tab walked into
 * the page the dialog is covering. Every sibling sales dialog traps: ItemModifierModal
 * :253, SplitBillModal:37, PromotionsModal:66, RefundModal:176, PriceOverrideModal:176,
 * StockShortfallDialog:115, RestaurantCartSheet, OpenBillModals, and the menu editor's
 * category dialog.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withFluent } from '@/i18n/test-utils';
import productsFtl from '@/locales/products.ftl?raw';
import type { ShiftDto } from '@/api/shifts';
import {
  CloseShiftConfirm,
  OpenShiftModal,
  ShiftSummary,
  type CloseShiftConfirmProps,
  type OpenShiftModalProps,
  type ShiftSummaryProps,
} from '@/features/sales/components/ShiftModals';

const shift = (): CloseShiftConfirmProps['activeShift'] => ({
  id: 'shift-1',
  userId: 'user-1',
  terminalId: null,
  openedAt: '2026-01-01T00:00:00Z',
  closedAt: null,
  openingBalanceMinor: 100000,
  closingBalanceMinor: null,
  expectedCashMinor: null,
  cashDifferenceMinor: null,
  totalSalesMinor: 0,
  totalCashMinor: 0,
  totalCardMinor: 0,
  totalOtherMinor: 0,
  totalVoidsMinor: 0,
  totalRefundsMinor: 0,
  totalPayoutsMinor: 0,
  notes: '',
  status: 'open',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const closeProps = (): CloseShiftConfirmProps => ({
  closeShiftExit: { shouldRender: true, exiting: false, requestClose: vi.fn() },
  activeShift: shift(),
  closeShiftError: null,
  setCloseShiftError: vi.fn(),
  closingBalance: '150000',
  setClosingBalance: vi.fn(),
  shiftNotes: '',
  setShiftNotes: vi.fn(),
  closingShift: false,
  setShowCloseShift: vi.fn(),
  handleConfirmCloseShift: vi.fn(),
  currency: 'IDR',
});

const openProps = (): OpenShiftModalProps => ({
  openShiftExit: { shouldRender: true, exiting: false, requestClose: vi.fn() },
  openingBalance: '50000',
  setOpeningBalance: vi.fn(),
  openingShift: false,
  handleConfirmOpenShift: vi.fn(),
  currency: 'IDR',
});

const summaryProps = (): ShiftSummaryProps => {
  // Annotated, not spread: a spread of the union widens every property to optional,
  // which `ShiftDto` (all required) rejects. vitest transpiles without typechecking, so
  // this only surfaces under `npm run typecheck`.
  const closed: ShiftDto = { ...shift(), status: 'closed' } as ShiftDto;
  return {
    shiftSummaryExit: { shouldRender: true, exiting: false, requestClose: vi.fn() },
    closedShiftSummary: closed,
    currency: 'IDR',
  };
};

/** Focus must land inside the dialog, and Tab must not leave it. */
async function assertTrapped(element: React.ReactElement) {
  render(withFluent(element, productsFtl));
  const dialog = screen.getByRole('dialog');

  expect(
    dialog.contains(document.activeElement),
    'focus must land inside the dialog on open, not stay on the page behind it',
  ).toBe(true);

  for (let i = 0; i < 10; i += 1) {
    await userEvent.tab();
    expect(
      dialog.contains(document.activeElement),
      `Tab left the dialog on press ${i + 1} and reached the page it covers`,
    ).toBe(true);
  }
}

// ── Escape has exactly one owner ────────────────────────────────────────
//
// The trap and the overlay BOTH used to close on Escape: the hook listens on
// `document`, and the overlay's own onKeyDown bubbled to the same document listener.
// Escape ownership was moved entirely to the hook, so these cases pin the count — a
// second closer would double-fire requestClose and the error reset.
describe('shift dialogs close on Escape exactly once', () => {
  it('CloseShiftConfirm', async () => {
    const requestClose = vi.fn();
    render(
      withFluent(
        <CloseShiftConfirm {...closeProps()} closeShiftExit={{ shouldRender: true, exiting: false, requestClose }} />,
        productsFtl,
      ),
    );
    await userEvent.keyboard('{Escape}');
    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it('OpenShiftModal', async () => {
    const requestClose = vi.fn();
    render(
      withFluent(
        <OpenShiftModal {...openProps()} openShiftExit={{ shouldRender: true, exiting: false, requestClose }} />,
        productsFtl,
      ),
    );
    await userEvent.keyboard('{Escape}');
    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it('ShiftSummary', async () => {
    const requestClose = vi.fn();
    render(
      withFluent(
        <ShiftSummary {...summaryProps()} shiftSummaryExit={{ shouldRender: true, exiting: false, requestClose }} />,
        productsFtl,
      ),
    );
    await userEvent.keyboard('{Escape}');
    expect(requestClose).toHaveBeenCalledTimes(1);
  });
});

describe('shift dialogs trap focus', () => {
  it('CloseShiftConfirm', async () => {
    await assertTrapped(<CloseShiftConfirm {...closeProps()} />);
  });

  it('OpenShiftModal', async () => {
    await assertTrapped(<OpenShiftModal {...openProps()} />);
  });

  it('ShiftSummary', async () => {
    await assertTrapped(<ShiftSummary {...summaryProps()} />);
  });
});
