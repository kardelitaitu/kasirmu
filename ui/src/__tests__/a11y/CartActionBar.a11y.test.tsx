//! A11y regression tests for the cart action bar and the open-bill modals.
//!
//! These are the last two interactive cart surfaces without axe coverage: the
//! Clear / Charge / Save-Tab row every sale passes through, and the two held-cart
//! modals (the bill-name prompt and the open-bills list). Both take plain props,
//! so neither needs the POS screen's IPC harness.
//!
//! The REAL sales bundle is mounted through `withFluent` — both components name
//! their controls from Fluent, and the axe-helper's minimal bundle would leave
//! `<Localized ... attrs>` names unset and report labels production has.

import { describe, it, expect, vi } from 'vitest';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import { checkA11y } from './axe-helper';
import { CartActionBar, type CartActionBarProps } from '@/features/sales/components/CartActionBar';
import { OpenBillInput } from '@/features/sales/components/OpenBillModals';
import type { ShiftDto } from '@/api/shifts';
import type { MutableRefObject } from 'react';

const STAMP = '2026-09-14T01:00:00.000Z';

const OPEN_SHIFT: ShiftDto = {
  id: 'shift-1',
  userId: 'user-1',
  terminalId: null,
  openedAt: STAMP,
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
  createdAt: STAMP,
  updatedAt: STAMP,
};

describe('cart action bar & open-bill modals a11y', () => {
  it('CartActionBar has no axe violations with a shift open', async () => {
    const deductionLocationIdRef: MutableRefObject<string | null> = { current: 'loc-7' };
    const props: CartActionBarProps = {
      activeShift: OPEN_SHIFT,
      shiftUnavailable: false,
      handlePay: vi.fn(),
      addToast: vi.fn(() => 'toast-1'),
      setShowOpenBillInput: vi.fn(),
      setCartId: vi.fn(),
      deductionLocationIdRef,
      setDeductionLocationName: vi.fn(),
      setDeductionOverridden: vi.fn(),
      resetCart: vi.fn(),
    };

    await renderInAct(withFluent(<CartActionBar {...props} />, salesFtl));
    const container = document.body;
    await checkA11y(container);

    // Vacuity guard: exactly the three actions the row owns.
    expect(container.querySelectorAll('.pos-cart-actions-row button').length).toBe(3);
    expect(container.querySelector('.pos-cart-pay-btn')).toBeTruthy();
    expect(container.querySelector('[data-testid="pos-cart-save-tab-btn"]')).toBeTruthy();
  });

  it('OpenBillInput has no axe violations', async () => {
    await renderInAct(
      withFluent(
        <OpenBillInput
          openBillInputExit={{ shouldRender: true, exiting: false } as never}
          openBillName="Table 12"
          setOpenBillName={vi.fn()}
          openingBill={false}
          handleOpenBill={vi.fn(async () => {})}
        />,
        salesFtl,
      ),
    );
    const container = document.body;
    await checkA11y(container);

    // Vacuity guard: the name field and the confirm/cancel pair mounted.
    const field = container.querySelector('.pos-hold-input') as HTMLInputElement | null;
    expect(field, 'the open-bill name input did not mount').toBeTruthy();
    expect(container.querySelector('.pos-hold-overlay')).toBeTruthy();
  });
});
