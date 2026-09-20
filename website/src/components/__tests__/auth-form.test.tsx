// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { labelMap } from '../../i18n';

// React 19 requires the act environment flag for async act() to work.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * AuthForm tests — covers the OTP login flow, resend cooldown with i18n keys,
 * password login, forgot-password flow, open-redirect guard, session storage
 * handling, and the not-configured state.
 *
 * The component calls licenseApiUrl() at the top of the function body (moved
 * from module scope in 6c6a2737 for hydration correctness).
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

async function renderAuthForm(locale: string, oauthReason?: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { default: AuthForm, AUTH_FORM_LABELS } = await import('../AuthForm');
  act(() => {
    root.render(<AuthForm locale={locale} labels={labelMap(locale, AUTH_FORM_LABELS)} oauthReason={oauthReason} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return { container, root };
}

function setText(container: HTMLElement, testId: string, value: string): void {
  const el = container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | null;
  if (!el) throw new Error(`[data-testid="${testId}"] not found`);
  act(() => {
    Object.defineProperty(el, 'value', { value, configurable: true, writable: true });
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setEmail(container: HTMLElement, value: string): void {
  const el = container.querySelector('input[type="email"]') as HTMLInputElement | null;
  if (!el) throw new Error('email input not found');
  act(() => {
    Object.defineProperty(el, 'value', { value, configurable: true, writable: true });
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setPassword(container: HTMLElement, value: string): void {
  const inputs = container.querySelectorAll('input[type="password"]');
  const el = inputs[0] as HTMLInputElement | undefined;
  if (!el) throw new Error('password input not found');
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
  // Simulate hydration: window.__OZ_CONFIG__ is available.
  window.__OZ_CONFIG__ = { licenseApiUrl: 'https://license.test' };
  // Default: successful request-otp.
  mockFetch(() => okJson({ ok: true }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ── OTP login flow ────────────────────────────────────────────────────

describe('AuthForm — OTP login flow', () => {
  it('sends OTP on email submit and advances to code step', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      // Title is in aria-label, not textContent — check visible tab labels instead.
      assertText(container, 'Email code');
      assertText(container, 'Password');
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Code step: verify input and back button visible.
      assertText(container, 'Verification code');
      assertText(container, 'Use a different email');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('stores session and cached email after OTP verify', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Switch fetch mock to return a token on verify-otp.
      mockFetch((url) => {
        if (url.includes('verify-otp')) return okJson({ token: 'tok-otp-001' });
        return okJson({ ok: true });
      });
      setCode(container, '123456');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(sessionStorage.getItem('oz_session')).toBe('tok-otp-001');
      expect(sessionStorage.getItem('oz_email')).toBe('alice@example.com');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows error on OTP request failure', async () => {
    mockFetch(() => badRequest(500));
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      assertText(container, "Couldn't send the code. Please try again later.");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows error on OTP verify failure', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      mockFetch(() => badRequest(401));
      setCode(container, '999999');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      assertText(container, 'Invalid or expired code. Please try again.');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Resend OTP cooldown ───────────────────────────────────────────────

describe('AuthForm — resend OTP cooldown', () => {
  it('shows countdown after OTP is sent and hides resend button', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Resend button is visible immediately (cooldown = 0).
      const resendBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Resend code',
      );
      expect(resendBtn).not.toBeNull();
      // After OTP was sent, the cooldown starts. Advance 1 second.
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      // Countdown text appears, resend button disappears.
      assertText(container, 'Resend code in');
      assertText(container, 's');
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
    const { container, root } = await renderAuthForm('id');
    try {
      setEmail(container, 'budi@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Indonesian "Resend code" key.
      const resendBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Kirim ulang kode',
      );
      expect(resendBtn).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      // Indonesian countdown key.
      assertText(container, 'Kirim ulang kode dalam');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('countdown decreases each second', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      assertText(container, 'Resend code in');
      // Should display ~118 seconds remaining.
      expect(container.textContent).toContain('118s');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Password login ────────────────────────────────────────────────────

describe('AuthForm — password login', () => {
  it('logs in via password tab and sets session', async () => {
    mockFetch((url) => {
      if (url.includes('login')) return okJson({ token: 'tok-pw-001' });
      return okJson({ ok: true });
    });
    const { container, root } = await renderAuthForm('en');
    try {
      // Switch to password tab.
      clickButton(container, 'Password');
      setEmail(container, 'bob@example.com');
      setPassword(container, 'Str0ngP@ss');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(sessionStorage.getItem('oz_session')).toBe('tok-pw-001');
      expect(sessionStorage.getItem('oz_email')).toBe('bob@example.com');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows error on password login failure', async () => {
    mockFetch(() => badRequest(401));
    const { container, root } = await renderAuthForm('en');
    try {
      clickButton(container, 'Password');
      setEmail(container, 'bob@example.com');
      setPassword(container, 'wrongpassword');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      assertText(container, 'Invalid email or password.');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Forgot password flow ──────────────────────────────────────────────

describe('AuthForm — forgot password flow', () => {
  it('opens reset view on forgot password click', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      clickButton(container, 'Password');
      clickButton(container, 'Forgot password?');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // 'Reset password' is in aria-label, not textContent — check visible button.
      assertText(container, 'Send reset code');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('sends reset code and advances to code step', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      clickButton(container, 'Password');
      clickButton(container, 'Forgot password?');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      setEmail(container, 'reset@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      assertText(container, 'We sent a reset code to your email');
      assertText(container, 'New password');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('submits reset password and sets session', async () => {
    mockFetch((url) => {
      if (url.includes('reset-password')) return okJson({ token: 'tok-reset-001' });
      return okJson({ ok: true });
    });
    const { container, root } = await renderAuthForm('en');
    try {
      clickButton(container, 'Password');
      clickButton(container, 'Forgot password?');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      setEmail(container, 'reset@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      setCode(container, '654321');
      setPassword(container, 'N3wP@ssword');
      // Fill confirm field.
      const confirmInput = container.querySelectorAll('input[type="password"]')[1] as HTMLInputElement;
      if (confirmInput) {
        act(() => {
          Object.defineProperty(confirmInput, 'value', { value: 'N3wP@ssword', configurable: true });
          confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(sessionStorage.getItem('oz_session')).toBe('tok-reset-001');
      expect(sessionStorage.getItem('oz_email')).toBe('reset@example.com');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Open redirect guard ───────────────────────────────────────────────

describe('AuthForm — Google failure reasons', () => {
  it('shows the sentence that matches the reason the server sent', async () => {
    // A Google failure is a navigation, so the login page is where the user learns what
    // happened; an unknown token must still get the generic sentence rather than a blank.
    const { container } = await renderAuthForm('en', 'state');
    expect(container.textContent).toContain('expired or was already used');
  });

  it('shows the refusal sentence for a refused address and nothing when there is no reason', async () => {
    const refused = await renderAuthForm('en', 'unverified');
    expect(refused.container.textContent).toContain('cannot be used for this account');

    const plain = await renderAuthForm('en');
    expect(plain.container.querySelector('[role="alert"]')).toBeNull();

    // An unknown token must still say something: ADR #54's note claims it renders `failed`
    // rather than a blank, so the claim gets a test instead of a reader's trust.
    const unknown = await renderAuthForm('en', 'something-new-from-the-server');
    expect(unknown.container.textContent).toContain('could not be completed');
  });
});

describe('AuthForm — Google sign-in entry', () => {
  it('offers Continue with Google, pointing at the licence host start route', async () => {
    // The button is the visible half of ADR #54's web flow: it must reach the
    // SERVER route, which is what mints state and PKCE before touching Google.
    const { container } = await renderAuthForm('en');
    const link = container.querySelector('a[href*="/api/v1/web/oauth/google/start"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(
      'https://license.test/api/v1/web/oauth/google/start?next=/en/account',
    );
    expect(link?.textContent).toContain('Continue with Google');
    // An anchor, never a cross-origin form: the Worker CSP sets form-action 'self'.
    expect(container.querySelector('form[action]')).toBeNull();
  });

});

describe('AuthForm — open redirect guard', () => {
  it('blocks external URLs in ?next= and defaults to account page', async () => {
    mockFetch((url) => {
      if (url.includes('verify-otp')) return okJson({ token: 'tok-redirect-001' });
      return okJson({ ok: true });
    });
    const originalHref = window.location.href;
    // jsdom's location.href setter doesn't work; we need to define it.
    let capturedHref = originalHref;
    Object.defineProperty(window, 'location', {
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
        search: '?next=https://evil.com/steal',
        pathname: '/en/login',
      },
      writable: true,
    });
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      setCode(container, '123456');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      // Should redirect to /en/account, not the external URL.
      expect(capturedHref).toBe('/en/account');
    } finally {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, 'location', { value: { href: originalHref, search: '', pathname: '/en/login' }, writable: true });
    }
  });

  it('allows same-site paths in ?next=', async () => {
    mockFetch((url) => {
      if (url.includes('verify-otp')) return okJson({ token: 'tok-next-002' });
      return okJson({ ok: true });
    });
    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
        search: '?next=/en/pricing',
        pathname: '/en/login',
      },
      writable: true,
    });
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      setCode(container, '123456');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(capturedHref).toBe('/en/pricing');
    } finally {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, 'location', { value: { href: '', search: '', pathname: '/en/login' }, writable: true });
    }
  });

  it('exchanges the session for a one-time code on ?redirect= to the dashboard', async () => {
    // Hardening F1 dashboard gate: after auth, ?redirect=https://dashboard…
    // must exchange the JWT for a short-lived code via /exchange-issue and
    // redirect with ?code= — the real token never appears in the URL.
    let exchangeCalled = false;
    mockFetch((url, init) => {
      if (url.includes('verify-otp')) return okJson({ token: 'tok-dash-001' });
      if (url.includes('exchange-issue')) {
        exchangeCalled = true;
        expect(init?.headers).toBeDefined();
        return okJson({ code: 'one-time-code-123' });
      }
      return okJson({ ok: true });
    });
    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
        search: '?redirect=https://dashboard.kasir.mu/settings',
        pathname: '/en/login',
      },
      writable: true,
    });
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      setCode(container, '123456');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(exchangeCalled).toBe(true);
      expect(capturedHref).toContain('https://dashboard.kasir.mu/settings');
      expect(capturedHref).toContain('code=one-time-code-123');
      expect(capturedHref).not.toContain('token=');
    } finally {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, 'location', { value: { href: '', search: '', pathname: '/en/login' }, writable: true });
    }
  });

  it('lands on the clean dashboard URL when the exchange fails (no token in URL)', async () => {
    // WEB-1: if /exchange-issue errors (or returns no code), the user is
    // never stranded, but the removed `?token=` fallback must not come
    // back — the Worker no longer consumes `?token=`, so putting the JWT
    // in the URL would only leak it into browser history and Referer.
    // The clean URL makes the Worker's no-cookie gate send the user to
    // the subdomain login page instead.
    mockFetch((url) => {
      if (url.includes('verify-otp')) return okJson({ token: 'tok-dash-002' });
      if (url.includes('exchange-issue')) return badRequest(500);
      return okJson({ ok: true });
    });
    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
        search: '?redirect=https://dashboard.kasir.mu/',
        pathname: '/en/login',
      },
      writable: true,
    });
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      setCode(container, '123456');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(capturedHref).toContain('https://dashboard.kasir.mu/');
      expect(capturedHref).not.toContain('token=');
      expect(capturedHref).not.toContain('code=');
    } finally {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, 'location', { value: { href: '', search: '', pathname: '/en/login' }, writable: true });
    }
  });

  it('blocks ?redirect= to a non-dashboard host (host allowlist)', async () => {
    // The hostname allowlist (dashboard/admin.kasir.mu) is the
    // open-redirect guard for the dashboard gate — an external host must
    // fall through to the plain next/account handling. R1 (httpOnly cookie
    // migration): the account-portal target still exchanges the token for a
    // one-time code so the Worker can set the session cookie — but the
    // redirect must NEVER leave the same origin.
    let exchangeCalled = false;
    mockFetch((url) => {
      if (url.includes('verify-otp')) return okJson({ token: 'tok-dash-003' });
      if (url.includes('exchange-issue')) { exchangeCalled = true; return okJson({ code: 'x' }); }
      return okJson({ ok: true });
    });
    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
        search: '?redirect=https://evil.example.com/steal',
        pathname: '/en/login',
      },
      writable: true,
    });
    const { container, root } = await renderAuthForm('en');
    try {
      setEmail(container, 'alice@example.com');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      setCode(container, '123456');
      clickSubmit(container);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      // The open-redirect guard holds: never redirected to the evil host.
      expect(capturedHref).not.toContain('evil.example.com');
      expect(capturedHref.startsWith('/')).toBe(true);
      // R1: the account-portal exchange now runs (so the Worker can set the
      // httpOnly cookie) — the target is same-origin, never the evil host.
      expect(exchangeCalled).toBe(true);
    } finally {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, 'location', { value: { href: '', search: '', pathname: '/en/login' }, writable: true });
    }
  });
});

// ── Not-configured state ──────────────────────────────────────────────

describe('AuthForm — not-configured state', () => {
  it('shows not-configured notice when API URL is absent after mount', async () => {
    const env = import.meta.env as Record<string, unknown>;
    env.PUBLIC_LICENSE_API_URL = '';
    window.__OZ_CONFIG__ = undefined;
    const { container, root } = await renderAuthForm('en');
    try {
      assertText(container, 'The auth API is not configured on this deployment.');
      // The Google entry is hidden with it: it navigates to the licence host, so
      // offering it without an API URL would only produce a 404 for the user.
      expect(container.querySelector('a[href*="/api/v1/web/oauth/google/start"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ── Regression: input background colour ──────────────────────────────
// Ensures inputs never use bg-primary (brand blue) as their background.
// Root cause: AuthForm.tsx inputClass had bg-primary instead of bg-surface,
// turning every text input into a solid blue box (fixed in dda27e89).

describe('AuthForm — input field styling regression', () => {
  it('email input does not have a blue (bg-primary) background', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement | null;
      expect(emailInput, 'email input should be rendered').not.toBeNull();
      // The className must NOT contain bg-primary (the brand-blue token).
      expect(emailInput!.className).not.toContain('bg-primary');
      // And it MUST use bg-surface (white in light mode, dark card in dark).
      expect(emailInput!.className).toContain('bg-surface');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('password input does not have a blue (bg-primary) background', async () => {
    const { container, root } = await renderAuthForm('en');
    try {
      // Switch to password tab so the password input is rendered.
      clickButton(container, 'Password');
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
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
