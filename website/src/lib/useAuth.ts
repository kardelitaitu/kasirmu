import { useState, useEffect, useCallback } from 'react';
import { t, type Labels } from '../i18n/labels';
import { licenseApiUrl } from './runtime-config';

/**
 * The auth-error strings this hook raises. Owned here because the hook decides
 * which fallback applies; an island that calls it spreads this list into its own
 * `labels` list (`AUTH_FORM_LABELS` in AuthForm.tsx does).
 */
export const AUTH_ERROR_LABELS = [
  'login.errorCors',
  'login.errorLogin',
  'login.errorRateLimit',
  'login.errorReset',
  'login.errorResetRequest',
  'login.errorSend',
  'login.errorSmtp',
  'login.errorVerify',
  'signup.errorExists',
  'signup.errorRegister',
] as const;

interface UseAuthOptions {
  /** Strings the hook's error messages read; see `AUTH_ERROR_LABELS`. */
  labels: Labels;
  onAuthSuccess?: (token: string, email: string) => void;
}

export function useAuth({ labels, onAuthSuccess }: UseAuthOptions) {
  const API = licenseApiUrl();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSuccess, setResendSuccess] = useState(false);

  // Countdown timer for OTP resend (120 seconds)
  useEffect(() => {
    if (!otpSentAt) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - otpSentAt) / 1000);
      const remaining = Math.max(0, 120 - elapsed);
      setResendCooldown(remaining);
      if (remaining <= 0) clearInterval(id);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [otpSentAt]);

  const triggerResendSuccess = useCallback(() => {
    setResendSuccess(true);
    setTimeout(() => setResendSuccess(false), 4000);
  }, []);

  const handleApiError = useCallback(
    (res: Response, body: { error?: string }, fallbackKey: string) => {
      if (res.status === 429) {
        setError(t(labels, 'login.errorRateLimit'));
      } else if (res.status === 403) {
        setError(t(labels, 'login.errorCors'));
      } else if (res.status === 503) {
        setError(t(labels, 'login.errorSmtp'));
      } else {
        const msg = body.error;
        setError(msg ? `${t(labels, fallbackKey)} (${msg})` : t(labels, fallbackKey));
      }
    },
    [labels]
  );

  const requestOtp = useCallback(
    async (email: string, isResend = false): Promise<boolean> => {
      const sanitizedEmail = email.trim().toLowerCase();
      setError('');
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/v1/web/request-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: sanitizedEmail }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          handleApiError(res, body, 'login.errorSend');
          return false;
        }
        setOtpSentAt(Date.now());
        if (isResend) triggerResendSuccess();
        return true;
      } catch {
        setError(t(labels, 'login.errorSend'));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [API, handleApiError, labels, triggerResendSuccess]
  );

  const verifyOtp = useCallback(
    async (email: string, code: string, region?: string): Promise<{ success: boolean; token?: string }> => {
      const sanitizedEmail = email.trim().toLowerCase();
      setError('');
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/v1/web/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: sanitizedEmail, code: code.trim() }),
        });
        if (!res.ok) throw new Error('verify-otp failed');
        const data = (await res.json()) as { token?: string };
        if (!data.token) throw new Error('no token');

        sessionStorage.setItem('oz_session', data.token);
        sessionStorage.setItem('oz_email', sanitizedEmail);
        if (region) localStorage.setItem('oz_region', region);

        onAuthSuccess?.(data.token, sanitizedEmail);
        return { success: true, token: data.token };
      } catch {
        setError(t(labels, 'login.errorVerify'));
        return { success: false };
      } finally {
        setLoading(false);
      }
    },
    [API, labels, onAuthSuccess]
  );

  const loginPassword = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; token?: string }> => {
      const sanitizedEmail = email.trim().toLowerCase();
      setError('');
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/v1/web/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: sanitizedEmail, password }),
        });
        if (!res.ok) throw new Error('login failed');
        const data = (await res.json()) as { token?: string };
        if (!data.token) throw new Error('no token');

        sessionStorage.setItem('oz_session', data.token);
        sessionStorage.setItem('oz_email', sanitizedEmail);

        onAuthSuccess?.(data.token, sanitizedEmail);
        return { success: true, token: data.token };
      } catch {
        setError(t(labels, 'login.errorLogin'));
        return { success: false };
      } finally {
        setLoading(false);
      }
    },
    [API, labels, onAuthSuccess]
  );

  const register = useCallback(
    async (email: string, password: string, passwordConfirm: string): Promise<boolean> => {
      const sanitizedEmail = email.trim().toLowerCase();
      setError('');
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/v1/web/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: sanitizedEmail, password, password_confirm: passwordConfirm }),
        });
        if (res.status === 409) {
          setError(t(labels, 'signup.errorExists'));
          return false;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          handleApiError(res, body, 'signup.errorRegister');
          return false;
        }
        setOtpSentAt(Date.now());
        return true;
      } catch {
        setError(t(labels, 'signup.errorRegister'));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [API, handleApiError, labels]
  );

  const requestResetCode = useCallback(
    async (email: string): Promise<{ success: boolean; cooldownUntil?: string }> => {
      const sanitizedEmail = email.trim().toLowerCase();
      setError('');
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/v1/web/request-password-reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: sanitizedEmail }),
        });
        const data = (await res.json().catch(() => ({}))) as { cooldown_until?: string; error?: string };
        if (!res.ok) {
          handleApiError(res, data, 'login.errorResetRequest');
          return { success: false };
        }
        return { success: true, cooldownUntil: data.cooldown_until };
      } catch {
        setError(t(labels, 'login.errorResetRequest'));
        return { success: false };
      } finally {
        setLoading(false);
      }
    },
    [API, handleApiError, labels]
  );

  const resetPassword = useCallback(
    async (
      email: string,
      code: string,
      password: string,
      passwordConfirm: string
    ): Promise<{ success: boolean; token?: string }> => {
      const sanitizedEmail = email.trim().toLowerCase();
      setError('');
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/v1/web/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: sanitizedEmail,
            code: code.trim(),
            password,
            password_confirm: passwordConfirm,
          }),
        });
        if (!res.ok) throw new Error('reset-password failed');
        const data = (await res.json()) as { token?: string };
        if (!data.token) throw new Error('no token');

        sessionStorage.setItem('oz_session', data.token);
        sessionStorage.setItem('oz_email', sanitizedEmail);

        onAuthSuccess?.(data.token, sanitizedEmail);
        return { success: true, token: data.token };
      } catch {
        setError(t(labels, 'login.errorReset'));
        return { success: false };
      } finally {
        setLoading(false);
      }
    },
    [API, labels, onAuthSuccess]
  );

  return {
    loading,
    error,
    setError,
    otpSentAt,
    resendCooldown,
    resendSuccess,
    requestOtp,
    verifyOtp,
    loginPassword,
    register,
    requestResetCode,
    resetPassword,
  };
}
