/**
 * @vitest-environment jsdom
 *
 * Focus management for the open-bill dialogs. These two are the only sales
 * modals that declare `aria-modal="true"` without using `useFocusTrap` — every
 * sibling (ItemModifierModal, SplitBillModal, PromotionsModal, RefundModal,
 * PriceOverrideModal, StockShortfallDialog) installs it. Without it a keyboard
 * operator gets no autofocus into the dialog and Tab walks out into the page
 * behind the modal, which is still there and still focusable.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpenBillInput, OpenBillsPanel } from '@/features/sales/components/OpenBillModals';

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({ l10n: { getString: (id: string) => id } }),
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const exitHandle = { shouldRender: true, exiting: false, requestClose: vi.fn() };

describe('OpenBillInput — keyboard focus', () => {
  it('moves focus into the dialog when it opens', async () => {
    render(
      <OpenBillInput
        openBillInputExit={exitHandle}
        openBillName=""
        setOpenBillName={vi.fn()}
        openingBill={false}
        handleOpenBill={vi.fn(async () => {})}
      />,
    );
    const input = screen.getByRole('textbox');
    // The name field is what the dialog is FOR, so it must hold focus on open.
    expect(document.activeElement, 'focus must land inside the dialog on open').toBe(input);
  });

  it('keeps Tab inside the dialog (does not reach the page behind)', async () => {
    // A control OUTSIDE the dialog, as the real page has.
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);

    render(
      <OpenBillInput
        openBillInputExit={exitHandle}
        openBillName=""
        setOpenBillName={vi.fn()}
        openingBill={false}
        handleOpenBill={vi.fn(async () => {})}
      />,
    );

    // Tab well past the number of controls in the dialog; focus must wrap, never
    // land on the sibling outside it.
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      expect(
        document.activeElement,
        'Tab escaped the modal and reached the page behind it',
      ).not.toBe(outside);
    }
    document.body.removeChild(outside);
  });

  it('Escape closes the dialog', async () => {
    const requestClose = vi.fn();
    render(
      <OpenBillInput
        openBillInputExit={{ ...exitHandle, requestClose }}
        openBillName=""
        setOpenBillName={vi.fn()}
        openingBill={false}
        handleOpenBill={vi.fn(async () => {})}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(requestClose, 'Escape must request close, as every sibling modal does').toHaveBeenCalled();
  });
});

describe('OpenBillsPanel — keyboard focus', () => {
  it('moves focus into the dialog when it opens', () => {
    const { container } = render(
      <OpenBillsPanel
        openBillsExit={exitHandle}
        openBills={[
          { id: 'h1', label: 'Hold #1', item_count: 1, total_minor: 100, currency: 'IDR', created_at: '2026-01-01T00:00:00Z', bill_type: 'open_bill', customer_name: null },
        ]}
        handleResumeOpenBill={vi.fn(async () => true)}
      />,
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog, 'the panel must still render as a dialog').not.toBeNull();
    expect(
      dialog!.contains(document.activeElement),
      'focus must land inside the dialog on open',
    ).toBe(true);
  });
});
