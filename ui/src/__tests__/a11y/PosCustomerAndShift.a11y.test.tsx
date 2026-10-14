//! A11y regression tests for the POS customer badge and the shift dialogs.
//!
//! PaymentModalCustomerBadge is the customer row inside the payment modal (the
//! selected name with Change / Remove, or the Select prompt). ShiftModals holds
//! the three shift dialogs: CloseShiftConfirm, ShiftSummary and OpenShiftModal.
//! None had axe coverage, and the three dialogs are the only way a cashier
//! opens or closes a till.
//!
//! The REAL sales bundle is mounted: the badge's remove control is icon-only
//! and the dialogs name themselves from Fluent, so the minimal bundle would
//! report names production has.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import PaymentModalCustomerBadge from '@/features/sales/components/PaymentModalCustomerBadge';
import {
  CloseShiftConfirm,
  OpenShiftModal,
} from '@/features/sales/components/ShiftModals';
import salesFtl from '@/locales/sales.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { ShiftDto } from '@/api/shifts';
import type { CustomerDto } from '@/api/customers';

const FTL = [sharedFtl, salesFtl];

const STAMP = '2026-09-14T01:00:00.000Z';

const SHIFT: ShiftDto = {
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

const CUSTOMER = { id: 'cust-1', name: 'Budi Santoso' } as CustomerDto;

const exitHandle = { shouldRender: true, exiting: false, requestClose: vi.fn() };

describe('PaymentModalCustomerBadge a11y', () => {
  it('has no axe violations with a customer selected', async () => {
    const { container } = renderWithProviders(
      <PaymentModalCustomerBadge customer={CUSTOMER} onOpenSearch={vi.fn()} onRemove={vi.fn()} />,
      ...FTL,
    );
    await checkA11y(container);

    expect(container.textContent).toContain('Budi Santoso');
    // The remove control is icon-only ("×"), and axe does NOT flag it when its
    // aria-label is removed — "×" still counts as text. Pin the attribute.
    const remove = container.querySelector('.payment-customer-remove') as HTMLElement;
    expect(remove).toBeTruthy();
    expect(remove.getAttribute('aria-label')).toBeTruthy();
  });

  it('has no axe violations with no customer (the prompt state)', async () => {
    const { container } = renderWithProviders(
      <PaymentModalCustomerBadge customer={null} onOpenSearch={vi.fn()} onRemove={vi.fn()} />,
      ...FTL,
    );
    await checkA11y(container);

    expect(container.querySelector('.payment-customer-select-btn')).toBeTruthy();
  });
});

describe('Shift dialogs a11y', () => {
  it('CloseShiftConfirm has no axe violations', async () => {
    const { container } = renderWithProviders(
      <CloseShiftConfirm
        closeShiftExit={exitHandle as never}
        activeShift={SHIFT}
        closeShiftError={null}
        setCloseShiftError={vi.fn()}
        closingBalance="150000"
        setClosingBalance={vi.fn()}
        shiftNotes=""
        setShiftNotes={vi.fn()}
        closingShift={false}
        setShowCloseShift={vi.fn()}
        handleConfirmCloseShift={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute('aria-label')).toBeTruthy();
    // Both fields are named AND placeholder-free, so the label is the only name
    // source — worth pinning because the minimal bundle case taught that lesson.
    for (const sel of ['#closing-balance', '#shift-notes']) {
      const el = container.querySelector(sel) as HTMLElement;
      expect(el, sel).toBeTruthy();
      expect(el.getAttribute('aria-label'), sel).toBeTruthy();
    }
  });

  it('CloseShiftConfirm with an inline error has no axe violations', async () => {
    const { container } = renderWithProviders(
      <CloseShiftConfirm
        closeShiftExit={exitHandle as never}
        activeShift={SHIFT}
        closeShiftError="Drawer count is required"
        setCloseShiftError={vi.fn()}
        closingBalance=""
        setClosingBalance={vi.fn()}
        shiftNotes=""
        setShiftNotes={vi.fn()}
        closingShift={false}
        setShowCloseShift={vi.fn()}
        handleConfirmCloseShift={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);
    expect(container.textContent).toContain('Drawer count is required');
  });

  it('OpenShiftModal has no axe violations', async () => {
    const { container } = renderWithProviders(
      <OpenShiftModal
        openShiftExit={exitHandle as never}
        openingBalance="100000"
        setOpeningBalance={vi.fn()}
        openingShift={false}
        handleConfirmOpenShift={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute('aria-label')).toBeTruthy();
    const field = container.querySelector('#opening-balance') as HTMLElement;
    expect(field).toBeTruthy();
    expect(field.getAttribute('aria-label')).toBeTruthy();
  });
});
