import { useEffect, useRef, useState } from 'react';
import { t, type Labels } from '../../i18n/labels';
import { statusLabel, statusPillClass, fmtDate } from './accountShared';

/**
 * License card — shows the activated license key (mono, select-all), a copy
 * button with transient "Copied!" feedback, tier, status pill, and expiry.
 * Presentational; the copy feedback is local state.
 */
interface License {
  key: string;
  tierKey: string;
  status: string;
  expiresAt?: string;
}

interface Props {
  locale: string;
  /** Strings this section reads; AccountView passes its own map. */
  labels: Labels;
  /** Tenant status used as a fallback when the license has no status. */
  tenantStatus: string;
  license?: License;
}

export default function AccountLicense({ locale, labels, tenantStatus, license }: Props) {
  return (
    <section className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm" aria-label={t(labels, 'account.license')}>
      <h2 className="text-lg font-semibold">{t(labels, 'account.license')}</h2>
      <dl className="mt-4 grid gap-3.5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">{t(labels, 'account.licenseKey')}</dt>
          <dd className="mt-1 flex items-center gap-2">
            <span className="font-mono bg-ink/5 px-2.5 py-1 rounded text-xs select-all border border-ink/10">
              {license?.key ?? '—'}
            </span>
            {license?.key && <CopyKeyButton labels={labels} licenseKey={license.key} />}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t(labels, 'account.tier')}</dt>
          <dd className="mt-1 font-medium capitalize">{license?.tierKey ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">{t(labels, 'account.status')}</dt>
          <dd className="mt-1 capitalize">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(license?.status ?? tenantStatus)}`}>
              {statusLabel(labels, license?.status ?? tenantStatus)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t(labels, 'account.expires')}</dt>
          <dd className="mt-1">{fmtDate(license?.expiresAt, locale)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Copy-key button with a transient success label. Falls back to
 * execCommand('copy') when navigator.clipboard is unavailable (plain HTTP,
 * local dev), and only shows "Copied!" on actual success. */
function CopyKeyButton({ labels, licenseKey }: { labels: Labels; licenseKey: string }) {
  const [copiedKey, setCopiedKey] = useState(false);
  const timerRef = useRef<number | null>(null);

  const copy = () => {
    copyTextToClipboard(licenseKey).then((ok) => {
      if (!ok) return;
      setCopiedKey(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopiedKey(false), 2500);
    });
  };

  // Cleanup the timer on unmount so it never sets state on a dead component.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded border border-ink/15 bg-surface px-2 py-1 text-xs font-medium text-ink transition hover:bg-ink/5"
      aria-label={t(labels, 'account.copyKey')}
    >
      {copiedKey ? (
        <span className="text-success font-semibold">{t(labels, 'account.copied')}</span>
      ) : (
        <span>{t(labels, 'account.copyKey')}</span>
      )}
    </button>
  );
}

/** Minimal legacy shape of the clipboard fallback API. execCommand is
 *  deprecated in the current DOM lib (ts6387) but remains the only
 *  synchronous no-permission copy path (plain HTTP, local dev, older
 *  WebViews). Routing through this interface keeps the call type-checked
 *  while keeping the deprecation hint off the astro check surface. */
interface LegacyExecCommandDocument {
  execCommand(commandId: string, showUI?: boolean, value?: string): boolean;
}

/** Copy text to the clipboard with a fallback for browsers without
 *  navigator.clipboard (plain HTTP, local dev, older WebViews).
 *  Returns true when the copy was attempted (success is best-effort for
 *  the execCommand path, which has no reliable success signal). */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // navigator.clipboard.writeText rejects when permission is denied —
    // fall through to the execCommand path.
  }
  // execCommand fallback (P4): create a temporary textarea, select it, copy.
  // This is synchronous and works in older browsers / local dev.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = (document as unknown as LegacyExecCommandDocument).execCommand('copy');
    document.body.removeChild(ta);
    // execCommand returns false when the command is unavailable or denied.
    // When true it still may not have actually written (permissions), but
    // this is the best signal we have.
    return ok;
  } catch {
    return false;
  }
}
