/**
 * Language helper — reads/writes the user's preferred language from localStorage.
 *
 * When a user switches language via the locale switcher, their choice is saved
 * to localStorage as `oz_language`. On subsequent visits, if the URL doesn't
 * already have a locale prefix, the saved language is used to redirect.
 *
 * This does NOT override the URL — if the user visits /en/pricing directly,
 * they stay on EN. The preference only applies when navigating to locale-less
 * paths or on first visit.
 */
export type Language = 'en' | 'id';

/**
 * The localStorage key for the preferred language — the ONLY place
 * `oz_language` is spelled.
 *
 * Importable callers write through `setPreferredLanguage` below. The two
 * hand-rolled redirect stubs (`pages/index.astro`, `pages/pair.astro`) read it
 * without importing anything at all: their scripts are `is:inline`, so Astro
 * never bundles them, and they receive this key through `define:vars` instead.
 *
 * Before that the key was written out at four sites in four files — this
 * declaration plus the switcher and both redirect stubs — and this module had no
 * production importer at all: the readers named the key themselves, so an owner
 * that ever changed the name would have been quietly bypassed. `lib/__tests__/
 * language.test.ts` bans a second spelling reappearing.
 */
export const LANGUAGE_STORAGE_KEY = 'oz_language';

export function getPreferredLanguage(): Language | null {
  if (typeof window === 'undefined') return null;
  return (localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language) || null;
}

export function setPreferredLanguage(lang: Language): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }
}
