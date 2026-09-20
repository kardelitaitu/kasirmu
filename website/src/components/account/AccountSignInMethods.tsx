import { t, type Labels } from '../../i18n/labels';

/** A linked sign-in method from GET /api/v1/web/identities. */
export interface SignInMethod {
  id: string;
  provider: string;
  email?: string;
  lastLogin?: string;
}

interface Props {
  /** Strings this section reads; AccountView passes its own map. */
  labels: Labels;
  identities: SignInMethod[] | null;
  unlinkingId: string | null;
  unlinkError: string | null;
  onUnlink: (identity: SignInMethod) => void;
}

/**
 * Linked sign-in methods for the account (ADR #54).
 *
 * Presentational: the fetch and the unlink call live in AccountView, so the
 * session lifecycle stays in one place. The closing note is not decoration — it
 * states the property that makes the Unlink button safe to press: the account's
 * email code always works, so removing a linked method cannot lock anyone out.
 */
export default function AccountSignInMethods({ labels, identities, unlinkingId, unlinkError, onUnlink }: Props) {
  return (
    <section className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm" aria-label={t(labels, 'account.signInMethods')}>
      <h2 className="text-lg font-semibold">{t(labels, 'account.signInMethods')}</h2>
      <p className="mt-1 text-sm text-muted">{t(labels, 'account.signInMethodsHint')}</p>

      {identities !== null && identities.length > 0 && (
        <div className="mt-4 space-y-2">
          {identities.map((method) => (
            <div key={method.id} className="rounded-lg border border-ink/10 bg-surface p-3 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink truncate">{providerName(labels, method.provider)}</p>
                {method.email && <p className="text-xs text-muted truncate">{method.email}</p>}
              </div>
              <button
                type="button"
                onClick={() => onUnlink(method)}
                disabled={unlinkingId === method.id}
                className="ml-2 inline-flex flex-shrink-0 items-center gap-1 rounded border border-ink/15 bg-surface px-2 py-1 text-xs font-medium text-muted hover:bg-ink/5 disabled:opacity-50"
              >
                {unlinkingId === method.id ? t(labels, 'account.unlinking') : t(labels, 'account.unlink')}
              </button>
            </div>
          ))}
        </div>
      )}

      {identities !== null && identities.length === 0 && (
        <p className="mt-4 text-sm text-muted">{t(labels, 'account.signInMethodsEmpty')}</p>
      )}

      {unlinkError && (
        <p className="mt-3 text-sm text-danger" role="alert">{unlinkError}</p>
      )}

      <p className="mt-3 text-xs text-muted">{t(labels, 'account.signInMethodsAlwaysEmail')}</p>
    </section>
  );
}

/** Provider display name; an unknown provider passes through rather than rendering blank. */
function providerName(labels: Labels, provider: string): string {
  if (provider === 'google') return t(labels, 'account.providerGoogle');
  return provider;
}
