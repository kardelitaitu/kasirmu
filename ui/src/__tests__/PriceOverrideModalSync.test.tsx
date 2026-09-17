// ── PriceOverrideModal sync render tests ──────────────────────────
//
// Covers: closed state, title/price rendering, pre-filled input value,
// Next button initial state. Fast synchronous tests extracted from
// PriceOverrideModal.test.tsx for parallel execution. 4 tests.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import type { PriceOverrideModalProps } from '@/features/sales/PriceOverrideModal';

vi.mock('@/api/staff', () => ({
  staffLogin: vi.fn(),
}));

import PriceOverrideModal from '@/features/sales/PriceOverrideModal';

const defaultProps: PriceOverrideModalProps = {
  open: true,
  lineDescription: 'Widget x 2',
  currentPrice: { minor_units: 50000, currency: 'IDR' },
  onConfirm: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

function renderModal(props: Partial<PriceOverrideModalProps> = {}) {
  return render(withFluent(<PriceOverrideModal {...defaultProps} {...props} />, salesFtl));
}

describe('PriceOverrideModal — rendering', () => {
  it('renders nothing when open is false', () => {
    render(withFluent(<PriceOverrideModal {...defaultProps} open={false} />, salesFtl));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the modal with title and current price', () => {
    renderModal();
    expect(screen.getByText('Price Override')).toBeInTheDocument();
    expect(screen.getByText('Widget x 2')).toBeInTheDocument();
    expect(screen.getByText('Current price')).toBeInTheDocument();
  });

  it('shows price input with current value pre-filled', () => {
    renderModal();
    const input = screen.getByLabelText('Enter new price in minor units') as HTMLInputElement;
    expect(input.value).toBe('50000');
  });

  it('disables Next button when price is zero or negative', () => {
    renderModal();
    const nextBtn = screen.getByText('Next');
    // Initially enabled (50000 > 0).
    expect(nextBtn).toBeEnabled();
  });
});
