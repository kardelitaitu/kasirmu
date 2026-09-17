/**
 * localStorage keys used across the POS frontend.
 * Centralised so we never scatter magic strings.
 */
export const STORAGE_KEYS = {
  CART_WIDTH: 'pos-cart-width',
  LOCKED_CART: 'pos-locked-cart',
  LOCALE: 'kasirmu-locale',
  DECIMAL_SEP: 'kasirmu-decimal-sep',
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
