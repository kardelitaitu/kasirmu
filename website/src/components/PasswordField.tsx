import { useState } from 'react';
import { t, type Labels } from '../i18n/labels';

/**
 * Password input shared by every auth form (signup, login, forgot-password
 * reset, dashboard change). Provides:
 *
 *   1. A show/hide toggle (👁 / 🙈, aria-labeled) — the eye icon swaps the
 *      input between text and password, so users can verify what they
 *      typed before submitting.
 *   2. An optional confirm field (showConfirm) — the double-entry guard.
 *      Both inputs share the same visibility state, and a "Passwords
 *      don't match" hint appears as soon as the confirm differs from the
 *      password. Parents gate their submit on passwordsMatch() from
 *      ../lib/passwordPolicy, and the server enforces the same rule via
 *      password_confirm (web_password.go).
 *
 * The label and placeholders come from props so callers can reuse generic
 * password.* i18n keys or supply form-specific ones.
 */
const inputClass =
  'w-full rounded-md border border-ink/10 bg-surface px-3 py-2 text-sm text-ink transition';

/**
 * Keys this field reads. Owned here because this is the component that reads
 * them; every island that renders a password field spreads this list into its
 * own (`AUTH_FORM_LABELS`, `SIGNUP_FORM_LABELS`, `ACCOUNT_LABELS`).
 */
export const PASSWORD_FIELD_LABELS = [
  'password.confirmLabel',
  'password.confirmPlaceholder',
  'password.hide',
  'password.mismatch',
  'password.show',
] as const;

interface Props {
  /** Strings this field reads; the owning island passes its own map. */
  labels: Labels;
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  /** Show the second "confirm password" input below the first. */
  showConfirm?: boolean;
  confirmValue?: string;
  onConfirmChange?: (value: string) => void;
  confirmLabel?: string;
  confirmPlaceholder?: string;
}

export default function PasswordField({
  labels,
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  showConfirm = false,
  confirmValue = '',
  onConfirmChange,
  confirmLabel,
  confirmPlaceholder,
}: Props) {
  const [visible, setVisible] = useState(false);
  const mismatch = showConfirm && confirmValue !== '' && confirmValue !== value;
  const match = showConfirm && confirmValue.length >= 8 && confirmValue === value;

  return (
    <>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">{label}</span>
        <span className="relative block">
          <input
            id={id}
            type={visible ? 'text' : 'password'}
            required
            autoComplete={autoComplete}
            minLength={8}
            maxLength={72}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`${inputClass} pr-10`}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={visible ? t(labels, 'password.hide') : t(labels, 'password.show')}
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted transition hover:text-ink"
          >
            {visible ? '🙈' : '👁'}
          </button>
        </span>
      </label>
      {showConfirm && (
        <label className="block">
          <span className="mb-1 block text-sm text-muted">
            {confirmLabel ?? t(labels, 'password.confirmLabel')}
          </span>
          <span className="relative block">
            <input
              id={`${id}-confirm`}
              type={visible ? 'text' : 'password'}
              required
              autoComplete={autoComplete}
              minLength={8}
              maxLength={72}
              value={confirmValue}
              onChange={(e) => onConfirmChange?.(e.target.value)}
              placeholder={confirmPlaceholder ?? t(labels, 'password.confirmPlaceholder')}
              className={`${inputClass} pr-10`}
            />
            {match && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" aria-label="Passwords match">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3.5 8 6.5 11 12.5 5" />
                </svg>
              </span>
            )}
          </span>
        </label>
      )}
      {mismatch && (
        <p className="text-sm text-link" role="alert">
          {t(labels, 'password.mismatch')}
        </p>
      )}
    </>
  );
}
