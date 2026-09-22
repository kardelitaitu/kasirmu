import { useEffect, useState } from 'react';
import { t, type Labels } from '../i18n/labels';
import { isStrongPassword, passwordsMatch } from '../lib/passwordPolicy';
import { type Region, setRegion } from '../lib/region';
import PasswordField, { PASSWORD_FIELD_LABELS } from './PasswordField';
import PasswordStrength, { PASSWORD_STRENGTH_LABELS } from './PasswordStrength';
import OtpInput from './OtpInput';
import { licenseApiUrl } from '../lib/runtime-config';

/**
 * Signup form (website-plan.md §5) — the password-first registration path
 * on /signup, distinct from the login page's OTP self-signup:
 *
 *   register (email + password) → confirmation code email →
 *   verify-otp → session token (+ cached email)
 *
 * The server creates the tenant with email_verified=false and emails a
 * 6-digit code; verify-otp proves inbox ownership, flips the flag, and
 * issues the session. Registration rejects existing accounts (409), which
 * is why this page exists separately from request-otp's register-or-login
 * semantics. The password strength meter mirrors the server policy (≥8
 * chars, ≥3 of 4 classes) and gates the submit button. After verify the
 * user is sent to ?next= or the account dashboard. Degrades to a "not
 * configured" notice when PUBLIC_LICENSE_API_URL is unset.
 */

/**
 * Strings this island reads — itself, `PasswordField` and `PasswordStrength`.
 * `signup.astro` turns the list into the `labels` prop with `labelMap`, so the
 * browser gets these strings in the document instead of both locale dictionaries
 * in the JS bundle; `src/__tests__/island-label-coverage.test.ts` keeps the list
 * honest.
 */
export const SIGNUP_FORM_LABELS = [
  'legal.privacyTitle',
  'legal.termsTitle',
  'login.backToEmail',
  'login.code',
  'login.codeResent',
  'login.continueWithGoogle',
  'login.errorCors',
  'login.errorLogin',
  'login.errorRateLimit',
  'login.errorReset',
  'login.errorResetRequest',
  'login.errorSend',
  'login.errorSmtp',
  'login.errorVerify',
  'login.notConfigured',
  'login.orUseEmail',
  'login.resendCode',
  'login.resendCooldown',
  ...PASSWORD_FIELD_LABELS,
  ...PASSWORD_STRENGTH_LABELS,
  'signup.agreeBefore',
  'signup.agreeSeparator',
  'signup.codeSent',
  'signup.createAccount',
  'signup.email',
  'signup.emailPlaceholder',
  'signup.errorExists',
  'signup.errorRegister',
  'signup.haveAccount',
  'signup.password',
  'signup.passwordPlaceholder',
  'signup.region',
  'signup.regionGlobal',
  'signup.regionHint',
  'signup.regionIndonesia',
  'signup.signInLink',
  'signup.title',
  'signup.verify',
] as const;

interface Props {
  locale: string;
  /** Strings this form reads; see `SIGNUP_FORM_LABELS`. */
  labels: Labels;
}

type Step = 'form' | 'code';

const INPUT_CLASS =
  'w-full rounded-md border border-ink/10 bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-accent';

const regionOptions: { value: Region; labelKey: string }[] = [
  { value: 'global', labelKey: 'signup.regionGlobal' },
  { value: 'id', labelKey: 'signup.regionIndonesia' },
];

export default function SignupForm({ locale, labels }: Props) {
  // Read API at component level so window.__OZ_CONFIG__ is available after hydration
  const API = licenseApiUrl();
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [region, setRegionState] = useState<Region>('global');
  // Read from localStorage after hydration to avoid SSR/client mismatch
  useEffect(() => {
    const saved = localStorage.getItem('oz_region') as Region | null;
    if (saved && saved !== region) setRegionState(saved);
  }, []);
  const [regionOpen, setRegionOpen] = useState(false);
  const handleRegionChange = (r: Region) => {
    setRegionState(r);
    setRegion(r);
    setRegionOpen(false);
  };
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  // Resend cooldown
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
  // SSR-safe: never render the not-configured notice in server HTML (the
  // Worker's runtime config can supply the URL at hydration even when the
  // build-time PUBLIC_LICENSE_API_URL is unset) — that caused a visible
  // flash on /en/signup before the real form swapped in.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!API && mounted) {
    return <p className="rounded-md border border-ink/10 p-4 text-sm text-muted">{t(labels, 'login.notConfigured')}</p>;
  }

  const redirectAfterAuth = () => {
    // Honor ?next= (e.g. back to pricing after the sign-up gate) but
    // only for same-site paths — never a protocol-relative or external
    // URL (open-redirect guard).
    const next = new URLSearchParams(window.location.search).get('next');
    const target = next && next.startsWith('/') && !next.startsWith('//') ? next : `/${locale}/account`;
    window.location.href = target;
  };

  const register = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/web/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, password_confirm: confirm }),
      });
      if (res.status === 409) {
        setError(t(labels, 'signup.errorExists'));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        const msg = body.error || `HTTP ${res.status}`;
        if (res.status === 429) {
          setError(t(labels, 'login.errorRateLimit'));
        } else if (res.status === 403) {
          setError(t(labels, 'login.errorCors'));
        } else if (res.status === 503) {
          setError(t(labels, 'login.errorSmtp'));
        } else {
          setError(`${t(labels, 'signup.errorRegister')} (${msg})`);
        }
        return;
      }
      setOtpSentAt(Date.now());
      setStep('code');
    } catch {
      setError(t(labels, 'signup.errorRegister'));
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e: { preventDefault(): void }) => {
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
      // Cache the verified email so checkout can prefill it without a
      // round-trip to /me (see paddle.getSessionEmail).
      sessionStorage.setItem('oz_email', email);
      // Persist region for pricing and checkout routing.
      localStorage.setItem('oz_region', region);
      redirectAfterAuth();
    } catch {
      setError(t(labels, 'login.errorVerify'));
    } finally {
      setLoading(false);
    }
  };

  const inputClass = INPUT_CLASS;

  if (step === 'code') {
    return (
      <div className={`mx-auto w-full max-w-sm rounded-xl border border-ink/10 bg-surface/40 p-6 ${error ? 'animate-shake' : ''}`}>
        <p className="mb-4 text-sm text-muted">{t(labels, 'signup.codeSent')}</p>
        <form onSubmit={verify} className="space-y-4" aria-label={t(labels, 'signup.title')}>
          <div>
            <span className="mb-2 block text-sm text-muted">{t(labels, 'login.code')}</span>
            <OtpInput
              value={code}
              onChange={(val) => {
                setCode(val);
                if (error) setError('');
              }}
              error={!!error}
              disabled={loading}
              idPrefix="signup-otp-digit"
            />
          </div>
          {resendSuccess && (
            <p className="text-center text-xs font-medium text-green-500" role="status">
              ✓ {t(labels, 'login.codeResent')}
            </p>
          )}
          {error && <p className="text-sm text-link" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
          >
            {loading ? '…' : t(labels, 'signup.verify')}
          </button>
          {resendCooldown > 0 ? (
            <p className="text-center text-xs text-muted" role="timer" aria-live="polite" aria-atomic="true">
              {t(labels, 'login.resendCooldown')} {resendCooldown}s
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
                        setError(t(labels, 'login.errorRateLimit'));
                      } else if (res.status === 403) {
                        setError(t(labels, 'login.errorCors'));
                      } else if (res.status === 503) {
                        setError(t(labels, 'login.errorSmtp'));
                      } else {
                        const msg = body.error;
                        setError(msg ? `${t(labels, 'login.errorSend')} (${msg})` : t(labels, 'login.errorSend'));
                      }
                      return;
                    }
                    setOtpSentAt(Date.now());
                    setResendSuccess(true);
                    setTimeout(() => setResendSuccess(false), 4000);
                  } catch {
                    setError(t(labels, 'login.errorSend'));
                  } finally {
                    setLoading(false);
                  }
                })();
              }}
              disabled={loading}
              className="w-full text-center text-xs text-link transition hover:underline"
              aria-label={t(labels, 'login.resendCode')}
            >
              {t(labels, 'login.resendCode')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setStep('form')}
            className="w-full text-center text-xs text-muted transition hover:text-ink"
          >
            {t(labels, 'login.backToEmail')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={`mx-auto w-full max-w-sm rounded-xl border border-ink/10 bg-surface/40 p-6 ${error ? 'animate-shake' : ''}`}>
      {/* ADR #54 §2.4 P2: the same entry as the login page. Sign-UP is the case the ADR
          names, and this page is a separate component from AuthForm — so the control has to
          exist here too, not only where sign-in lives. An anchor, not a form: the Worker CSP
          sets form-action 'self'. */}
      {/* mounted-gated for the same reason as AuthForm: `API` differs between
          the SSR pass (undefined) and the hydrated client (runtime config),
          which caused a React hydration mismatch (#418) on this page. */}
      {mounted && API && (
        <>
          <a
            href={API + '/api/v1/web/oauth/google/start?next=/' + locale + '/account'}
            className="mb-4 block w-full rounded-lg border border-ink/10 bg-surface/40 px-4 py-2.5 text-center text-sm font-medium hover:bg-ink/5"
          >
            {t(labels, 'login.continueWithGoogle')}
          </a>
          <div className="mb-4 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-ink/10" aria-hidden="true" />
            {t(labels, 'login.orUseEmail')}
            <span className="h-px flex-1 bg-ink/10" aria-hidden="true" />
          </div>
        </>
      )}
      <form onSubmit={register} className="space-y-4" aria-label={t(labels, 'signup.title')}>
        <div className="relative">
          <span className="mb-1 block text-sm text-muted">{t(labels, 'signup.region')}</span>
          <button
            type="button"
            onClick={() => setRegionOpen(!regionOpen)}
            onBlur={() => setTimeout(() => setRegionOpen(false), 150)}
            className="w-full rounded-md border border-ink/10 bg-surface px-3 py-2 text-sm text-left outline-none transition focus:border-accent flex items-center justify-between"
          >
            <span>{t(labels, regionOptions.find((o) => o.value === region)?.labelKey ?? 'signup.regionGlobal')}</span>
            <svg
              className={`w-4 h-4 text-muted transition-transform duration-200 ${regionOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 6 8 10 12 6" />
            </svg>
          </button>
          {regionOpen && (
            <div className="absolute z-50 mt-1 w-full rounded-md border border-ink/10 bg-surface shadow-lg overflow-hidden">
              {regionOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleRegionChange(opt.value)}
                  className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors duration-150 ${
                    region === opt.value ? 'text-link font-medium' : 'text-ink hover:bg-ink/5'
                  }`}
                >
                  <span>{t(labels, opt.labelKey)}</span>
                </button>
              ))}
            </div>
          )}
          <span className="mt-1 block text-xs text-muted">{t(labels, 'signup.regionHint')}</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{t(labels, 'signup.email')}</span>
          <span className="relative block">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailTouched(true);
              }}
              onBlur={() => setEmailTouched(true)}
              placeholder={t(labels, 'signup.emailPlaceholder')}
              className={`${inputClass} pr-10`}
            />
            {emailTouched && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" aria-label="Valid email">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3.5 8 6.5 11 12.5 5" />
                </svg>
              </span>
            )}
          </span>
        </label>
        <PasswordField
          labels={labels}
          id="signup-password"
          label={t(labels, 'signup.password')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder={t(labels, 'signup.passwordPlaceholder')}
          showConfirm
          confirmValue={confirm}
          onConfirmChange={setConfirm}
        />
        <PasswordStrength labels={labels} password={password} />
        {error && <p className="text-sm text-link" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={loading || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isStrongPassword(password) || !passwordsMatch(password, confirm)}
          className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
        >
          {loading ? '…' : t(labels, 'signup.createAccount')}
        </button>
        <p className="text-center text-xs text-muted">
          {t(labels, 'signup.agreeBefore')}{' '}
          <a href={`/${locale}/legal/terms`} className="text-link transition hover:underline">
            {t(labels, 'legal.termsTitle')}
          </a>{' '}
          {t(labels, 'signup.agreeSeparator')}{' '}
          <a href={`/${locale}/legal/privacy`} className="text-link transition hover:underline">
            {t(labels, 'legal.privacyTitle')}
          </a>.
        </p>
        <p className="text-center text-xs text-muted">
          {t(labels, 'signup.haveAccount')}{' '}
          <a href={`/${locale}/login`} className="text-link transition hover:underline">
            {t(labels, 'signup.signInLink')}
          </a>
        </p>
      </form>
    </div>
  );
}
