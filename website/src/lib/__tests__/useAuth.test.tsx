// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useAuth, AUTH_ERROR_LABELS } from '../useAuth';
import { labelMap } from '../../i18n';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The hook takes the strings it raises, not a locale (src/i18n/labels.ts).
const enLabels = labelMap('en', AUTH_ERROR_LABELS);

describe('useAuth hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  async function renderHookHarness(callback: () => ReturnType<typeof useAuth>) {
    let currentResult!: ReturnType<typeof useAuth>;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function TestComponent() {
      currentResult = callback();
      return null;
    }

    await act(async () => {
      root.render(<TestComponent />);
    });

    return {
      get current() {
        return currentResult;
      },
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  it('initializes with default states', async () => {
    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));
    expect(harness.current.loading).toBe(false);
    expect(harness.current.error).toBe('');
    expect(harness.current.resendCooldown).toBe(0);
    expect(harness.current.resendSuccess).toBe(false);
    await harness.unmount();
  });

  it('handles successful OTP request and starts cooldown', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));

    let success = false;
    await act(async () => {
      success = await harness.current.requestOtp('test@example.com');
    });

    expect(success).toBe(true);
    expect(harness.current.error).toBe('');
    expect(harness.current.otpSentAt).not.toBeNull();
    await harness.unmount();
  });

  it('handles OTP verification and invokes onAuthSuccess', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'mock-token' }),
    });

    const onAuthSuccess = vi.fn();
    const harness = await renderHookHarness(() => useAuth({ labels: enLabels, onAuthSuccess }));

    let res: { success: boolean; token?: string } = { success: false };
    await act(async () => {
      res = await harness.current.verifyOtp('test@example.com', '123456', 'global');
    });

    expect(res.success).toBe(true);
    expect(res.token).toBe('mock-token');
    expect(sessionStorage.getItem('oz_session')).toBe('mock-token');
    expect(sessionStorage.getItem('oz_email')).toBe('test@example.com');
    expect(localStorage.getItem('oz_region')).toBe('global');
    expect(onAuthSuccess).toHaveBeenCalledWith('mock-token', 'test@example.com');
    await harness.unmount();
  });

  it('handles login with password failure gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid password' }),
    });

    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));

    let res: { success: boolean; token?: string } = { success: true };
    await act(async () => {
      res = await harness.current.loginPassword('test@example.com', 'wrongpassword');
    });

    expect(res.success).toBe(false);
    expect(harness.current.error).not.toBe('');
    await harness.unmount();
  });

  it('handles new tenant registration successfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));

    let success = false;
    await act(async () => {
      success = await harness.current.register('newuser@example.com', 'SecurePass123!', 'SecurePass123!');
    });

    expect(success).toBe(true);
    expect(harness.current.error).toBe('');
    expect(harness.current.otpSentAt).not.toBeNull();
    await harness.unmount();
  });

  it('handles rate limiting (429) correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many requests' }),
    });

    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));

    let success = true;
    await act(async () => {
      success = await harness.current.requestOtp('rate-limited@example.com');
    });

    expect(success).toBe(false);
    expect(harness.current.error).toContain('Too many requests');
    await harness.unmount();
  });

  it('surfaces the CORS error message on 403', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'origin rejected' }),
    });

    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));

    let success = true;
    await act(async () => {
      success = await harness.current.requestOtp('cors@example.com');
    });

    expect(success).toBe(false);
    expect(harness.current.error).toContain('Request blocked by the server');
    await harness.unmount();
  });

  it('surfaces the SMTP error message on 503', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'mail relay down' }),
    });

    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));

    let success = true;
    await act(async () => {
      success = await harness.current.requestOtp('smtp@example.com');
    });

    expect(success).toBe(false);
    expect(harness.current.error).toContain('Email delivery is not configured');
    await harness.unmount();
  });

  it('appends the server error message to the fallback on other failures', async () => {
    // Non-429/403/503 failure with a server-provided error string: the
    // localized fallback is shown with the server detail appended.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid email format' }),
    });

    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));

    let success = true;
    await act(async () => {
      success = await harness.current.requestOtp('bad@');
    });

    expect(success).toBe(false);
    expect(harness.current.error).toContain("Couldn't send the code");
    expect(harness.current.error).toContain('invalid email format');
    await harness.unmount();
  });

  it('falls back to the localized message when the server sends no error detail', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: '' }),
    });

    const harness = await renderHookHarness(() => useAuth({ labels: enLabels }));

    let success = true;
    await act(async () => {
      success = await harness.current.requestOtp('silent@example.com');
    });

    expect(success).toBe(false);
    // No server detail — the localized fallback alone is shown, no "()".
    expect(harness.current.error).toBe("Couldn't send the code. Please try again later.");
    await harness.unmount();
  });

  it('handles full password reset flow with verification code', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cooldown_until: '2026-08-28T09:10:00Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'reset-token-789' }),
      });

    const onAuthSuccess = vi.fn();
    const harness = await renderHookHarness(() => useAuth({ labels: enLabels, onAuthSuccess }));

    // Step 1: Request reset code
    let codeReqResult: { success: boolean; cooldownUntil?: string } = { success: false };
    await act(async () => {
      codeReqResult = await harness.current.requestResetCode('forgot@example.com');
    });
    expect(codeReqResult.success).toBe(true);
    expect(codeReqResult.cooldownUntil).toBe('2026-08-28T09:10:00Z');

    // Step 2: Submit new password with code
    let resetRes: { success: boolean; token?: string } = { success: false };
    await act(async () => {
      resetRes = await harness.current.resetPassword(
        'forgot@example.com',
        '654321',
        'NewSecurePass999!',
        'NewSecurePass999!'
      );
    });

    expect(resetRes.success).toBe(true);
    expect(resetRes.token).toBe('reset-token-789');
    expect(sessionStorage.getItem('oz_session')).toBe('reset-token-789');
    expect(onAuthSuccess).toHaveBeenCalledWith('reset-token-789', 'forgot@example.com');
    await harness.unmount();
  });
});

