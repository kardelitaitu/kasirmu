import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { isStrongPassword, passwordsMatch } from '../lib/passwordPolicy';
import PasswordField from './PasswordField';
import PasswordStrength from './PasswordStrength';
import OtpInput from './OtpInput';
import { licenseApiUrl } from '../lib/runtime-config';

/**
 * Sign-in form (website-plan.md §5/§11). Payment is register-first: the
 * email-code tab (request-otp → verify-otp) self-signs a new ACTIVE tenant
 * on first use, so it covers both new accounts and returning tenants; the
 * password tab signs in accounts that set a password (signup page or the
 * dashboard). A "Forgot password?" link switches to the OTP-proved reset
 * flow (request-password-reset → reset-password), which honors the
 * server's 7-day post-reset cooldown and issues a session on completion.
 *
 * The session token stays in sessionStorage (the v1 choice from §11; the
 * hardening follow-up is an httpOnly cookie). After auth the user is sent
 * to ?next= (e.g. back to the pricing page to continue checkout) or the
 * account dashboard by default. Degrades to a "not configured" notice when
 * PUBLIC_LICENSE_API_URL is unset.
 */

interface Props {
  locale: string;
}

type Mode = 'password' | 'otp';
type Step = 'form' | 'code';
type View = 'login' | 'reset';
type ResetStep = 'email' | 'code';

export default function AuthForm({ locale }: Props) {
  // Read API at component level so window.__OZ_CONFIG__ is available after hydration
  const API = licenseApiUrl();
  const [view, setView] = useState<View>('login');
  const [mode, setMode] = useState<Mode>('otp');
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  // Resend cooldown: tracks when the OTP was last sent
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
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

  // Forgot-password flow state.
  const [resetStep, setResetStep] = useState<ResetStep>('email');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetCooldown, setResetCooldown] = useState('');
  // The not-configured notice must never appear in SSR HTML: the
  // build-time PUBLIC_LICENSE_API_URL can be unset while the Worker's
  // runtime config (/__oz/runtime-config.js) provides the URL at
  // hydration. Rendering the notice server-side caused a visible
  // "auth API is not configured" flash before the real form swapped in.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!API && mounted) {
    return <p className="rounded-md border border-ink/10 p-4 text-sm text-muted">{t(locale, 'login.notConfigured')}</p>;
  }

  const redirectAfterAuth = async () => {
    // Honor ?next= (e.g. back to pricing after the sign-in gate) but
    // only for same-site paths — never a protocol-relative or external
    // URL (open-redirect guard).
    const next = new URLSearchParams(window.location.search).get('next');
    // Honor ?redirect= (from the dashboard auth gate, ADR #42) — a full
    // URL to a dashboard subdomain. Exchange the JWT for a short-lived
    // one-time code (hardening F1) so the real session token never appears
    // in a URL; the Worker consumes the code and sets the httpOnly cookie.
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    const token = sessionStorage.getItem('oz_session');
    if (redirect && token) {
      try {
        const u = new URL(redirect);
        if (u.hostname === 'dashboard.kasir.mu' || u.hostname === 'admin.kasir.mu') {
          const res = await fetch(`${API}/api/v1/web/exchange-issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const body = await res.json() as { code?: string };
            if (body.code) {
              u.searchParams.set('code', body.code);
              window.location.href = u.toString();
              return;
            }
          }
          // Exchange failed — land on the dashboard URL clean (no code,
          // no token). The Worker's no-cookie gate redirects to the
          // subdomain login page so the user is never stranded. The old
          // `?token=` fallback is removed (WEB-1): the Worker no longer
          // consumes `?token=`, so the fallback only leaked the JWT into
          // browser history and the Referer header.
          window.location.href = u.toString();
          return;
        }
      } catch {
        // Invalid URL or network error — fall through to the next handler.
      }
    }
    const target = next && next.startsWith('/') && !next.startsWith('//') ? next : `/${locale}/account`;
    // R1: exchange the token so the Worker sets the httpOnly cookie on the
    // marketing host. The Worker catches ?code= on any path, consumes it,
    // sets the cookie, and redirects to a clean URL — the real session
    // token never appears in a URL. Falls back to a direct redirect
    // (sessionStorage) when the exchange fails or the Worker is absent.
    if (token) {
      try {
        const res = await fetch(`${API}/api/v1/web/exchange-issue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const body = await res.json() as { code?: string };
          if (body.code) {
            const u = new URL(target, window.location.origin);
            u.searchParams.set('code', body.code);
            window.location.href = u.toString();
            return;
          }
        }
      } catch {
        // Exchange failed — fall through to the direct redirect below.
        // sessionStorage still has the token; the account page uses it as
        // fallback (/__oz/session is a no-Worker dev path).
      }
    }
    window.location.href = target;
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
  };

  const openReset = () => {
    setResetEmail(email || resetEmail);
    setResetStep('email');
    setResetCooldown('');
    setError('');
    setView('reset');
  };

  const loginPassword = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/web/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error('login failed');
      const data = (await res.json()) as { token?: string };
      if (!data.token) throw new Error('no token');
      sessionStorage.setItem('oz_session', data.token);
      // Cache the verified email so checkout can prefill it without a
      // round-trip to /me (see paddle.getSessionEmail).
      sessionStorage.setItem('oz_email', email);
      redirectAfterAuth();
    } catch {
      setError(t(locale, 'login.errorLogin'));
    } finally {
      setLoading(false);
    }
  };

  const requestOtp = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/web/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        const msg = body.error || `HTTP ${res.status}`;
        if (res.status === 429) {
          setError(t(locale, 'login.errorRateLimit'));
        } else if (res.status === 403) {
          setError(t(locale, 'login.errorCors'));
        } else if (res.status === 503) {
          setError(t(locale, 'login.errorSmtp'));
        } else {
          setError(`${t(locale, 'login.errorSend')} (${msg})`);
        }
        return;
      }
      setOtpSentAt(Date.now());
      setStep('code');
    } catch {
      setError(t(locale, 'login.errorSend'));
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/web/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) throw new Error('verify-otp failed');
      const data = (await res.json()) as { token?: string };
      if (!data.token) throw new Error('no token');
      sessionStorage.setItem('oz_session', data.token);
      sessionStorage.setItem('oz_email', email);
      redirectAfterAuth();
    } catch {
      setError(t(locale, 'login.errorVerify'));
    } finally {
      setLoading(false);
    }
  };

  const requestResetCode = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError('');
    setResetCooldown('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/web/request-password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await res.json() as { cooldown_until?: string; error?: string };
      if (!res.ok) {
        // Show error with HTTP status code for debugging
        setError(`${t(locale, 'login.errorResetRequest')} Code ${res.status}`);
        return;
      }
      // Email was sent — advance to code step
      if (data.cooldown_until) {
        setResetCooldown(data.cooldown_until);
      }
      setResetStep('code');
    } catch (err) {
      // Network error or parse failure
      setError(`${t(locale, 'login.errorResetRequest')} Code 0`);
    } finally {
      setLoading(false);
    }
  };

  const submitResetPassword = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/web/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, code: resetCode, password: resetPassword, password_confirm: resetConfirm }),
      });
      if (!res.ok) throw new Error('reset-password failed');
      const data = (await res.json()) as { token?: string };
      if (!data.token) throw new Error('no token');
      sessionStorage.setItem('oz_session', data.token);
      sessionStorage.setItem('oz_email', resetEmail);
      redirectAfterAuth();
    } catch {
      setError(t(locale, 'login.errorReset'));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-md border border-ink/10 bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-primary/30';

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      active ? 'bg-primary text-on-primary shadow-sm' : 'text-muted hover:text-ink'
    }`;

  // ── Forgot-password view ─────────────────────────────────────────
  if (view === 'reset') {
    if (resetStep === 'email') {
      return (
        <div className="mx-auto w-full max-w-sm rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm">
          <form onSubmit={requestResetCode} className="space-y-4" aria-label={t(locale, 'login.resetTitle')}>
            <label className="block">
              <span className="mb-1 block text-sm text-muted">{t(locale, 'login.email')}</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder={t(locale, 'login.emailPlaceholder')}
                className={inputClass}
              />
            </label>
            {resetCooldown && (
              <p className="text-sm text-muted" role="status">
                {t(locale, 'login.cooldown')}{' '}
                {new Date(resetCooldown).toLocaleDateString(locale === 'id' ? 'id-ID' : 'en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
                .
              </p>
            )}
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
            >
              {loading ? '…' : t(locale, 'login.sendResetCode')}
            </button>
            <button
              type="button"
              onClick={() => setView('login')}
              className="w-full text-center text-xs text-muted transition hover:text-ink"
            >
              {t(locale, 'login.backToLogin')}
            </button>
          </form>
        </div>
      );
    }
    return (
      <div className={`mx-auto w-full max-w-sm rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm ${error ? 'animate-shake' : ''}`}>
        <p className="mb-4 text-sm text-muted">{t(locale, 'login.resetCodeSent')}</p>
        <form onSubmit={submitResetPassword} className="space-y-4" aria-label={t(locale, 'login.resetTitle')}>
          <div>
            <span className="mb-2 block text-sm text-muted">{t(locale, 'login.code')}</span>
            <OtpInput
              value={resetCode}
              onChange={(val) => {
                setResetCode(val);
                if (error) setError('');
              }}
              error={!!error}
              disabled={loading}
              idPrefix="reset-otp-digit"
            />
          </div>
          <PasswordField
            locale={locale}
            id="reset-password"
            label={t(locale, 'login.newPassword')}
            value={resetPassword}
            onChange={setResetPassword}
            autoComplete="new-password"
            placeholder={t(locale, 'login.passwordPlaceholder')}
            showConfirm
            confirmValue={resetConfirm}
            onConfirmChange={setResetConfirm}
          />
          <PasswordStrength locale={locale} password={resetPassword} />
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={loading || resetCode.length < 6 || !isStrongPassword(resetPassword) || !passwordsMatch(resetPassword, resetConfirm)}
            className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
          >
            {loading ? '…' : t(locale, 'login.resetPassword')}
          </button>
          <button
            type="button"
            onClick={() => setView('login')}
            className="w-full text-center text-xs text-muted transition hover:text-ink"
          >
            {t(locale, 'login.backToLogin')}
          </button>
        </form>
      </div>
    );
  }

  // ── OTP code step ────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <div className={`mx-auto w-full max-w-sm rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm ${error ? 'animate-shake' : ''}`}>
        <p className="mb-4 text-sm text-muted">{t(locale, 'login.codeSent')}</p>
        <form onSubmit={verifyOtp} className="space-y-4" aria-label={t(locale, 'login.title')}>
          <div>
            <span className="mb-2 block text-sm text-muted">{t(locale, 'login.code')}</span>
            <p className="mb-2 text-xs text-muted">{t(locale, 'login.codePlaceholder')}</p>
            <OtpInput
              value={code}
              onChange={(val) => {
                setCode(val);
                if (error) setError('');
              }}
              error={!!error}
              disabled={loading}
              idPrefix="login-otp-digit"
            />
          </div>
          {resendSuccess && (
            <p className="text-center text-xs font-medium text-green-500" role="status">
              ✓ {t(locale, 'login.codeResent')}
            </p>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
          >
            {loading ? '…' : t(locale, 'login.verify')}
          </button>
          {resendCooldown > 0 ? (
            <p className="text-center text-xs text-muted" role="timer" aria-live="polite" aria-atomic="true">
              {t(locale, 'login.resendCooldown')} {resendCooldown}s
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  setError('');
                  setLoading(true);
                  try {
                    const res = await fetch(`${API}/api/v1/web/request-otp`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email }),
                    });
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({})) as { error?: string };
                      if (res.status === 429) {
                        setError(t(locale, 'login.errorRateLimit'));
                      } else if (res.status === 403) {
                        setError(t(locale, 'login.errorCors'));
                      } else if (res.status === 503) {
                        setError(t(locale, 'login.errorSmtp'));
                      } else {
                        const msg = body.error;
                        setError(msg ? `${t(locale, 'login.errorSend')} (${msg})` : t(locale, 'login.errorSend'));
                      }
                      return;
                    }
                    setOtpSentAt(Date.now());
                    setResendSuccess(true);
                    setTimeout(() => setResendSuccess(false), 4000);
                  } catch {
                    setError(t(locale, 'login.errorSend'));
                  } finally {
                    setLoading(false);
                  }
                })();
              }}
              disabled={loading}
              className="w-full text-center text-xs text-link transition hover:underline"
              aria-label={t(locale, 'login.resendCode')}
            >
              {t(locale, 'login.resendCode')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setStep('form')}
            className="w-full text-center text-xs text-muted transition hover:text-ink"
          >
            {t(locale, 'login.backToEmail')}
          </button>
        </form>
      </div>
    );
  }

  // ── Sign-in view (tabs) ──────────────────────────────────────────
  return (
    <div className={`mx-auto w-full max-w-sm rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm ${error ? 'animate-shake' : ''}`}>
      <div
        role="tablist"
        aria-label={t(locale, 'login.title')}
        className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-ink/10 p-1"
      >
        <button type="button" role="tab" aria-selected={mode === 'otp'} onClick={() => switchMode('otp')} className={tabClass(mode === 'otp')}>
          {t(locale, 'login.tabEmailCode')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'password'} onClick={() => switchMode('password')} className={tabClass(mode === 'password')}>
          {t(locale, 'login.tabPassword')}
        </button>
      </div>

      {/* Min-height prevents layout shift when switching tabs (password is taller) */}
      <div className="min-h-[320px]">
      {mode === 'password' ? (
        <form onSubmit={loginPassword} className="space-y-4" aria-label={t(locale, 'login.tabPassword')}>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t(locale, 'login.email')}</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(locale, 'login.emailPlaceholder')}
              className={inputClass}
            />
          </label>
          <PasswordField
            locale={locale}
            id="login-password"
            label={t(locale, 'login.password')}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            placeholder={t(locale, 'login.passwordPlaceholder')}
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{t(locale, 'login.forgotPassword')}</span>
            <button
              type="button"
              onClick={openReset}
              className="text-link transition hover:underline"
            >
              {t(locale, 'login.forgotPasswordLink')}
            </button>
          </div>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
          >
            {loading ? '…' : t(locale, 'login.signIn')}
          </button>
          <p className="text-center text-xs text-muted">
            {t(locale, 'login.newHere')}{' '}
            <a href={`/${locale}/signup`} className="text-link transition hover:underline">
              {t(locale, 'login.createAccount')}
            </a>
          </p>
        </form>
      ) : (
        <form onSubmit={requestOtp} className="space-y-4" aria-label={t(locale, 'login.tabEmailCode')}>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t(locale, 'login.email')}</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(locale, 'login.emailPlaceholder')}
              className={inputClass}
            />
          </label>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
          >
            {loading ? '…' : t(locale, 'login.sendCode')}
          </button>
          <p className="text-xs text-muted">{t(locale, 'login.otpNote')}</p>
          <p className="text-xs text-muted">{t(locale, 'login.newAccount')}</p>
          <p className="text-center text-xs text-muted">
            {t(locale, 'login.newHere')}{' '}
            <a href={`/${locale}/signup`} className="text-link transition hover:underline">
              {t(locale, 'login.createAccount')}
            </a>
          </p>
        </form>
      )}
      </div>
    </div>
  );
}
