import en from './en.json';
import id from './id.json';

export type Locale = 'en' | 'id';
export const locales: Locale[] = ['en', 'id'];

const dicts: Record<Locale, Record<string, unknown>> = { en, id };

/** Dot-path string lookup, e.g. `t('en', 'hero.title')`. Falls back to the key. */
export function t(locale: string, key: string): string {
  const value = resolve(locale, key);
  return typeof value === 'string' ? value : key;
}

/**
 * Build the key→string map a hydrated island receives as a prop.
 *
 * Server-side only: this is the one place the dictionaries are read for an
 * island, so the island itself can import `./labels` (no dictionary) instead of
 * this module. `keys` is the island's own exported list — one owner per island.
 *
 * Strictly a subset of the locale's strings; a missing key resolves to the key
 * text, which `island-label-coverage.test.ts` prevents from shipping.
 */
export function labelMap(locale: string, keys: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of keys) map[key] = t(locale, key);
  return map;
}

/** Raw dict for structured content (arrays/objects), e.g. `dict(locale).features.items`. */
export function dict(locale: string): Record<string, unknown> {
  return dicts[(locale as Locale)] ?? en;
}

function resolve(locale: string, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], dict(locale));
}
