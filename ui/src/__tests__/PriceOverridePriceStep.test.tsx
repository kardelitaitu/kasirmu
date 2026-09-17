// ── PriceOverrideModal price step tests ───────────────────────────
//
// Covers: validation edge cases on the price input step.
// Fast synchronous tests extracted from PriceOverrideKeyboardEdgeCases
// to enable parallel execution. 3 tests.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';

vi.mock('@/api/staff', () => ({
  staffLogin: vi.fn(),
}));

import PriceOverrideModal from '@/features/sales/PriceOverrideModal';
import type { PriceOverrideModalProps } from '@/features/sales/PriceOverrideModal';

const defaultProps: PriceOverrideModalProps = {
  open: true,
  lineDescription: 'Widget x 2',
  currentPrice: { minor_units: 50000, currency: 'IDR' },
  onConfirm: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

describe('PriceOverrideModal — price step', () => {
  it('disables Next when currentPrice is already zero', () => {
    render(
      withFluent(
        <PriceOverrideModal
          {...defaultProps}
          currentPrice={{ minor_units: 0, currency: 'IDR' }}
        />,
        salesFtl,
      ),
    );
    expect(screen.getByText('Next')).toBeDisabled();
  });

  it('disables Next when currentPrice is negative', () => {
    render(
      withFluent(
        <PriceOverrideModal
          {...defaultProps}
          currentPrice={{ minor_units: -1, currency: 'IDR' }}
        />,
        salesFtl,
      ),
    );
    expect(screen.getByText('Next')).toBeDisabled();
  });

  it('shows inline error with role="alert" when price is zero or negative on mount', () => {
    render(withFluent(<PriceOverrideModal {...defaultProps} currentPrice={{ minor_units: 0, currency: 'IDR' }} />, salesFtl));
    expect(screen.getByRole('alert')).toHaveTextContent(/greater than 0/i);
  });

  it('shows inline error with role="alert" when price exceeds 10x current price', () => {
    render(withFluent(<PriceOverrideModal {...defaultProps} />, salesFtl));
    const input = screen.getByLabelText('Enter new price in minor units') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '550000' } });
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByRole('alert')).toHaveTextContent(/10x|exceeds|maximum/i);
  });

  it('clears price error when user edits the price input', () => {
    render(withFluent(<PriceOverrideModal {...defaultProps} />, salesFtl));
    const input = screen.getByLabelText('Enter new price in minor units') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '550000' } });
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '50000' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('error has role="alert" for validation errors', () => {
    render(withFluent(<PriceOverrideModal {...defaultProps} currentPrice={{ minor_units: 0, currency: 'IDR' }} />, salesFtl));
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.tagName.toLowerCase()).toBe('div');
  });
});
