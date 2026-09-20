import { t, type Labels } from '../../i18n/labels';

/**
 * Shared pure helpers for the account dashboard sections. Extracted from
 * AccountView.tsx so every section component renders the same localized
 * status pills, dates, and renewal countdowns without re-implementing them.
 *
 * These are deliberately free of React state: they map server values to
 * localized labels / Tailwind classes / formatted strings.
 *
 * The two label helpers take the island's `labels` map rather than a locale, so
 * nothing in the account dashboard's client graph imports a dictionary
 * (see ../../i18n/labels.ts). `fmtDate` keeps the locale — it feeds Intl, not
 * the dictionaries.
 */

/**
 * Localized label for the raw status values the license server writes
 * (license_keys + subscriptions collections). Unknown values pass through
 * unchanged so a new server status never renders blank.
 */
export function statusLabel(labels: Labels, status: string | undefined): string {
  switch (status) {
    case 'active':
      return t(labels, 'account.statusActive');
    case 'unused':
      return t(labels, 'account.statusUnused');
    case 'grace_period':
      return t(labels, 'account.statusGracePeriod');
    case 'expired':
      return t(labels, 'account.statusExpired');
    case 'revoked':
      return t(labels, 'account.statusRevoked');
    case 'paused':
      return t(labels, 'account.statusPaused');
    default:
      return status ?? '—';
  }
}

/** CSS classes for a status pill based on the raw server status value. */
export function statusPillClass(status: string | undefined): string {
  switch (status) {
    case 'active':
      return 'bg-success/15 text-success';
    case 'grace_period':
      return 'bg-warning/15 text-warning';
    case 'expired':
    case 'revoked':
      return 'bg-danger/15 text-danger';
    default:
      return 'bg-ink/10 text-muted';
  }
}

/** Format an ISO date string to a locale-aware short date, or fallback. */
export function fmtDate(dateStr: string | undefined, locale: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    // new Date('not-a-date') produces an Invalid Date whose
    // toLocaleDateString returns "Invalid Date" (it does NOT throw), so the
    // try/catch below never fires. Guard explicitly and return the raw value.
    if (Number.isNaN(d.getTime())) return dateStr;
    // Use UTC timezone so the displayed calendar day is the same on every
    // machine — "2027-01-01" and "2027-01-01T00:00:00Z" both show "Jan 1,
    // 2027" regardless of whether the user is in Los Angeles or Jakarta.
    // Use Intl.DateTimeFormat with the bare locale so the formatter picks
    // the correct region defaults (en → en-US, id → id-ID) without a
    // hardcoded mapping.
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

/** Days until an ISO date string, or null when missing/parse fails. */
export function daysUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  try {
    // UTC-based calendar-day count, timezone- and clock-independent: the
    // difference between the expiry's UTC date and today's UTC date. A
    // subscription expiring "in 10 days" reports exactly 10 on any machine.
    const d = new Date(dateStr);
    // new Date('not-a-date') produces an Invalid Date (not a throw); its
    // UTC getters return NaN. Treat that as "no date" instead of leaking
    // NaN into the countdown label.
    if (Number.isNaN(d.getTime())) return null;
    const expiryUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Math.round((expiryUTC - todayUTC) / 86_400_000);
    return Number.isNaN(days) ? null : days;
  } catch {
    return null;
  }
}

/**
 * Localized "Renews in N days" label with correct singular/plural, or the
 * raw date fallback. `labels` supplies the string; `days` drives the form.
 */
export function renewsLabel(labels: Labels, days: number): string {
  return days === 1
    ? t(labels, 'account.renewsInDay').replace('{days}', String(days))
    : t(labels, 'account.renewsInDays').replace('{days}', String(days));
}
