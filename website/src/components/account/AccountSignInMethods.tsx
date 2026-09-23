import { useEffect, useRef } from 'react';
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
  /** The method the last successful unlink removed; drives the status line. */
  unlinkedMethod: { id: string; provider: string } | null;
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
export default function AccountSignInMethods({ labels, identities, unlinkingId, unlinkError, unlinkedMethod, onUnlink }: Props) {
  // Focus recovery, same reason as AccountDevices: a successful unlink removes
  // the whole row, including the button that was pressed, and focus would
  // otherwise land on <body>. Here the row goes away entirely, so this waits for
  // the method to leave `identities` before moving focus.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const unlinkButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!unlinkedMethod || focusedFor.current === unlinkedMethod.id) return;
    if ((identities ?? []).some((m) => m.id === unlinkedMethod.id)) return;
    focusedFor.current = unlinkedMethod.id;
    // The next method still offering Unlink, else the section heading — never the
    // status line, which is a live region and would be read twice under focus.
    const next = (identities ?? [])
      .map((m) => unlinkButtonRefs.current[m.id])
      .find(Boolean);
    (next ?? headingRef.current)?.focus();
  }, [identities, unlinkedMethod]);

  return (
    <section className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm" aria-label={t(labels, 'account.signInMethods')}>
      {/* tabIndex={-1}: focus target for the unlink recovery above. The focus
          ring stays with the global :focus-visible rule — the single owner
          keyboard-a11y.test.ts enforces. */}
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
        {t(labels, 'account.signInMethods')}
      </h2>
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
                ref={(el) => {
                  unlinkButtonRefs.current[method.id] = el;
                }}
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

      {/* Announced, not just drawn: the row is gone by now, so this is the only
          signal that the unlink worked — and it repeats the property that makes
          it safe (the email code still works). */}
      {unlinkedMethod && (
        <p className="mt-3 text-sm text-success" role="status">
          {t(labels, 'account.methodUnlinked').replace('{provider}', providerName(labels, unlinkedMethod.provider))}
        </p>
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
