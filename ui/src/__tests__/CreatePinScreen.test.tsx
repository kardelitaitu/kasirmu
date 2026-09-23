// ── CreatePinScreen interaction tests ──────────────────────────────
//
// Covers: form validation, API interaction, form input behavior.
// Uses fireEvent.change for form fields (saves ~20ms/char vs
// userEvent.type — the component only reads values on submit)
// and fireEvent.click for the submit button.
// 10 tests (2 sync render tests moved to CreatePinScreenRender.test.tsx).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import CreatePinScreen from '@/features/auth/CreatePinScreen';
import sharedFtl from '@/locales/shared.ftl?raw';

const mockBootstrapOwner = vi.fn();
const mockSwapSession = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/api/staff', () => ({
  bootstrapOwner: (...args: unknown[]) => mockBootstrapOwner(...args),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: null,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    swapSession: (...args: unknown[]) => mockSwapSession(...args),
  }),
}));

vi.mock('@/components/Toast', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@/components/Toast')>();
  return {
    ...actual,
    useToast: () => ({ addToast: (...args: unknown[]) => mockAddToast(...args) }),
  };
});

beforeEach(() => {
  mockBootstrapOwner.mockReset();
  mockSwapSession.mockReset();
  mockAddToast.mockReset();
});

const onCreated = vi.fn();

function renderScreen() {
  return renderWithProvidersSync(<CreatePinScreen onCreated={onCreated} />, sharedFtl);
}

// ── Field helpers (fireEvent.change ~1ms vs userEvent.type ~20ms/char) ─

function fillField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillAllFields(overrides: Partial<Record<string, string>> = {}) {
  fillField('Display Name', overrides['Display Name'] ?? 'Store Owner');
  fillField('Username', overrides['Username'] ?? 'admin');
  fillField('PIN', overrides['PIN'] ?? '1234');
  fillField('Confirm PIN', overrides['Confirm PIN'] ?? '1234');
}

function clickSubmit() {
  fireEvent.click(screen.getByRole('button', { name: /create owner account/i }));
}

// ── Field-scoped invalid marks ──────────────────────────────────────
//
// The banner names the RULE ("All fields are required") but never said which
// input broke it, and no input carried aria-invalid — so a screen-reader user
// got a message with no control attached to it.

describe('CreatePinScreen — a rejected submit marks the offending fields', () => {
  it('marks only the empty field when one is missing', () => {
    renderScreen();
    fillField('Display Name', '   '); // the only empty one
    fillField('Username', 'owner');
    fillField('PIN', '1234');
    fillField('Confirm PIN', '1234');
    clickSubmit();

    expect(screen.getByLabelText('Display Name')).toHaveAttribute('aria-invalid', 'true');
    // The fields that were fine must NOT be accused.
    expect(screen.getByLabelText('Username')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('PIN')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Confirm PIN')).not.toHaveAttribute('aria-invalid');
  });

  it('marks every empty field when several are missing', () => {
    renderScreen();
    fillField('Display Name', '   ');
    fillField('Username', '   ');
    fillField('PIN', '   ');
    fillField('Confirm PIN', '1234');
    clickSubmit();

    expect(screen.getByLabelText('Display Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('PIN')).toHaveAttribute('aria-invalid', 'true');
  });

  it('marks both PIN fields on a mismatch, since either could be the typo', () => {
    renderScreen();
    fillAllFields({ 'Confirm PIN': '9999' });
    clickSubmit();

    expect(screen.getByLabelText('PIN')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Confirm PIN')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Display Name')).not.toHaveAttribute('aria-invalid');
  });

  it('drops a field mark as soon as the user edits it', () => {
    // A mark that outlives the failure tells a user their corrected value is
    // still wrong; nothing re-runs validation on its own.
    renderScreen();
    fillAllFields({ 'Confirm PIN': '9999' });
    clickSubmit();
    const pin = screen.getByLabelText('PIN');
    const confirm = screen.getByLabelText('Confirm PIN');
    expect(pin).toHaveAttribute('aria-invalid', 'true');

    fillField('Confirm PIN', '1234');

    expect(confirm).not.toHaveAttribute('aria-invalid');
    // Editing one field clears only its own mark.
    fillAllFields({ 'Confirm PIN': '9999' });
    clickSubmit();
    fillField('PIN', '4321');
    expect(pin).not.toHaveAttribute('aria-invalid');
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
  });
});
describe('CreatePinScreen', () => {
  describe('validation', () => {
    it('shows error when all fields are whitespace-only', () => {
      renderScreen();

      fillField('Display Name', '   ');
      fillField('Username', '   ');
      fillField('PIN', '    ');
      fillField('Confirm PIN', '    ');
      clickSubmit();

      expect(screen.getByRole('alert')).toHaveTextContent('All fields are required.');
    });

    it('shows error when display name is whitespace-only', () => {
      renderScreen();

      fillField('Display Name', '   ');
      fillField('Username', 'owner');
      fillField('PIN', '1234');
      fillField('Confirm PIN', '1234');
      clickSubmit();

      expect(screen.getByRole('alert')).toHaveTextContent('All fields are required.');
    });

    it('shows error when PIN is too short', () => {
      renderScreen();

      fillField('Display Name', 'Owner');
      fillField('Username', 'owner');
      fillField('PIN', '12');
      fillField('Confirm PIN', '12');
      clickSubmit();

      expect(screen.getByRole('alert')).toHaveTextContent('PIN must be at least 4 characters.');
    });

    it('shows error when PINs do not match', () => {
      renderScreen();

      fillField('Display Name', 'Owner');
      fillField('Username', 'owner');
      fillField('PIN', '1234');
      fillField('Confirm PIN', '5678');
      clickSubmit();

      expect(screen.getByRole('alert')).toHaveTextContent('PINs do not match.');
    });
  });

  describe('API interaction', () => {
    it('calls bootstrapOwner on submit and navigates on success', async () => {
      mockBootstrapOwner.mockResolvedValue({
        session: { user_id: 'owner-1', display_name: 'Owner', role_name: 'owner', role_id: 'role-owner' },
        picker_ticket: 'ticket-boot',
      });

      renderScreen();
      fillAllFields();
      clickSubmit();

      await waitFor(() => {
        expect(mockBootstrapOwner).toHaveBeenCalledWith({
          username: 'admin',
          pin: '1234',
          display_name: 'Store Owner',
        });
      });

      expect(mockSwapSession).toHaveBeenCalledWith(
        {
          user_id: 'owner-1', display_name: 'Owner', role_name: 'owner', role_id: 'role-owner',
        },
        'ticket-boot',
      );
      expect(mockAddToast).toHaveBeenCalled();
      expect(onCreated).toHaveBeenCalled();
    });

    it('navigates on "already exist" error', async () => {
      mockBootstrapOwner.mockRejectedValue(new Error('Staff already exist'));

      renderScreen();
      fillAllFields();
      clickSubmit();

      await waitFor(() => {
        expect(onCreated).toHaveBeenCalled();
      });
    });

    it('displays error message on API failure', async () => {
      mockBootstrapOwner.mockRejectedValue(new Error('Network error'));

      renderScreen();
      fillAllFields();
      clickSubmit();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('An error occurred while creating the owner account.');
      });
    });

    it('handles string rejection', async () => {
      mockBootstrapOwner.mockRejectedValue('string error');

      renderScreen();
      fillAllFields();
      clickSubmit();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('An error occurred while creating the owner account.');
      });
    });
  });

  describe('form inputs', () => {
    it('disables inputs while loading', async () => {
      mockBootstrapOwner.mockImplementation(() => new Promise(() => {}));

      renderScreen();
      fillAllFields();
      clickSubmit();

      await waitFor(() => {
        expect(screen.getByLabelText('Display Name')).toBeDisabled();
        expect(screen.getByLabelText('Username')).toBeDisabled();
        expect(screen.getByLabelText('PIN')).toBeDisabled();
        expect(screen.getByLabelText('Confirm PIN')).toBeDisabled();
      });
    });

    it('converts username to lowercase', () => {
      renderScreen();

      const input = screen.getByLabelText('Username') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'ADMIN' } });

      expect(input.value).toBe('admin');
    });
  });

  // ── PIN security: strip non-digits and enforce max length ─────────

  describe('PIN security', () => {
    it('strips non-digit characters from PIN on submit', async () => {
      // CreatePinScreen accepts letters in the PIN field via paste.
      // Non-digits are stripped on submit (cleaning pass), then the
      // second submit proceeds with the cleaned digits.
      mockBootstrapOwner.mockResolvedValue({
        session: { user_id: 'owner-1', display_name: 'Owner', role_name: 'owner', role_id: 'role-owner' },
        picker_ticket: 'ticket-boot',
      });
      renderScreen();

      fillField('Display Name', 'Owner');
      fillField('Username', 'owner');
      fillField('PIN', 'abcd1234');
      fillField('Confirm PIN', '1234');

      // First submit: digits stripped, PIN cleaned to '1234', early return.
      clickSubmit();
      // Second submit: cleaned PIN passes validation, calls bootstrapOwner.
      clickSubmit();

      await waitFor(() => {
        expect(mockBootstrapOwner).toHaveBeenCalledWith(
          expect.objectContaining({ pin: '1234' }),
        );
      });
    });

    it('truncates PIN to 8 digits on submit', async () => {
      mockBootstrapOwner.mockResolvedValue({
        session: { user_id: 'owner-1', display_name: 'Owner', role_name: 'owner', role_id: 'role-owner' },
        picker_ticket: 'ticket-boot',
      });
      renderScreen();

      fillField('Display Name', 'Owner');
      fillField('Username', 'owner');
      fillField('PIN', '123456789');
      fillField('Confirm PIN', '123456789');

      // First submit: truncated to 8 digits, early return.
      clickSubmit();
      // Second submit: truncated PIN passes validation.
      clickSubmit();

      await waitFor(() => {
        expect(mockBootstrapOwner).toHaveBeenCalledWith(
          expect.objectContaining({ pin: '12345678' }),
        );
      });
    });
  });
});
