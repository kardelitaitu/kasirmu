import { useEffect, useRef } from 'react';
import { t, type Labels } from '../../i18n/labels';
import { isStrongPassword, passwordsMatch } from '../../lib/passwordPolicy';
import PasswordField from '../PasswordField';
import PasswordStrength from '../PasswordStrength';

/**
 * Optional password management — set or change the login credential while
 * signed in. Owns its form state and calls `onSave(pw)` when valid; the
 * parent performs the API call and reports success/failure via `msg`.
 */
export type PasswordMsg = 'idle' | 'saved' | 'error';

interface Props {
  /** Strings this section reads; AccountView passes its own map. */
  labels: Labels;
  /** The signed-in account email — embedded as a hidden readonly field so
      Chrome's accessibility heuristics and password managers can associate
      the new password with the account (the form has no visible username
      field, which would otherwise trigger the "Password forms should have
      username fields" console warning). */
  email: string;
  pw: string;
  pwConfirm: string;
  msg: PasswordMsg;
  saving: boolean;
  onPwChange: (v: string) => void;
  onPwConfirmChange: (v: string) => void;
  onSave: (pw: string) => void;
}

export default function AccountPassword({ labels, email, pw, pwConfirm, msg, saving, onPwChange, onPwConfirmChange, onSave }: Props) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const wasSaved = useRef(false);
  // A successful save clears both fields, which disables the submit button the
  // user just pressed — a disabled element cannot hold focus, so the browser
  // dropped focus on <body> and a keyboard user was restarted at the top of the
  // document (measured in a browser 2026-09-23 at 390px and 1440px, en and id).
  // The section heading is the stable target: the rule this shares with the
  // revoke/unlink sections is "next surviving control, else the section
  // heading", and the surviving control here is an emptied password field,
  // which would only invite a second entry. The global :focus-visible rule
  // paints the ring, so the landing place is visible too.
  useEffect(() => {
    if (msg === 'saved' && !wasSaved.current) headingRef.current?.focus();
    wasSaved.current = msg === 'saved';
  }, [msg]);
  return (
    <section className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm" aria-label={t(labels, 'account.password')}>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold">{t(labels, 'account.password')}</h2>
      <p className="mt-1 text-sm text-muted">{t(labels, 'account.passwordHelp')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(pw);
        }}
        className="mt-4 space-y-3"
      >
        {/* Hidden username context for password managers + the browser's
            accessibility heuristic — never shown, never edited. */}
        <input
          type="email"
          name="email"
          value={email}
          readOnly
          autoComplete="username"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />
        <PasswordField
          labels={labels}
          id="account-password"
          label={t(labels, 'account.passwordPlaceholder')}
          value={pw}
          onChange={onPwChange}
          autoComplete="new-password"
          placeholder={t(labels, 'account.passwordPlaceholder')}
          showConfirm
          confirmValue={pwConfirm}
          onConfirmChange={onPwConfirmChange}
        />
        {msg === 'saved' && (
          <p className="text-sm text-success" role="status">{t(labels, 'account.passwordSaved')}</p>
        )}
        {msg === 'error' && (
          <p className="text-sm text-danger" role="alert">{t(labels, 'account.passwordError')}</p>
        )}
        <PasswordStrength labels={labels} password={pw} />
        <button
          type="submit"
          disabled={saving || !isStrongPassword(pw) || !passwordsMatch(pw, pwConfirm)}
          className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? '…' : t(labels, 'account.passwordSave')}
        </button>
      </form>
    </section>
  );
}
