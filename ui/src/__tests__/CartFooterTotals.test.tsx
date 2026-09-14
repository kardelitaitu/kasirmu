import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { withFluent } from '@/locales/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import { CartFooterTotals } from '@/features/sales/components/CartFooterTotals';
import { IDLE_TAX_STATE } from '@/features/sales/components/CartTaxWatcher';
import type { CartTaxCacheState } from '@/hooks/useCartTax';
import type { Promotion } from '@/api/promotions';
import { formatMoney, type CartLine, type LineId, type Money, type Sku } from '@/types/domain';

// ── CartFooterTotals behavioural tests ───────────────────────────────
//
// The 340-line footer (subtotal toggle / discount entry / promotion chips /
// tip segments / service-charge toggle / tax lines / children slot) had no
// component-level test: PosScreen.integration.test.tsx only reached it
// through the whole screen, so each branch below was asserted, if at all, by
// whichever screen case happened to click something.
//
// Harness mirrors CourseSelectorBar.test.tsx: withFluent + the production
// sales.ftl, no store mocking — the component is presentational and takes its
// whole world as props. Accessible names are asserted as the bundle values, so
// a renamed key fails here instead of shipping an unnamed control.
//
// One shape note that constrains every query below: the collapsible body is
// NOT conditionally rendered. CartFooterTotals.tsx:106 always renders
// div.pos-cart-options-collapse and only toggles the --open CLASS, so the tip
// segments and the service toggle stay in the DOM while collapsed. Button
// counts are therefore scoped to their own area, never to the footer.

const SUBTOTAL: Money = { minor_units: 150000, currency: 'IDR' };
const DISCOUNT: Money = { minor_units: 15000, currency: 'IDR' };
const TIP: Money = { minor_units: 27000, currency: 'IDR' };
const SERVICE: Money = { minor_units: 15000, currency: 'IDR' };

let lineSeq = 0;

/** Minimal CartLine fixture; the branded ids are fakes cast at the boundary. */
function makeLine(): CartLine {
  lineSeq += 1;
  return {
    id: ('line-' + lineSeq) as LineId,
    sku: ('SKU-' + lineSeq) as Sku,
    qty: 1,
    unit_price: { minor_units: 15000, currency: 'IDR' },
  };
}

const PROMOTION = { id: 'promo-1', name: 'Buy 1 Get 1' } as unknown as Promotion;

interface Overrides {
  lines?: CartLine[];
  subtotal?: Money;
  discountPercent?: number;
  discountLabel?: string;
  discountAmount?: Money | null;
  showOptions?: boolean;
  showDiscountInput?: boolean;
  appliedPromotions?: Promotion[];
  discountInput?: string;
  tipPercent?: number;
  tipAmount?: Money | null;
  serviceChargeEnabled?: boolean;
  serviceChargePercent?: number;
  serviceChargeAmount?: Money | null;
  cartTax?: number;
  taxEstimated?: boolean;
  taxState?: CartTaxCacheState;
}

function renderFooter(overrides: Overrides = {}) {
  const setShowOptions = vi.fn();
  const setShowDiscountInput = vi.fn();
  const setShowPromotions = vi.fn();
  const setAppliedPromotions = vi.fn();
  const setDiscountInput = vi.fn();
  const setDiscountName = vi.fn();
  const handleApplyDiscount = vi.fn();
  const handleClearDiscount = vi.fn();
  const setTipPercent = vi.fn();
  const setServiceCharge = vi.fn();
  const retryTaxEstimate = vi.fn();

  const result = render(
    withFluent(
      <CartFooterTotals
        lines={overrides.lines ?? [makeLine()]}
        subtotal={overrides.subtotal ?? SUBTOTAL}
        discountPercent={overrides.discountPercent ?? 0}
        discountLabel={overrides.discountLabel ?? ''}
        discountAmount={overrides.discountAmount ?? null}
        showOptions={overrides.showOptions ?? false}
        setShowOptions={setShowOptions}
        showDiscountInput={overrides.showDiscountInput ?? false}
        setShowDiscountInput={setShowDiscountInput}
        setShowPromotions={setShowPromotions}
        appliedPromotions={overrides.appliedPromotions ?? []}
        setAppliedPromotions={setAppliedPromotions}
        discountInput={overrides.discountInput ?? ''}
        setDiscountInput={setDiscountInput}
        discountName=""
        setDiscountName={setDiscountName}
        handleApplyDiscount={handleApplyDiscount}
        handleClearDiscount={handleClearDiscount}
        tipPercent={overrides.tipPercent ?? 0}
        setTipPercent={setTipPercent}
        tipAmount={overrides.tipAmount ?? null}
        serviceChargeEnabled={overrides.serviceChargeEnabled ?? false}
        serviceChargePercent={overrides.serviceChargePercent ?? 10}
        serviceChargeAmount={overrides.serviceChargeAmount ?? null}
        setServiceCharge={setServiceCharge}
        cartTax={overrides.cartTax ?? 0}
        taxEstimated={overrides.taxEstimated ?? false}
        taxState={overrides.taxState ?? IDLE_TAX_STATE}
        retryTaxEstimate={retryTaxEstimate}
      >
        <div data-testid="footer-slot">action bar</div>
      </CartFooterTotals>,
      salesFtl,
    ),
  );

  return {
    ...result,
    setShowOptions,
    setShowDiscountInput,
    setShowPromotions,
    setAppliedPromotions,
    handleApplyDiscount,
    handleClearDiscount,
    setTipPercent,
    setServiceCharge,
    retryTaxEstimate,
  };
}

describe('CartFooterTotals', () => {
  it('renders the subtotal header as one expand-state button and toggles the body class', () => {
    const first = renderFooter({ showOptions: false });
    const { container, setShowOptions } = first;

    const toggle = screen.getByRole('button', { name: 'Expand options' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.className).toContain('pos-cart-options-toggle');
    // The subtotal is the money the parent computed, formatted, not re-derived.
    expect(container.querySelector('.pos-cart-subtotal-label')?.textContent).toBe('Subtotal');
    expect(container.querySelector('.pos-cart-subtotal-amount')?.textContent).toBe(
      formatMoney(SUBTOTAL),
    );
    // The chevron is decoration: aria-hidden, with a class-only open marker.
    const chevron = container.querySelector('.pos-cart-options-chevron');
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    expect(chevron?.className).not.toContain('pos-cart-options-chevron--open');
    expect(container.querySelector('.pos-cart-options-collapse')?.className).not.toContain(
      'pos-cart-options-collapse--open',
    );

    fireEvent.click(toggle);
    // The component uses the functional updater form, so the argument is a
    // function — run it to prove the click means "flip", not "open".
    const arg = setShowOptions.mock.calls[0]?.[0];
    expect(typeof arg).toBe('function');
    expect((arg as (prev: boolean) => boolean)(false)).toBe(true);
    expect((arg as (prev: boolean) => boolean)(true)).toBe(false);

    first.unmount();
    const open = renderFooter({ showOptions: true });
    expect(
      screen.getByRole('button', { name: 'Collapse options' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(open.container.querySelector('.pos-cart-options-collapse')?.className).toContain(
      'pos-cart-options-collapse--open',
    );
  });

  it('offers Add Discount and Promotions as the only two entry-point buttons, each opening its own surface', () => {
    const { container, setShowDiscountInput, setShowPromotions } = renderFooter();

    const entry = container.querySelectorAll('.pos-cart-discount-actions button');
    // Measured: two, not three — the form and the applied row are absent.
    expect(entry).toHaveLength(2);
    expect(container.querySelector('.pos-cart-discount-form')).toBeNull();
    expect(container.querySelector('.pos-cart-promotion-row')).toBeNull();

    const addDiscount = screen.getByRole<HTMLButtonElement>('button', { name: '+ Add Discount' });
    const addPromotion = screen.getByRole<HTMLButtonElement>('button', { name: '+ Promotions' });
    expect(addDiscount.className).toContain('pos-cart-discount-btn');
    expect(addPromotion.className).toContain('pos-cart-promotion-btn');

    fireEvent.click(addDiscount);
    expect(setShowDiscountInput).toHaveBeenCalledTimes(1);
    expect(setShowDiscountInput).toHaveBeenCalledWith(true);
    expect(setShowPromotions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '+ Promotions' }));
    expect(setShowPromotions).toHaveBeenCalledTimes(1);
    expect(setShowPromotions).toHaveBeenCalledWith(true);

    // Finding, not an omission: `disabled={!subtotal}` on + Promotions cannot
    // fire against the declared prop type — Money is a non-nullable object, so
    // even { minor_units: 0 } is truthy. The disabled path is asserted absent
    // rather than forced through a cast the component never sees.
    expect(addPromotion.disabled).toBe(false);
  });

  it('replaces the entry buttons with the applied discount row and chip, and clears each through its callback', () => {
    const { container, handleClearDiscount, setAppliedPromotions } = renderFooter({
      discountPercent: 10,
      discountLabel: 'Weekend',
      discountAmount: DISCOUNT,
      appliedPromotions: [PROMOTION],
    });

    // A percent discount is exclusive of the entry buttons: the ternary at
    // CartFooterTotals.tsx:112 never renders .pos-cart-discount-actions.
    expect(screen.queryByRole('button', { name: '+ Add Discount' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Promotions' })).toBeNull();
    // The row label is the bundle message with the label var interpolated.
    expect(container.querySelector('.pos-cart-discount-label')?.textContent).toBe(
      'Discount (Weekend)',
    );
    expect(container.querySelector('.pos-cart-discount-amount')?.textContent).toBe(
      '-' + formatMoney(DISCOUNT),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove discount' }));
    expect(handleClearDiscount).toHaveBeenCalledTimes(1);

    // PROMO-3: the chip shows the promotion name and its own remove control,
    // whose aria name also carries the name — and clearing sends the filtered
    // list, not a per-id removal call.
    const chip = container.querySelector('.pos-cart-promotion-chip');
    expect(chip?.textContent).toContain('Buy 1 Get 1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove promotion Buy 1 Get 1' }));
    expect(setAppliedPromotions).toHaveBeenCalledTimes(1);
    expect(setAppliedPromotions).toHaveBeenCalledWith([]);
  });

  it('renders the tip group as four segments with per-percent names and exactly one pressed state', () => {
    const first = renderFooter({ tipPercent: 15, tipAmount: TIP });
    const { container, setTipPercent } = first;

    const group = screen.getByRole('group', { name: 'Tip selection' });
    const segments = group.querySelectorAll('button');
    expect(segments).toHaveLength(4);
    // The zero segment is a real button named from its own key, not
    // "Set tip to 0 percent", and its text is the None message.
    expect(Array.from(segments).map((b) => b.getAttribute('aria-label'))).toEqual([
      'No tip',
      'Set tip to 15 percent',
      'Set tip to 18 percent',
      'Set tip to 20 percent',
    ]);
    expect(Array.from(segments).map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    expect(screen.getByRole('button', { name: 'No tip' }).textContent).toBe('None');

    fireEvent.click(screen.getByRole('button', { name: 'Set tip to 18 percent' }));
    expect(setTipPercent).toHaveBeenCalledTimes(1);
    expect(setTipPercent).toHaveBeenCalledWith(18);

    // The preview row exists only while the parent supplies a tip amount.
    const preview = container.querySelector('.pos-cart-tip-preview-row')?.textContent;
    expect(preview).toContain('Tip (15%)');
    expect(preview).toContain('+' + formatMoney(TIP));

    first.unmount();
    const bare = renderFooter({ tipPercent: 0, tipAmount: null });
    expect(bare.container.querySelector('.pos-cart-tip-preview-row')).toBeNull();
  });

  it('toggles the service charge with its pressed state and sends the inverted flag', () => {
    const first = renderFooter({ serviceChargeEnabled: false, serviceChargePercent: 10 });
    const { container, setServiceCharge } = first;

    const toggle = screen.getByRole('button', { name: 'Toggle service charge' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.className).not.toContain('pos-cart-service-toggle--on');
    // The visible label is the bundle message with the percent var filled in.
    expect(toggle.textContent).toContain('Add 10% service charge');
    expect(container.querySelector('.pos-cart-service-preview-row')).toBeNull();
    fireEvent.click(toggle);
    expect(setServiceCharge).toHaveBeenCalledTimes(1);
    expect(setServiceCharge).toHaveBeenCalledWith(true);

    first.unmount();
    const on = renderFooter({
      serviceChargeEnabled: true,
      serviceChargePercent: 10,
      serviceChargeAmount: SERVICE,
    });
    const onToggle = screen.getByRole('button', { name: 'Toggle service charge' });
    expect(onToggle.getAttribute('aria-pressed')).toBe('true');
    expect(onToggle.className).toContain('pos-cart-service-toggle--on');
    const row = on.container.querySelector('.pos-cart-service-preview-row')?.textContent;
    expect(row).toContain('Service (10%)');
    expect(row).toContain('+' + formatMoney(SERVICE));
    fireEvent.click(onToggle);
    expect(on.setServiceCharge).toHaveBeenCalledWith(false);
  });

  it('renders tax from cartTax only, offers retry for a failed estimate, and stays silent on an empty cart', () => {
    const withTax = renderFooter({
      cartTax: 11000,
      taxEstimated: true,
      taxState: { ...IDLE_TAX_STATE, severity: 'ok' },
    });
    const taxRows = Array.from(withTax.container.querySelectorAll('.pos-cart-tax-row'));
    expect(taxRows).toHaveLength(1);
    expect(taxRows[0]?.textContent).toContain('PPN');
    expect(taxRows[0]?.textContent).toContain(formatMoney({ minor_units: 11000, currency: 'IDR' }));
    // F2-3: an estimated figure is marked by class, never by invented copy.
    expect(taxRows[0]?.querySelector('.pos-cart-tax-estimated')).not.toBeNull();
    // The children slot renders last, inside the footer.
    expect(withTax.container.querySelector('.pos-cart-footer')?.lastElementChild?.getAttribute('data-testid')).toBe(
      'footer-slot',
    );
    withTax.unmount();

    // A failed estimate with lines in the cart => live-region retry control.
    const failed = renderFooter({ taxState: { ...IDLE_TAX_STATE, severity: 'warn' } });
    const status = screen.getByRole('status');
    expect(failed.container.contains(status)).toBe(true);
    // The retry key lives in shared.ftl and withFluent auto-loads the shared
    // bundle for en, so this name is the production message, not a fallback.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.retryTaxEstimate).toHaveBeenCalledTimes(1);
    failed.unmount();

    // Empty cart: the same warn state must NOT offer a retry (the guard at
    // :324 is lines.length > 0), and cartTax 0 means no PPN row at all.
    const empty = renderFooter({
      lines: [],
      taxState: { ...IDLE_TAX_STATE, severity: 'warn' },
    });
    expect(empty.container.querySelector('[role="status"]')).toBeNull();
    expect(empty.container.querySelectorAll('.pos-cart-tax-row')).toHaveLength(0);
    // The discount entry points and the tip segments are still mounted —
    // emptiness is not a footer-wide render gate.
    expect(empty.container.querySelectorAll('.pos-cart-discount-actions button')).toHaveLength(2);
    expect(empty.container.querySelectorAll('.pos-cart-tip-segment')).toHaveLength(4);
  });
});
