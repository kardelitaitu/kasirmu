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
});
