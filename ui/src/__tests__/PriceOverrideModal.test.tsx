// ── PriceOverrideModal interaction tests ──────────────────────────
//
// Covers: price step navigation, username/PIN flow, PIN digit entry,
// error handling, loading state.
// Uses fireEvent for navigation clicks (Next, Back, Cancel, digit keys,
// Clear, ⌫) and fireEvent.change for username form field.
// 11 tests (4 sync render tests moved to PriceOverrideModalSync.test.tsx).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import type { PriceOverrideModalProps } from '@/features/sales/PriceOverrideModal';

vi.mock('@/api/staff', () => ({
  staffLogin: vi.fn(),
}));

import PriceOverrideModal from '@/features/sales/PriceOverrideModal';
import { staffLogin } from '@/api/staff';

const mockStaffLogin = staffLogin as ReturnType<typeof vi.fn>;

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

// ── Navigation helpers (fireEvent ~1ms vs userEvent ~60ms) ────────

function clickNext() {
  fireEvent.click(screen.getByText('Next'));
}

function clickBack() {
  fireEvent.click(screen.getByText('Back'));
}

function clickCancel() {
  fireEvent.click(screen.getByText('Cancel'));
}

function typeUsername(value: string) {
  const input = screen.getByPlaceholderText('Username');
  fireEvent.change(input, { target: { value } });
}

function typePin(digits: string) {
  for (const d of digits) {
    fireEvent.click(screen.getByText(d));
  }
}

/** Navigate from price step → username step → PIN step. */
function advanceToPinStep(username = 'manager') {
  clickNext();                                           // price → username
  const input = screen.getByPlaceholderText('Username'); // sync after fireEvent.click
  expect(input).toBeInTheDocument();
  typeUsername(username);
  clickNext();                                           // username → PIN (form submit)
  expect(screen.getByText('Enter manager PIN')).toBeInTheDocument(); // sync
}

describe('PriceOverrideModal', () => {
  // ── Price step navigation ──────────────────────────────────────

  it('closes modal when Cancel is clicked on price step', async () => {
    renderModal();
    clickCancel();
    // handleClose uses setTimeout(ANIM_MS), so onClose fires after the timer.
    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('advances to username step when Next is clicked with valid price', () => {
    renderModal();
    clickNext();
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByText('Enter manager username')).toBeInTheDocument();
  });

  it('disables username Next when username is empty', () => {
    renderModal();
    clickNext();
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();

    const nextBtns = screen.getAllByText('Next');
    expect(nextBtns[nextBtns.length - 1]).toBeDisabled();
  });

  it('goes back to price step when Back is clicked', () => {
    renderModal();
    clickNext();
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();

    clickBack();
    expect(screen.getByText('Current price')).toBeInTheDocument();
  });

  // ── PIN step ───────────────────────────────────────────────────

  it('advances to PIN step after entering username', () => {
    renderModal();
    advanceToPinStep();
  });

  it('fills PIN dots when digits are pressed', () => {
    renderModal();
    advanceToPinStep();
    typePin('123');

    const filledDots = document.querySelectorAll('.price-override-pin-dot--filled');
    expect(filledDots.length).toBe(3);
  });

  it('calls onConfirm when PIN reaches 4 digits and login succeeds', async () => {
    mockStaffLogin.mockResolvedValue({ session: { user_id: 'user-99' } });
    renderModal();
    advanceToPinStep();
    typePin('1234');

    await waitFor(() => {
      expect(mockStaffLogin).toHaveBeenCalledWith({ username: 'manager', pin: '1234' });
      expect(defaultProps.onConfirm).toHaveBeenCalledWith(50000, 'user-99');
    });
  });

  it('shows error when PIN login fails', async () => {
    mockStaffLogin.mockRejectedValue(new Error('Invalid PIN'));
    renderModal();
    advanceToPinStep();
    typePin('1234');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('PIN verification failed')).toBeInTheDocument();
    });
  });

  it('clears PIN with Clear button', () => {
    renderModal();
    advanceToPinStep();
    typePin('12');
    expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(2);

    fireEvent.click(screen.getByText('Clear'));
    expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(0);
  });

  it('removes last digit with backspace', () => {
    renderModal();
    advanceToPinStep();
    typePin('12');
    expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: /backspace/i }));
    expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(1);
  });

  it('shows verifying status while login is in progress', async () => {
    mockStaffLogin.mockReturnValue(new Promise(() => {})); // never resolves
    renderModal();
    advanceToPinStep();
    typePin('123456');

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Verifying\u2026')).toBeInTheDocument(); // \u2026 = …
    });
  });
});
