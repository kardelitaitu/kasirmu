/**
 * localStorage keys used across the POS frontend.
 * Centralised so we never scatter magic strings.
 */
export const STORAGE_KEYS = {
  CART_WIDTH: 'pos-cart-width',
  LOCKED_CART: 'pos-locked-cart',
  LOCALE: 'kasirmu-locale',
  DECIMAL_SEP: 'kasirmu-decimal-sep',
  THOUSANDS_SEP: 'kasirmu-thousands-sep',
} as const;

// ── Legacy key migration ────────────────────────────────────────────
// Old keys from the OZ-POS era. On first load after upgrade, copy any
// stored value to the new key and remove the old one so existing users
// keep their preferences.
const LEGACY_KEYS: Record<string, string> = {
  'oz-pos-locale': STORAGE_KEYS.LOCALE,
  'oz-pos-decimal-sep': STORAGE_KEYS.DECIMAL_SEP,
};

for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
  try {
    const value = localStorage.getItem(oldKey);
    if (value !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, value);
    }
    localStorage.removeItem(oldKey);
  } catch { /* localStorage unavailable */ }
}

/** Decimal separator mode for monetary display. */
export type DecimalSep = 'dot' | 'comma' | 'none';

const VALID_DECIMAL_SEPS: readonly string[] = ['dot', 'comma', 'none'];

/** Read the persisted decimal separator, falling back to `'dot'`. */
export function getDecimalSep(): DecimalSep {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DECIMAL_SEP);
    if (raw && VALID_DECIMAL_SEPS.includes(raw)) return raw as DecimalSep;
  } catch { /* localStorage unavailable */ }
  return 'dot';
}

/** Persist the decimal separator to localStorage. */
export function setDecimalSep(value: string): void {
  if (!VALID_DECIMAL_SEPS.includes(value)) return;
  try {
    localStorage.setItem(STORAGE_KEYS.DECIMAL_SEP, value);
  } catch { /* quota exceeded — ignore */ }
}

/** Thousands-separator mode, matching the printer's own vocabulary. */
export type ThousandsSep = 'comma' | 'dot' | 'space' | 'none';

const VALID_THOUSANDS_SEPS: readonly string[] = ['comma', 'dot', 'space', 'none'];

/**
 * Read the persisted thousands separator, falling back to `'none'`.
 *
 * `'none'` rather than `'comma'` deliberately. The STORE setting defaults to
 * comma (kasirmu-core tests/integration/settings.rs:787), but this reader has no
 * store to ask, and defaulting to grouping would restyle every receipt that never
 * asked for one — which is the reasoning `ReceiptConfig::default` itself gives
 * for `ThousandSeparator::None` (receipt.rs:190-193).
 */
export function getThousandsSep(): ThousandsSep {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.THOUSANDS_SEP);
    if (raw && VALID_THOUSANDS_SEPS.includes(raw)) return raw as ThousandsSep;
  } catch { /* localStorage unavailable */ }
  return 'none';
}

/** Persist the thousands separator. An unknown value is refused, not stored. */
export function setThousandsSep(value: string): void {
  if (!VALID_THOUSANDS_SEPS.includes(value)) return;
  try {
    localStorage.setItem(STORAGE_KEYS.THOUSANDS_SEP, value);
  } catch { /* quota exceeded — ignore */ }
}

/**
 * Map the `StoreSettingsDto.thousandsSeparator` value onto the vocabulary.
 *
 * Total by construction: a fresh store reports `'comma'` (not null) because the
 * core setting is seeded, so "present" must NOT be read as "the operator chose
 * this". Anything unrecognised — an older bridge's payload, a null, a stray case
 * — falls back to the same default the reader uses.
 */
export function thousandsSepFor(raw: string | null | undefined): ThousandsSep {
  const v = (raw ?? '').trim().toLowerCase();
  return VALID_THOUSANDS_SEPS.includes(v) ? (v as ThousandsSep) : 'none';
}
