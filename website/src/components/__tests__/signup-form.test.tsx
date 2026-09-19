// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { labelMap } from '../../i18n';

// React 19 requires the act environment flag for async act() to work.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * SignupForm tests — covers the registration flow, resend cooldown with
 * i18n keys, region selector with localStorage persistence, email
 * validation, session storage handling, and the not-configured state.
 */

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status: number; json: () => Promise<unknown> }): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init?: RequestInit) => handler(url, init)));
}

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function badRequest(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

async function renderSignupForm(locale: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { default: SignupForm, SIGNUP_FORM_LABELS } = await import('../SignupForm');
  act(() => {
    root.render(<SignupForm locale={locale} labels={labelMap(locale, SIGNUP_FORM_LABELS)} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return { container, root };
}

function setEmail(container: HTMLElement, value: string): void {
  const el = container.querySelector('input[type="email"]') as HTMLInputElement | null;
  if (!el) throw new Error('email input not found');
  act(() => {
    Object.defineProperty(el, 'value', { value, configurable: true, writable: true });
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setPassword(container: HTMLElement, value: string): void {
  const el = container.querySelector('input[type="password"]') as HTMLInputElement | null;
  if (!el) throw new Error('password input not found');
  act(() => {
    Object.defineProperty(el, 'value', { value, configurable: true, writable: true });
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setConfirmPassword(container: HTMLElement, value: string): void {
  const el = container.querySelectorAll('input[type="password"]')[1] as HTMLInputElement | undefined;
  if (!el) throw new Error('confirm password input not found');
  act(() => {
    Object.defineProperty(el, 'value', { value, configurable: true, writable: true });
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setCode(container: HTMLElement, value: string): void {
  const el = container.querySelector('input[inputmode="numeric"]') as HTMLInputElement | null;
  if (!el) throw new Error('code input not found');
  act(() => {
    Object.defineProperty(el, 'value', { value, configurable: true, writable: true });
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clickSubmit(container: HTMLElement): void {
  const btn = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
  if (!btn) throw new Error('submit button not found');
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function clickButton(container: HTMLElement, text: string): void {
  const buttons = Array.from(container.querySelectorAll('button'));
  const btn = buttons.find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button with text "${text}" not found`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function assertText(container: HTMLElement, text: string): void {
  expect(container.textContent).toContain(text);
}

function assertNoText(container: HTMLElement, text: string): void {
  expect(container.textContent).not.toContain(text);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const env = import.meta.env as Record<string, unknown>;
  env.PUBLIC_LICENSE_API_URL = 'https://license.test';
  sessionStorage.clear();
  localStorage.clear();
  window.__OZ_CONFIG__ = { licenseApiUrl: 'https://license.test' };
  mockFetch(() => okJson({ ok: true }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ── Registration flow ─────────────────────────────────────────────────

describe('SignupForm — registration flow', () => {
  it('sends registration and advances to code step', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'alice@example.com');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      assertText(container, 'We sent a verification code');
      assertText(container, 'Use a different email');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows "account exists" error on 409 response', async () => {
    mockFetch(() => badRequest(409));
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'existing@example.com');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      assertText(container, 'An account with this email already exists');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('stores session after successful verify', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'alice@example.com');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      mockFetch((url) => {
        if (url.includes('verify-otp')) return okJson({ token: 'tok-signup-001' });
        return okJson({ ok: true });
      });
      setCode(container, '123456');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(sessionStorage.getItem('oz_session')).toBe('tok-signup-001');
      expect(sessionStorage.getItem('oz_email')).toBe('alice@example.com');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Resend OTP cooldown ───────────────────────────────────────────────

describe('SignupForm — resend OTP cooldown', () => {
  it('shows countdown after OTP is sent', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'alice@example.com');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      const resendBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Resend code',
      );
      expect(resendBtn).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      assertText(container, 'Resend code in');
      const resendBtnAfter = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Resend code',
      );
      expect(resendBtnAfter).toBeUndefined();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('uses i18n keys for countdown text and resend button', async () => {
    const { container, root } = await renderSignupForm('id');
    try {
      setEmail(container, 'budi@example.com');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      const resendBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Kirim ulang kode',
      );
      expect(resendBtn).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      assertText(container, 'Kirim ulang kode dalam');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('resend button reappears after cooldown expires', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'alice@example.com');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Advance past the full 120s cooldown.
      await act(async () => {
        vi.advanceTimersByTime(121000);
      });
      // Resend button should be visible again.
      const resendBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Resend code',
      );
      expect(resendBtn).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Region selector ───────────────────────────────────────────────────

describe('SignupForm — region selector', () => {
  it('defaults to Global and persists selection to localStorage', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      // Open the dropdown.
      const regionBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Global',
      );
      expect(regionBtn).not.toBeNull();
      act(() => {
        regionBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Click Indonesia option.
      const idOption = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Indonesia',
      );
      expect(idOption).not.toBeNull();
      act(() => {
        idOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(localStorage.getItem('oz_region')).toBe('id');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('reads saved region from localStorage on mount', async () => {
    localStorage.setItem('oz_region', 'id');
    const { container, root } = await renderSignupForm('en');
    try {
      assertText(container, 'Indonesia');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('persists region in localStorage after successful registration', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      // Select Indonesia.
      const regionBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Global',
      );
      act(() => {
        regionBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      const idOption = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Indonesia',
      );
      act(() => {
        idOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Register and verify.
      setEmail(container, 'alice@example.com');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      mockFetch((url) => {
        if (url.includes('verify-otp')) return okJson({ token: 'tok-region-001' });
        return okJson({ ok: true });
      });
      setCode(container, '123456');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(localStorage.getItem('oz_region')).toBe('id');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Email validation ──────────────────────────────────────────────────

describe('SignupForm — email validation', () => {
  it('shows checkmark icon for valid email', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'valid@example.com');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      const checkmark = container.querySelector('[aria-label="Valid email"]');
      expect(checkmark).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('does not show checkmark for invalid email', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'not-an-email');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      const checkmark = container.querySelector('[aria-label="Valid email"]');
      expect(checkmark).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('disables submit button for invalid email', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'bad');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      const btn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Not-configured state ──────────────────────────────────────────────

describe('SignupForm — not-configured state', () => {
  it('shows not-configured notice when API URL is absent after mount', async () => {
    const env = import.meta.env as Record<string, unknown>;
    env.PUBLIC_LICENSE_API_URL = '';
    window.__OZ_CONFIG__ = undefined;
    const { container, root } = await renderSignupForm('en');
    try {
      assertText(container, 'The auth API is not configured on this deployment.');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Back to email step ────────────────────────────────────────────────

describe('SignupForm — navigation', () => {
  it('returns to form step on "Use a different email" click', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      setEmail(container, 'alice@example.com');
      setPassword(container, 'Str0ngP@ss');
      setConfirmPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      assertText(container, 'We sent a verification code');
      clickButton(container, 'Use a different email');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Should be back at the form: Create account button visible.
      assertText(container, 'Create account');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Regression: input background colour ──────────────────────────────
// Ensures inputs never use bg-primary (brand blue) as their background.
// Root cause: SignupForm.tsx INPUT_CLASS had bg-primary instead of bg-surface,
// turning every text input into a solid blue box (fixed in dda27e89).

describe('SignupForm — input field styling regression', () => {
  it('email input does not have a blue (bg-primary) background', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement | null;
      expect(emailInput, 'email input should be rendered').not.toBeNull();
      expect(emailInput!.className).not.toContain('bg-primary');
      expect(emailInput!.className).toContain('bg-surface');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('password input does not have a blue (bg-primary) background', async () => {
    const { container, root } = await renderSignupForm('en');
    try {
      const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(passwordInput, 'password input should be rendered').not.toBeNull();
      expect(passwordInput!.className).not.toContain('bg-primary');
      expect(passwordInput!.className).toContain('bg-surface');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
