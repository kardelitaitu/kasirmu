// ui/src/components/requiredLocalized.ts
//
// Shared required-localization helper (TAX-09 cleanup).
//
// Many components historically wrote `l10n.getString('key') || 'English
// fallback'`, which silently embeds hardcoded English strings. This helper
// replaces that pattern: it resolves the localized string and falls back to
// the Fluent message *id* (never an English string), so a missing message is
// visually identifiable in QA instead of silently serving untranslated copy.

/**
 * Minimal structural type for the `l10n` object returned by
 * `@fluent/react`'s `useLocalization()`.
 */
export interface RequiredLocalizedL10n {
  getString: (
    id: string,
    args?: Record<string, string | number>,
  ) => string | null | undefined;
}

/**
 * Resolve a required localized string for `id`.
 *
 * @param l10n  The `l10n` object from `useLocalization()`.
 * @param id    Fluent message id.
 * @param args  Optional interpolation variables.
 * @returns The localized string, or the message `id` itself when the key is
 *          missing. Logs a dev-only warning so missing keys surface early.
 */
export function requiredLocalized(
  l10n: RequiredLocalizedL10n,
  id: string,
  args?: Record<string, string | number>,
): string {
  const value = l10n.getString(id, args);
  if (value === null || value === undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing required message: "${id}"`);
    }
    return id;
  }
  return value;
}
