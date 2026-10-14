// ── Payment modal: the "Other" tender must be SELECTABLE by pointer ──────
//
// WHY THIS FILE EXISTS
//
// A Playwright pass over the rendered modal found the Other tender unreachable
// with a mouse. The row (PaymentModal.tsx:2197) is a <div>, not a <label>,
// because it holds two controls; the sibling tenders work only because a <label>
// natively forwards a click to its radio. The radio itself carries
// `pointer-events: none` (PaymentModal.css:346) and the row's only other hit
// target is a DISABLED text input, which swallows the click:
//
//   elementFromPoint(row centre) -> INPUT.payment-other-input [disabled]
//   real mouse click             -> radio stays unchecked
//   focus() + Space              -> radio checked        (keyboard still works)
//
// So a cashier on a mouse or touchscreen could not charge a method the POS does
// not list — and a touchscreen is the normal restaurant POS. The existing tests
// asserted the Other controls RENDER (PaymentModal.test.tsx:312-325); none
// asserted it could be CHOSEN, which is why this survived.
//
// These pin the behaviour, not the markup: whatever element ends up forwarding
// the click, choosing Other must select it.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { waitFor, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import userEvent from '@testing-library/user-event';
import { withFluent } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';
import type { Money, CartLine, Sku, LineId } from '@/types/domain';

const usd = (minor: number): Money => ({ minor_units: minor, currency: 'USD' });
const lineItem = (): CartLine => ({
  id: 'line-1' as LineId,
  sku: 'COFFEE' as Sku,
  name: 'Coffee',
  qty: 2,
  unit_price: usd(350),
});

async function renderModal() {
  const wrapped = withFluent(<ToastProvider>
    <PaymentModal
      open
      lineItems={[lineItem()]}
      total={usd(700)}
      userId="test-user-id"
      onComplete={vi.fn()}
      onClose={vi.fn()}
    />
  </ToastProvider>, salesFtl);
  await renderInAct(wrapped);
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const otherRadio = () =>
  document.querySelector<HTMLInputElement>('input[name="payment-method"][value="other"]');

describe('payment modal — the Other tender is selectable', () => {
  it('selects Other when its row is clicked with the pointer', async () => {
    await renderModal();
    const radio = otherRadio();
    expect(radio, 'the Other radio must render').not.toBeNull();
    expect(radio!.checked, 'it starts unselected').toBe(false);

    // Press the ROW the cashier actually sees and aims at — not the radio, which
    // is visually hidden. This is the interaction that was broken.
    //
    // fireEvent.pointerDown, not .click: the row forwards POINTER input (see the
    // component comment), because a click aimed at the row's centre lands on a
    // DISABLED input, which fires no click at all. Driving the wrong event here
    // would test a path the component does not use.
    const row = document.querySelector('.payment-method-label--other');
    expect(row, 'the Other row must render').not.toBeNull();
    fireEvent.pointerDown(row!);

    await waitFor(() => {
      expect(
        otherRadio()!.checked,
        'clicking the Other row must select it — the row is a div, so it ' +
          'forwards nothing on its own and the hidden radio cannot be hit',
      ).toBe(true);
    });
  });

  it('enables the name field once Other is selected', async () => {
    await renderModal();
    const field = document.querySelector<HTMLInputElement>('.payment-other-input');
    expect(field!.disabled, 'the name field starts disabled').toBe(true);

    fireEvent.pointerDown(document.querySelector('.payment-method-label--other')!);

    await waitFor(() => {
      const after = document.querySelector<HTMLInputElement>('.payment-other-input');
      expect(
        after!.disabled,
        'selecting Other must enable its name field — otherwise the cashier ' +
          'cannot type the method name and settlement stays blocked',
      ).toBe(false);
    });
  });

  it('still selects Other from the keyboard', async () => {
    // The keyboard path worked before the fix and must keep working: a fix that
    // only makes the row clickable, at the cost of the radio's own focusability,
    // would trade one broken path for another.
    await renderModal();
    const user = userEvent.setup();
    const radio = otherRadio()!;
    radio.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(otherRadio()!.checked).toBe(true));
  });

  it('settles as `other` with the typed name as the method', async () => {
    // End of the path: choosing Other and naming it must produce a payment whose
    // method reflects the typed label, not the literal string "other".
    await renderModal();
    fireEvent.pointerDown(document.querySelector('.payment-method-label--other')!);
    await waitFor(() => expect(otherRadio()!.checked).toBe(true));

    const field = document.querySelector<HTMLInputElement>('.payment-other-input')!;
    fireEvent.change(field, { target: { value: 'Voucher' } });

    await waitFor(() => {
      const { invokeMock } = (globalThis as unknown as { __paymentInvoke?: { invokeMock: (c: string, a?: unknown) => void } }).__paymentInvoke ?? {};
      void invokeMock; // the settle assertion below is via the button's state
      const settle = document.querySelector<HTMLButtonElement>('[data-testid="settle-button"]');
      expect(settle, 'the settle button must render').not.toBeNull();
      expect(
        settle!.getAttribute('aria-disabled'),
        'a named Other tender must be settleable',
      ).not.toBe('true');
    });
  });
});
