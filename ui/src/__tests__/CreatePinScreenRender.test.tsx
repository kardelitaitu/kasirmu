// ── CreatePinScreen sync render tests ──────────────────────────────
//
// Covers: form field rendering and placeholder attributes.
// Fast synchronous tests extracted from CreatePinScreen.test.tsx
// for parallel execution. 2 tests.

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import CreatePinScreen from '@/features/auth/CreatePinScreen';
import sharedFtl from '@/locales/shared.ftl?raw';

// CreatePinScreen calls useAuth() + useToast() internally, so mock both.
const mockSwapSession = vi.fn();
const mockAddToast = vi.fn();

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

const onCreated = vi.fn();

function renderScreen() {
  return renderWithProvidersSync(<CreatePinScreen onCreated={onCreated} />, sharedFtl);
}

describe('CreatePinScreen — rendering', () => {
  it('renders all form fields', () => {
    renderScreen();

    expect(screen.getByLabelText('Display Name')).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByLabelText('PIN')).toBeTruthy();
    expect(screen.getByLabelText('Confirm PIN')).toBeTruthy();
  });

  it('uses placeholder attributes on inputs', () => {
    renderScreen();

    const displayName = screen.getByLabelText('Display Name') as HTMLInputElement;
    const username = screen.getByLabelText('Username') as HTMLInputElement;
    const pin = screen.getByLabelText('PIN') as HTMLInputElement;
    const confirmPin = screen.getByLabelText('Confirm PIN') as HTMLInputElement;

    expect(displayName.placeholder).toBe('Store Owner');
    expect(username.placeholder).toBe('owner');
    expect(pin.placeholder).toBe('At least 4 digits');
    expect(confirmPin.placeholder).toBe('Re-enter PIN');
  });
});
