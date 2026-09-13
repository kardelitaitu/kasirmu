/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useCallback, useMemo } from 'react';

import type { ReactNode } from 'react';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { getBundle, getAvailableLocales, getLocaleLabel } from './index';
import type { LocaleCode } from './index';

/** Shape of the locale context exposed to consumers. */
export interface LocaleContextValue {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  availableLocales: LocaleCode[];
  getLocaleLabel: (code: LocaleCode) => string;
  /**
   * The org/entity default locale as the regional chain resolved it
   * (regional slice 4), already narrowed to a supported code — `null`
   * when nothing usable is configured. Purely informational: the
   * negotiation already folds it in below the stored user choice.
   */
  orgDefaultLocale: LocaleCode | null;
  /**
   * Feed the org/entity default locale (a raw BCP-47 tag from the regional
   * chain, or `null` to clear). Never persists — only an explicit user
   * choice via `setLocale` does. Unsupported tags are ignored.
   */
  setOrgDefaultLocale: (raw: string | null) => void;
}

/** React context that carries the current locale and setter. */
export const LocaleContext = createContext<LocaleContextValue>({
  locale: 'id',
  setLocale: () => {},
  availableLocales: ['id'],
  getLocaleLabel: () => '',
  orgDefaultLocale: null,
  setOrgDefaultLocale: () => {},
});

interface LocaleProviderProps {
  children: ReactNode;
}

const STORAGE_KEY = 'oz-pos-locale';

/** Supported locale codes, ordered for lookup. */
const SUPPORTED_LOCALES: LocaleCode[] = ['en', 'id'];

/**
 * Resolve the initial locale for this session.
 *
 * 1. If the user previously chose a locale, restore it from localStorage.
 * 2. Otherwise, try to match the browser's preferred language(s) against
 *    the supported locales.
 * 3. Fall back to Indonesian (`'id'`) as the application default when no
 *    match is found.
 */
function resolveInitialLocale(): LocaleCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'id') return stored;

  if (typeof navigator !== 'undefined') {
    const languages = [navigator.language, ...(navigator.languages ?? [])];
    for (const lang of languages) {
      if (!lang) continue;
      const normalized = lang.toLowerCase();
      for (const code of SUPPORTED_LOCALES) {
        if (normalized.startsWith(code)) return code;
      }
    }
  }

  return 'id';
}

/**
 * The stored per-user override, or `null` when this browser profile has no
 * explicit language choice (slice 4: only then does the org default join
 * the negotiation — an explicit choice always wins).
 */
function storedUserLocale(): LocaleCode | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'id' ? stored : null;
}

/**
 * Narrow a raw BCP-47 tag (e.g. `id-ID` from the regional chain) to a
 * supported locale code by its primary subtag; `null` when the tag names
 * no locale this build ships a bundle for.
 */
function toSupportedLocale(raw: string | null): LocaleCode | null {
  if (!raw) return null;
  const primary = (raw.trim().toLowerCase().split('-')[0] ?? '').trim();
  return SUPPORTED_LOCALES.find((code) => code === primary) ?? null;
}

/**
 * Provides locale state and the Fluent localisation provider to the
 * component tree. Persists the user's choice to localStorage and
 * initialises from the stored value, the browser language, or the
 * application default (`'id'`).
 *
 * Negotiation order (regional slice 4, todo-global-saas-2.md slice queue #4):
 * stored per-user choice → org/entity default (pushed in by
 * `OrgLocaleSync` through one read of the slice-1 chain, never persisted)
 * → browser language → built-in `'id'`. A stored choice therefore keeps
 * winning over the org default, and the org default only reaches devices
 * whose profile never made an explicit choice.
 */
export function LocaleProvider({ children }: LocaleProviderProps) {
  // The explicit per-user choice: restored from localStorage at mount,
  // written by `setLocale`. `null` = this profile never chose.
  const [explicitLocale, setExplicitLocale] = useState<LocaleCode | null>(storedUserLocale);
  // Browser/boot resolution — the pre-slice-4 behavior (browser → 'id').
  const [initialLocale] = useState<LocaleCode>(resolveInitialLocale);
  // Org/entity default from the regional chain (slice 4); `null` when the
  // org has no usable default configured.
  const [orgDefaultLocale, setOrgDefaultLocaleState] = useState<LocaleCode | null>(null);

  const locale = explicitLocale ?? orgDefaultLocale ?? initialLocale;

  const bundle = useMemo(() => getBundle(locale), [locale]);

  const setLocale = useCallback((code: LocaleCode) => {
    setExplicitLocale(code);
    localStorage.setItem(STORAGE_KEY, code);
  }, []);

  const setOrgDefaultLocale = useCallback((raw: string | null) => {
    setOrgDefaultLocaleState(toSupportedLocale(raw));
  }, []);

  const l10n = useMemo(() => new ReactLocalization([bundle]), [bundle]);

  const value: LocaleContextValue = {
    locale,
    setLocale,
    availableLocales: getAvailableLocales(),
    getLocaleLabel,
    orgDefaultLocale,
    setOrgDefaultLocale,
  };

  return (
    <LocaleContext.Provider value={value}>
      <LocalizationProvider l10n={l10n}>
        {children}
      </LocalizationProvider>
    </LocaleContext.Provider>
  );
}
