import { t } from '../../i18n';
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
  locale: string;
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

export default function AccountPassword({ locale, email, pw, pwConfirm, msg, saving, onPwChange, onPwConfirmChange, onSave }: Props) {
  return (
    <section className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm" aria-label={t(locale, 'account.password')}>
      <h2 className="text-lg font-semibold">{t(locale, 'account.password')}</h2>
      <p className="mt-1 text-sm text-muted">{t(locale, 'account.passwordHelp')}</p>
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
          locale={locale}
          id="account-password"
          label={t(locale, 'account.passwordPlaceholder')}
          value={pw}
          onChange={onPwChange}
          autoComplete="new-password"
          placeholder={t(locale, 'account.passwordPlaceholder')}
          showConfirm
          confirmValue={pwConfirm}
          onConfirmChange={onPwConfirmChange}
        />
        {msg === 'saved' && (
          <p className="text-sm text-success" role="status">{t(locale, 'account.passwordSaved')}</p>
        )}
        {msg === 'error' && (
          <p className="text-sm text-danger" role="alert">{t(locale, 'account.passwordError')}</p>
        )}
        <PasswordStrength locale={locale} password={pw} />
        <button
          type="submit"
          disabled={saving || !isStrongPassword(pw) || !passwordsMatch(pw, pwConfirm)}
          className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? '…' : t(locale, 'account.passwordSave')}
        </button>
      </form>
    </section>
  );
}
