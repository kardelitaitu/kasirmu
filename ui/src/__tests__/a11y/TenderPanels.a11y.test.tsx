//! A11y regression tests for the tender panels.
//!
//! These three panels ARE the payment step of a restaurant sale — the cash
//! keypad, the QRIS buttons and the card-terminal capture. PaymentModal has an
//! a11y suite, but the modal's own cases never open these panels, so the
//! controls a cashier actually presses were unchecked. Each panel takes plain
//! props, so each mounts without the modal's IPC harness.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import CashTenderPanel from '@/features/sales/payment/CashTenderPanel';
import QrisTenderPanel from '@/features/sales/payment/QrisTenderPanel';
import CardTenderPanel from '@/features/sales/payment/CardTenderPanel';
import LoyaltyTenderPanel from '@/features/sales/payment/LoyaltyTenderPanel';
import SplitTenderRows, { type SplitTenderRow } from '@/features/sales/payment/SplitTenderRows';
import type { Money } from '@/types/domain';
import salesFtl from '@/locales/sales.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

// The panels name their controls through Fluent (Localized attrs), so the REAL
// bundle must be mounted: with only the helper's minimal bundle the attributes
// are never set and axe reports labels that production has.
const FTL = [sharedFtl, salesFtl];

const total = (minor: number, currency = 'IDR'): Money => ({ minor_units: minor, currency });

describe('tender panels a11y', () => {
  it('CashTenderPanel has no axe violations', async () => {
    const { container } = renderWithProviders(
      <CashTenderPanel
        tendered=""
        onTenderedChange={vi.fn()}
        total={total(50000)}
        tenderPresets={undefined}
        sufficient={false}
        change={null}
        locale="id-ID"
      />,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard: the tender field and the quick-cash keypad mounted.
    expect(container.querySelector('.payment-tendered-input')).toBeTruthy();
    expect(container.querySelectorAll('.payment-quick-cash button').length).toBeGreaterThan(0);
  });

  it('QrisTenderPanel has no axe violations', async () => {
    const { container } = renderWithProviders(
      <QrisTenderPanel
        qrisAllowed
        locale="id-ID"
        processing={false}
        autoQrPending={false}
        onQrPay={vi.fn()}
        onDynamicQrPay={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard: the two tender buttons are the panel's whole purpose.
    expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
  });

  it('CardTenderPanel has no axe violations', async () => {
    const { container } = renderWithProviders(
      <CardTenderPanel
        terminalOffered
        processing={false}
        terminalPending={false}
        autoQrPending={false}
        onTerminalPay={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('LoyaltyTenderPanel has no axe violations with a balance to redeem', async () => {
    const { container } = renderWithProviders(
      <LoyaltyTenderPanel
        loyaltyOffered
        points={1200}
        pointsWorthMinor={6000}
        currency="IDR"
        redeemPoints
        pointsToRedeem={500}
        loyaltyDiscount={2500n}
        onRedeemStart={vi.fn()}
        onPointsChange={vi.fn()}
        onRedeemCancel={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard: the redeem input and its action mounted. The panel shows
    // ONE button in this state (the cancel/apply pair is a different branch).
    expect(container.querySelector('.payment-loyalty-input')).toBeTruthy();
    expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(1);
  });

  it('SplitTenderRows has no axe violations with the split section open', async () => {
    const row: SplitTenderRow = { id: 1, method: 'cash', otherLabel: '', amountMinor: '5.00' };
    const { container } = renderWithProviders(
      <SplitTenderRows
        splitMode
        splits={[row]}
        currency="IDR"
        remainingMinor={0n}
        onSplitModeChange={vi.fn()}
        onAddSplit={vi.fn()}
        onRemoveSplit={vi.fn()}
        onUpdateSplit={vi.fn()}
        onAutoSplitEvenly={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard: a row's amount input and the "other" method radio mounted.
    expect(container.querySelectorAll('.payment-split-amount-input').length).toBeGreaterThan(0);
    expect(container.querySelector('.payment-split-other-input')).toBeTruthy();
  });
});
