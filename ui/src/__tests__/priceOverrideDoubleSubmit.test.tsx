/**
 * @vitest-environment jsdom
 *
 * A price override must be applied ONCE per approval.
 *
 * `attemptVerify` sets `loading` but is not guarded at entry, and the Enter path
 * (`handlePinKeyDown`) checks only `pinSubmitted.current` — which is set to true in the
 * auto-submit EFFECT, i.e. after a render. Two Enter presses inside that window both saw
 * `pinSubmitted.current === false` and both ran `staffLogin` + `onConfirm`, so the new
 * price was applied twice.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import type { PriceOverrideModalProps } from '@/features/sales/PriceOverrideModal';

vi.mock('@/api/staff', () => ({ staffLogin: vi.fn() }));

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

/** Walk price -> username -> pin, leaving the modal on the PIN step. */
function reachPinStep() {
  fireEvent.click(screen.getByText('Next'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'manager' } });
  fireEvent.click(screen.getByText('Next'));
}

describe('PriceOverrideModal — a double submit must not apply the price twice', () => {
  beforeEach(() => {
    mockStaffLogin.mockReset();
    vi.mocked(defaultProps.onConfirm).mockClear();
  });

  it('does not call onConfirm twice when Enter is pressed rapidly on the PIN step', async () => {
    // A slow login keeps the first attempt in flight while the second Enter lands.
    let resolveLogin: (v: unknown) => void = () => {};
    mockStaffLogin.mockImplementation(
      () => new Promise((res) => { resolveLogin = res; }),
    );
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderModal({ onConfirm });
    reachPinStep();

    // The PIN step element carries the keydown handler (PriceOverrideModal.tsx:319).
    const pinPad = document.querySelector('.price-override-pin-step')!;
    expect(pinPad, 'the PIN step moved — re-point this guard').not.toBeNull();
    fireEvent.keyDown(pinPad, { key: '1' });
    // Two Enters with NO React flush between them — a real double-tap inside one frame,
    // which is exactly the window where `pinSubmitted.current` is still false.
    const { act } = await import('react');
    act(() => {
      pinPad.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      pinPad.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    await waitFor(() => expect(mockStaffLogin).toHaveBeenCalled());
    resolveLogin({ session: { user_id: 'u-1' } });
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());

    expect(
      mockStaffLogin.mock.calls.length,
      'a second Enter started a second login while the first was in flight',
    ).toBe(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('still submits once on a normal single Enter (control)', async () => {
    // A guard that blocks the legitimate path would be worse than the race it fixes.
    mockStaffLogin.mockResolvedValue({ session: { user_id: 'u-1' } });
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderModal({ onConfirm });
    reachPinStep();

    const pinPad = document.querySelector('.price-override-pin-step')!;
    fireEvent.keyDown(pinPad, { key: '1' });
    fireEvent.keyDown(pinPad, { key: 'Enter' });

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(mockStaffLogin).toHaveBeenCalledTimes(1);
  });

  it('allows a RETRY after a failed login (the guard is released)', async () => {
    // The finally-block must clear the ref, or a wrong PIN would lock the operator out
    // of ever retrying — a worse failure than the race the guard fixes.
    mockStaffLogin.mockRejectedValueOnce(new Error('bad pin'));
    mockStaffLogin.mockResolvedValue({ session: { user_id: 'u-1' } });
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderModal({ onConfirm });
    reachPinStep();

    const pinPad = document.querySelector('.price-override-pin-step')!;
    fireEvent.keyDown(pinPad, { key: '1' });
    fireEvent.keyDown(pinPad, { key: 'Enter' });
    await waitFor(() => expect(mockStaffLogin).toHaveBeenCalledTimes(1));

    // Second attempt after the failure: the ref must have been released.
    fireEvent.keyDown(pinPad, { key: '2' });
    fireEvent.keyDown(pinPad, { key: 'Enter' });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(mockStaffLogin).toHaveBeenCalledTimes(2);
  });
});
