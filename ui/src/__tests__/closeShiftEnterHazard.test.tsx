/**
 * @vitest-environment jsdom
 *
 * Close-shift dialog: Enter must not confirm from inside the notes field.
 *
 * The overlay binds `onKeyDown` and maps Enter to `handleConfirmCloseShift()` with no
 * target guard. A keydown from the notes <textarea> bubbles to that handler, and a
 * textarea is exactly where a cashier types a multi-line note and presses Enter — so
 * the keystroke that should insert a newline closed the shift instead.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withFluent } from '@/i18n/test-utils';
import productsFtl from '@/locales/products.ftl?raw';
import {
  CloseShiftConfirm,
  OpenShiftModal,
  type CloseShiftConfirmProps,
  type OpenShiftModalProps,
} from '@/features/sales/components/ShiftModals';

const baseProps = (): CloseShiftConfirmProps => ({
  closeShiftExit: { shouldRender: true, exiting: false, requestClose: vi.fn() },
  // A COMPLETE ShiftDto. The component reads openedAt + openingBalanceMinor, but
  // object literals are checked in full, so a partial one is a type error even when
  // every field the component touches is present.
  activeShift: {
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
  },
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

function renderDialog(overrides: Partial<CloseShiftConfirmProps> = {}) {
  const props: CloseShiftConfirmProps = { ...baseProps(), ...overrides };
  return render(
    withFluent(
      <CloseShiftConfirm {...props} />,
      productsFtl,
    ),
  );
}

describe('CloseShiftConfirm — Enter must not close the shift from a text field', () => {
  it('does NOT confirm when Enter is pressed inside the notes textarea', async () => {
    const handleConfirmCloseShift = vi.fn();
    renderDialog({ handleConfirmCloseShift });
    const notes = screen.getByLabelText(/notes/i);
    notes.focus();
    await userEvent.keyboard('{Enter}');
    expect(
      handleConfirmCloseShift,
      'Enter in the notes field must insert a newline, not close the shift',
    ).not.toHaveBeenCalled();
  });

  it('does NOT confirm when Enter is pressed inside the counted-cash input', async () => {
    const handleConfirmCloseShift = vi.fn();
    renderDialog({ handleConfirmCloseShift });
    const balance = screen.getByLabelText(/counted cash/i);
    balance.focus();
    await userEvent.keyboard('{Enter}');
    expect(
      handleConfirmCloseShift,
      'Enter in the cash field must not close the shift',
    ).not.toHaveBeenCalled();
  });


  it('does NOT confirm a SECOND time when Enter is pressed while the close is in flight', async () => {
    // The Confirm button is guarded — `disabled={closingShift || ...}` (:192-197) — but the
    // overlay's Enter binding above it is NOT (:104). `closingShift` is set by the hook as
    // soon as the first write starts and only cleared in its `finally`, so a cashier who
    // clicks Close Shift and then presses Enter (the natural confirmation gesture, and the
    // one this dialog deliberately supports) fires a SECOND `closeShiftScoped` while the
    // first is still in flight. Closing a shift is a money event.
    //
    // The button's `disabled` cannot cover it: a keydown on the overlay never consults the
    // button's state at all. Focus is on Cancel exactly as the reachability case below
    // uses — that case proves this focus DOES reach the overlay handler, so this one is not
    // vacuous by construction.
    const handleConfirmCloseShift = vi.fn();
    renderDialog({
      closingShift: true,
      handleConfirmCloseShift,
    });
    // Cancel is `disabled={closingShift}` (:182), so focusing it is a NO-OP while in
    // flight and the keydown would land on <body> instead of the overlay. Focus the panel
    // itself, which is not disabled, so the handler is genuinely reached.
    const panel = document.querySelector('.pos-close-shift-modal') as HTMLElement | null;
    expect(panel, 'the close-shift panel was not found').not.toBeNull();
    panel!.setAttribute('tabindex', '-1');
    panel!.focus();
    await userEvent.keyboard('{Enter}');

    // THE ASSERTION: a second close must not be issued while the first is in flight.
    // (The reachability this test depends on was established by inverting the assertion:
    // with the panel focused, Enter DOES reach the handler even while closing.)
    expect(
      handleConfirmCloseShift,
      'Enter during an in-flight close issued a second close',
    ).not.toHaveBeenCalled();
  });

  it('still confirms on Enter when focus is not in a text field', async () => {
    // The shortcut is a deliberate affordance for a keyboarded till; guard the
    // inversion so a fix cannot simply delete it.
    const handleConfirmCloseShift = vi.fn();
    renderDialog({ handleConfirmCloseShift });
    // A non-text control inside the dialog: the overlay itself has no tabIndex, so
    // focusing it is a no-op and the key would go to <body>.
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    cancelBtn.focus();
    await userEvent.keyboard('{Enter}');
    expect(handleConfirmCloseShift).toHaveBeenCalledTimes(1);
  });
});

const openBaseProps = (): OpenShiftModalProps => ({
  openShiftExit: { shouldRender: true, exiting: false, requestClose: vi.fn() },
  openingBalance: '50000',
  setOpeningBalance: vi.fn(),
  openingShift: false,
  handleConfirmOpenShift: vi.fn(),
  currency: 'IDR',
});

describe('OpenShiftConfirm — Enter must not open the shift from a text field', () => {
  it('does NOT confirm when Enter is pressed inside the opening-balance input', async () => {
    const handleConfirmOpenShift = vi.fn();
    render(
      withFluent(
        <OpenShiftModal {...{ ...openBaseProps(), handleConfirmOpenShift }} />,
        productsFtl,
      ),
    );
    const input = screen.getByLabelText(/opening balance/i);
    input.focus();
    await userEvent.keyboard('{Enter}');
    expect(
      handleConfirmOpenShift,
      'Enter while typing the opening balance must not open the shift',
    ).not.toHaveBeenCalled();
  });

  it('still confirms on Enter from a non-text control', async () => {
    const handleConfirmOpenShift = vi.fn();
    render(
      withFluent(
        <OpenShiftModal {...{ ...openBaseProps(), handleConfirmOpenShift }} />,
        productsFtl,
      ),
    );
    screen.getByRole('button', { name: /cancel/i }).focus();
    await userEvent.keyboard('{Enter}');
    expect(handleConfirmOpenShift).toHaveBeenCalledTimes(1);
  });
});

