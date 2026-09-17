// ── PriceOverrideModal keyboard and edge-case tests ──────────────
//
// Covers: username/PIN step navigation, hardware keyboard input,
// error handling, and modal lifecycle edge cases. Uses fireEvent.click
// for navigation buttons (faster than userEvent.click) and userEvent
// only where keyboard input simulation is needed.
// 13 tests (3 fast sync price-step tests moved to PriceOverridePriceStep.test.tsx).

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// ── Navigation helpers (fireEvent.click ~1ms vs userEvent.click ~80ms) ─

function clickNext() {
  fireEvent.click(screen.getByText('Next'));
}

function clickBack() {
  fireEvent.click(screen.getByText('Back'));
}

function clickClose() {
  fireEvent.click(screen.getByText('\u00d7')); // × character
}

async function advanceToUsernameStep() {
  clickNext();
  await waitFor(() => {
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
  });
}

async function advanceToPinStep(username = 'manager') {
  await advanceToUsernameStep();
  await userEvent.type(screen.getByPlaceholderText('Username'), username);
  clickNext();
  await waitFor(() => {
    expect(screen.getByText(`Enter ${username} PIN`)).toBeInTheDocument();
  });
}

// ── Tests ─────────────────────────────────────────────────────────

describe('PriceOverrideModal — keyboard and edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffLogin.mockResolvedValue({ session: { user_id: 'user-99' } });
  });

  // ── Username step: keyboard + edge cases ────────────────────

  it('disables PIN step back button and shows status during loading', async () => {
    renderModal({ onConfirm: vi.fn().mockReturnValue(new Promise<void>(() => {})) });

    await advanceToPinStep();

    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByText(d));
    }

    await waitFor(() => {
      expect(screen.getByText('Back')).toBeDisabled();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('submits username form with Enter key and advances to PIN step', async () => {
    renderModal();

    await advanceToUsernameStep();

    await userEvent.type(screen.getByPlaceholderText('Username'), 'manager{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Enter manager PIN')).toBeInTheDocument();
    });
  });

  // ── PIN step: hardware keyboard ────────────────────────────

  it('accepts digit keys from hardware keyboard on PIN step', async () => {
    const user = userEvent.setup();
    renderModal();

    await advanceToPinStep();
    await user.keyboard('123');

    await waitFor(() => {
      const filledDots = document.querySelectorAll('.price-override-pin-dot--filled');
      expect(filledDots.length).toBe(3);
    });
  });

  it('handles Backspace key on PIN step via keyboard', async () => {
    const user = userEvent.setup();
    renderModal();

    await advanceToPinStep();

    await user.keyboard('12');
    expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(2);

    await user.keyboard('{Backspace}');
    expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(1);
  });

  it('fills PIN on the price-override-pin-step element focus', async () => {
    const user = userEvent.setup();
    renderModal();

    await advanceToPinStep();

    const pinStep = document.querySelector('.price-override-pin-step');
    expect(pinStep).toBe(document.activeElement);

    await user.keyboard('789');

    await waitFor(() => {
      const filledDots = document.querySelectorAll('.price-override-pin-dot--filled');
      expect(filledDots.length).toBe(3);
    });
  });

  // ── PIN step: Escape key (handled by focus trap) ────────────

  it('closes modal when Escape is pressed on PIN step', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await advanceToPinStep();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ── Error handling edge cases ───────────────────────────────

  it('shows error and clears PIN when onConfirm rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Server rejected override'));
    renderModal({ onConfirm });

    await advanceToPinStep();

    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByText(d));
    }

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('PIN verification failed')).toBeInTheDocument();
      expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(0);
    });
  });

  it('displays fallback error message when onConfirm rejects with non-Error', async () => {
    const onConfirm = vi.fn().mockRejectedValue('string error');
    renderModal({ onConfirm });

    await advanceToPinStep();

    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByText(d));
    }

    await waitFor(() => {
      expect(screen.getByText('PIN verification failed')).toBeInTheDocument();
    });
  });

  it('clears error when navigating back from PIN step to username step', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Override rejected'));
    renderModal({ onConfirm });

    await advanceToPinStep();

    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByText(d));
    }

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('PIN verification failed')).toBeInTheDocument();
    });

    clickBack();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────

  it('closes modal and fires onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    clickClose();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('resets price input to currentPrice on reopen after cancel', async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      withFluent(<PriceOverrideModal {...defaultProps} open={true} onClose={onClose} />, salesFtl),
    );

    const input = screen.getByLabelText('Enter new price in minor units') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75000' } });

    await waitFor(() => {
      expect(input.value).toBe('75000');
    });

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    unmount();
    render(withFluent(<PriceOverrideModal {...defaultProps} open={true} onClose={onClose} />, salesFtl));

    await waitFor(() => {
      const newInput = screen.getByLabelText('Enter new price in minor units') as HTMLInputElement;
      expect(newInput.value).toBe('50000');
    });
  });

  it('closes modal when close button clicked on username step', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    await advanceToUsernameStep();

    clickClose();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('resets PIN state when going back from PIN step to username step', async () => {
    renderModal();

    await advanceToPinStep();

    fireEvent.click(screen.getByText('1'));
    fireEvent.click(screen.getByText('2'));
    expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(2);

    clickBack();
    await waitFor(() => expect(screen.getByPlaceholderText('Username')).toBeInTheDocument());

    clickNext();
    await waitFor(() => {
      expect(screen.getByText('Enter manager PIN')).toBeInTheDocument();
      expect(document.querySelectorAll('.price-override-pin-dot--filled').length).toBe(0);
    });
  });
});

// ── CSS integrity: the keypad suppresses focus-visible, the rest of the modal does not ──
//
// Companion to the guards in StaffLoginScreen.test.tsx, SessionLockScreen.test.tsx
// and FastPINOverlay.test.tsx. Two separate facts are pinned here:
//
//   * THE WRAPPER. `.price-override-pin-step` carries tabIndex={-1} +
//     role="application" and is focused programmatically on every step change (the
//     `pinWrapRef.current?.focus()` effect in PriceOverrideModal.tsx) so its keydown
//     handler receives hardware keystrokes. Chromium matches :focus-visible for that
//     focus, so before `.price-override-pin-step:focus-visible` existed the bare
//     :focus-visible rule in themes/reset.css painted a 2px solid rgb(20,126,251) box
//     around the whole 318x160 step -- label, dots, keypad and Cancel button inside
//     it -- on simply opening the PIN prompt.
//   * THE BOUNDARY. This sheet also owns two text inputs and three buttons. The
//     ring-free decision covers the keypad only, so exactly two selectors in the
//     file may suppress an outline.
//
// focusVisibleCompliance.test.ts walks this sheet but cannot see any of it: its
// INTERACTIVE_SELECTORS match `button…`, `.btn…` and `[role="button"]`, never a
// class-prefixed `.price-override-pin-key`. JSDOM (css:false) cannot reflect the
// cascade either, hence the source read. Comments are stripped first, because the
// rationale written into the sheet quotes `outline: none` and would otherwise be
// counted as a declaration.

describe('PriceOverrideModal CSS integrity', () => {
  const css = readFileSync(
    resolve(__dirname, '..', 'features', 'sales', 'PriceOverrideModal.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  function ruleBody(selector: string): string {
    const pattern = new RegExp(
      selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}',
    );
    const match = css.match(pattern);
    expect(match, `${selector} rule must exist in PriceOverrideModal.css`).not.toBeNull();
    const body = match![1]!.trim();
    expect(body, `${selector} rule body must not be empty`).not.toHaveLength(0);
    return body;
  }

  it('suppresses the outline on the programmatically-focused PIN step wrapper', () => {
    expect(ruleBody('.price-override-pin-step:focus-visible')).toContain('outline: none');

    // Scoped, not on the base rule: `.price-override-pin-step` alone would tie the
    // global :focus-visible at (0,1,0) and survive only on sheet order -- the
    // failure mode `.session-lock-pad` used to carry.
    const base = css.match(/\.price-override-pin-step\s*\{([^}]*)\}/);
    expect(base, '.price-override-pin-step base rule must exist').not.toBeNull();
    expect(
      base![1]!,
      'the wrapper suppression must live in :focus-visible, not in the base rule',
    ).not.toMatch(/outline\s*:/);
  });

  it('gives the keys no ring but keeps their substitute cue', () => {
    const body = ruleBody('.price-override-pin-key:focus-visible');
    expect(body).toContain('outline: none');
    expect(
      body,
      'this keypad is the one PIN pad with a designed substitute cue; dropping the ' +
        'box-shadow alongside the outline would leave its keys with no keyboard feedback at all',
    ).toMatch(/box-shadow\s*:/);
  });

  it('suppresses an outline in exactly two selectors and no more', () => {
    const suppressors = (css.match(/[^{}]*\{[^{}]*\}/g) || [])
      .filter((rule) => /outline\s*:\s*none/.test(rule.slice(rule.indexOf('{') + 1)))
      .map((rule) => rule.slice(0, rule.indexOf('{')).trim())
      .sort();
    expect(suppressors).toEqual([
      '.price-override-pin-key:focus-visible',
      '.price-override-pin-step:focus-visible',
    ]);
  });

  it('keeps the modal\'s buttons ringed and its text fields unringed by nothing', () => {
    for (const selector of [
      '.price-override-close:focus-visible',
      '.price-override-cancel-btn:focus-visible',
      '.price-override-next-btn:focus-visible',
    ]) {
      expect(ruleBody(selector), `${selector} must keep its 2px outline`).toMatch(/outline:\s*2px\s+solid/);
    }

    // The two inputs declare no outline at all, so the global :focus-visible ring
    // is their cue. (Contrast .fastpin-input, whose inert class-only `outline: none`
    // claims otherwise and is documented as such.)
    for (const selector of [
      '.price-override-input',
      '.price-override-input:focus-visible',
      '.price-override-username-input',
      '.price-override-username-input:focus-visible',
    ]) {
      expect(
        ruleBody(selector),
        `${selector} must not suppress the outline -- text entry keeps its ring`,
      ).not.toMatch(/outline\s*:/);
    }
  });
});
