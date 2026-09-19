// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LABELS } from '../AccountView';
import { fmtDate, daysUntil, statusLabel, statusPillClass, renewsLabel } from '../AccountView';
import { labelMap } from '../../i18n';

/**
 * Property-style invariant tests for the dashboard's pure helpers.
 * These test the *contract* of each function — properties that must hold
 * for any valid input — not a single example.
 */

// ── fmtDate ───────────────────────────────────────────────────────────

describe('fmtDate invariants', () => {
  const LOCALES = ['en', 'id'] as const;

  it('returns an em-dash for undefined or empty input', () => {
    expect(fmtDate(undefined, 'en')).toBe('—');
    expect(fmtDate('', 'en')).toBe('—');
  });

  it('is deterministic — same input always produces the same output', () => {
    const inputs = [
      '2027-01-01',
      '2027-01-01T00:00:00Z',
      '2027-06-15T15:30:00Z',
      '2027-12-31T23:59:59Z',
    ];
    for (const locale of LOCALES) {
      for (const input of inputs) {
        const first = fmtDate(input, locale);
        const second = fmtDate(input, locale);
        expect(first).toBe(second);
      }
    }
  });

  it('returns the raw string for an invalid date (never crashes)', () => {
    expect(fmtDate('not-a-date', 'en')).toBe('not-a-date');
    expect(fmtDate('garbage', 'id')).toBe('garbage');
    expect(fmtDate('2027-13-01', 'en')).toBe('2027-13-01');
  });
});

// ── daysUntil ─────────────────────────────────────────────────────────

describe('daysUntil invariants', () => {
  it('returns null for undefined or empty input', () => {
    expect(daysUntil(undefined)).toBeNull();
    expect(daysUntil('')).toBeNull();
  });

  it('returns null for an invalid date (never NaN)', () => {
    const result = daysUntil('not-a-date');
    expect(result).toBeNull();
  });

  it('returns null for a completely garbage string', () => {
    expect(daysUntil('garbage')).toBeNull();
  });

  it('returns 0 for today', () => {
    const today = new Date();
    const result = daysUntil(today.toISOString());
    // 0 or 1 — allowance for the rounding boundary at midnight.
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns 1 for tomorrow', () => {
    // daysUntil compares UTC calendar dates (date-only), so "tomorrow" must
    // be built at the UTC day boundary — local-midnight construction is off
    // by one on any timezone east of UTC (e.g. UTC+7).
    const now = new Date();
    const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const tomorrow = new Date(base + 86_400_000).toISOString();
    expect(daysUntil(tomorrow)).toBe(1);
  });

  it('returns a negative number for a past date', () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    past.setHours(0, 0, 0, 0);
    const result = daysUntil(past.toISOString());
    expect(result).toBeLessThan(0);
  });
});

// ── statusLabel ───────────────────────────────────────────────────────

describe('statusLabel invariants', () => {
  const KNOWN = ['active', 'unused', 'grace_period', 'expired', 'revoked', 'paused'];
  const LOCALES = ['en', 'id'];

  it('returns a non-empty string for every known status', () => {
    for (const locale of LOCALES) {
      for (const status of KNOWN) {
        const label = statusLabel(labelMap(locale, ACCOUNT_LABELS), status);
        expect(label).toBeTruthy();
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it('returns the raw value for an unknown status', () => {
    expect(statusLabel(labelMap('en', ACCOUNT_LABELS), 'suspended')).toBe('suspended');
    expect(statusLabel(labelMap('id', ACCOUNT_LABELS), 'suspended')).toBe('suspended');
  });

  it('returns an em-dash for undefined', () => {
    expect(statusLabel(labelMap('en', ACCOUNT_LABELS), undefined)).toBe('—');
  });
});

// ── statusPillClass ───────────────────────────────────────────────────

describe('statusPillClass invariants', () => {
  const KNOWN = ['active', 'unused', 'grace_period', 'expired', 'revoked', 'paused'];
  const VALID_CLASSES = [
    'bg-success/15 text-success',
    'bg-warning/15 text-warning',
    'bg-danger/15 text-danger',
    'bg-ink/10 text-muted',
  ];

  it('returns one of the valid class strings for every known status', () => {
    for (const status of KNOWN) {
      const cls = statusPillClass(status);
      expect(VALID_CLASSES).toContain(cls);
    }
  });

  it('returns the default muted class for unknown status', () => {
    expect(statusPillClass('suspended')).toBe('bg-ink/10 text-muted');
  });

  it('returns the default muted class for undefined', () => {
    expect(statusPillClass(undefined)).toBe('bg-ink/10 text-muted');
  });
});

// ── renewsLabel ───────────────────────────────────────────────────────

describe('renewsLabel invariants', () => {
  const LOCALES = ['en', 'id'];

  it('returns a non-empty string for every locale', () => {
    for (const locale of LOCALES) {
      const label = renewsLabel(labelMap(locale, ACCOUNT_LABELS), 5);
      expect(label).toBeTruthy();
      expect(label).toContain('5');
    }
  });

  it('uses the singular form for 1 day and plural form for other counts', () => {
    const enLabels = labelMap('en', ACCOUNT_LABELS);
    const singularEn = renewsLabel(enLabels, 1);
    expect(singularEn).toContain('1 day');
    // plural forms
    expect(renewsLabel(enLabels, 0)).toContain('0 days');
    expect(renewsLabel(enLabels, 2)).toContain('2 days');
    expect(renewsLabel(enLabels, 10)).toContain('10 days');
  });
});