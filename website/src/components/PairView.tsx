import { useEffect, useState } from 'react';
import { t, type Labels } from '../i18n/labels';
import { licenseApiUrl } from '../lib/runtime-config';
import { getSessionToken } from '../lib/session';

/**
 * Strings this island reads.
 * `pair.astro` turns the list into the `labels` prop with `labelMap`.
 * `src/__tests__/island-label-coverage.test.ts` keeps the list honest.
 */
export const PAIR_LABELS = [
  'pair.title',
  'pair.subtitle',
  'pair.codeLabel',
  'pair.claimButton',
  'pair.claiming',
  'pair.successTitle',
  'pair.successHint',
  'pair.goToAccount',
  'pair.anonTitle',
  'pair.anonHint',
  'pair.signIn',
  'pair.errorExpired',
  'pair.errorUsed',
  'pair.errorInvalid',
  'pair.errorNetwork',
  'pair.noCode',
  'pair.notConfigured',
] as const;

interface Props {
  locale: string;
  labels: Labels;
}

type ViewState = 'loading' | 'anon' | 'ready' | 'success' | 'error';

/** Normalize Crockford pairing code (strips dashes/spaces, converts O->0, I/L->1). */
function normalizeCode(raw: string): string {
  let c = raw.toUpperCase().trim();
  c = c.replace(/[-\s]/g, '');
  c = c.replace(/O/g, '0');
  c = c.replace(/[IL]/g, '1');
  return c;
}

/** Formats an 8-character code as XXXX-XXXX. */
function formatDisplayCode(raw: string): string {
  const norm = normalizeCode(raw);
  if (norm.length <= 4) return norm;
  return `${norm.slice(0, 4)}-${norm.slice(4, 8)}`;
}

export default function PairView({ locale, labels }: Props) {
  const API = licenseApiUrl();
  const [state, setState] = useState<ViewState>('loading');
  const [code, setCode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Parse ?code= from the browser URL search parameters
    const params = new URLSearchParams(window.location.search);
    const rawCode = params.get('code') ?? '';
    setCode(formatDisplayCode(rawCode));

    void (async () => {
      try {
        const sessionToken = await getSessionToken();
        if (!sessionToken) {
          setState('anon');
          return;
        }
        setToken(sessionToken);
        setState('ready');
      } catch {
        setState('anon');
      }
    })();
  }, []);

  if (!API && mounted) {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface/40 p-6 text-center">
        <p className="text-sm text-muted">{t(labels, 'pair.notConfigured')}</p>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="space-y-4 animate-pulse rounded-xl border border-ink/10 bg-surface/40 p-8">
        <div className="mx-auto h-4 w-48 rounded bg-ink/10" />
        <div className="mx-auto h-12 w-64 rounded bg-ink/10" />
        <div className="mx-auto h-10 w-full rounded bg-ink/10" />
      </div>
    );
  }

  // Not signed in: show prompt to log in and preserve return URL with code
  if (state === 'anon') {
    const search = window.location.search;
    const returnPath = `/${locale}/pair${search}`;
    const loginUrl = `/${locale}/login?next=${encodeURIComponent(returnPath)}`;

    return (
      <div className="rounded-xl border border-ink/10 bg-surface/40 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-ink">{t(labels, 'pair.anonTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t(labels, 'pair.anonHint')}</p>
        <div className="mt-6">
          <a
            href={loginUrl}
            className="inline-block rounded-md bg-accent px-6 py-2.5 text-sm font-semibold text-on-primary transition hover:opacity-90"
          >
            {t(labels, 'pair.signIn')}
          </a>
        </div>
      </div>
    );
  }

  // Pairing claimed successfully
  if (state === 'success') {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-ink">{t(labels, 'pair.successTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t(labels, 'pair.successHint')}</p>
        <div className="mt-6">
          <a
            href={`/${locale}/account`}
            className="inline-block rounded-md bg-accent px-6 py-2.5 text-sm font-semibold text-on-primary transition hover:opacity-90"
          >
            {t(labels, 'pair.goToAccount')}
          </a>
        </div>
      </div>
    );
  }

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!API || !token) return;

    const norm = normalizeCode(code);
    if (norm.length !== 8) {
      setErrorMsg(t(labels, 'pair.errorInvalid'));
      return;
    }

    setErrorMsg('');
    setClaiming(true);

    try {
      const res = await fetch(`${API}/api/v1/pairing/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: norm }),
      });

      if (res.ok) {
        setState('success');
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const rawErr = (body.error ?? '').toLowerCase();

      if (rawErr.includes('expired')) {
        setErrorMsg(t(labels, 'pair.errorExpired'));
      } else if (rawErr.includes('already used')) {
        setErrorMsg(t(labels, 'pair.errorUsed'));
      } else if (rawErr.includes('8-character') || rawErr.includes('invalid')) {
        setErrorMsg(t(labels, 'pair.errorInvalid'));
      } else {
        setErrorMsg(body.error || t(labels, 'pair.errorNetwork'));
      }
    } catch {
      setErrorMsg(t(labels, 'pair.errorNetwork'));
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="rounded-xl border border-ink/10 bg-surface/40 p-6 md:p-8">
      <form onSubmit={handleClaim} className="space-y-6">
        <div>
          <label htmlFor="pairing-code" className="block text-sm font-medium text-ink">
            {t(labels, 'pair.codeLabel')}
          </label>
          <div className="mt-2">
            <input
              id="pairing-code"
              name="code"
              type="text"
              autoComplete="off"
              autoFocus
              maxLength={9}
              value={code}
              onChange={(e) => setCode(formatDisplayCode(e.target.value))}
              placeholder="ABCD-1234"
              className="w-full text-center font-mono text-2xl tracking-widest uppercase rounded-lg border border-ink/10 bg-surface px-4 py-3 text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {!code && (
            <p className="mt-2 text-xs text-muted">
              {t(labels, 'pair.noCode')}
            </p>
          )}
        </div>

        {errorMsg && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500" role="alert">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={claiming || normalizeCode(code).length !== 8}
          className="w-full rounded-md bg-accent px-4 py-3 text-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-50"
        >
          {claiming ? t(labels, 'pair.claiming') : t(labels, 'pair.claimButton')}
        </button>
      </form>
    </div>
  );
}
