/**
 * KDS Colours Context.
 *
 * Provides per-theme card colours to all KDS components.
 * The hamburger panel updates colours; ticket cards read them.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useOptionalTheme } from '@/app/ThemeProvider';
import {
  DEFAULT_COLORS_DARK,
  DEFAULT_COLORS_LIGHT,
  type KdsCardColors,
} from '@/features/kds/kdsCardColors';

interface KdsCardColorsContextValue {
  colors: KdsCardColors;
  updateColor: (key: keyof KdsCardColors, value: string) => void;
  resetColors: () => void;
}

const KdsCardColorsContext = createContext<KdsCardColorsContextValue | null>(null);

/** Exported so tests assert against the real key rather than a second copy of the string. */
export const STORAGE_KEY = 'kds-card-colors-v1';

/**
 * Exported for testing. KdsCardColorsLoadColors.test.ts previously redeclared this
 * function, STORAGE_KEY and both default palettes locally and imported nothing from this
 * module, so it validated a private reimplementation. The palettes happen to still match
 * kdsCardColors.ts key for key -- which is exactly the state in which drift is invisible:
 * editing a colour in production would leave the suite green while testing values nothing
 * uses.
 */
export function loadColors(theme: string): KdsCardColors {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const all = JSON.parse(saved) as Record<string, KdsCardColors>;
      return all[theme] ?? (theme === 'light' ? DEFAULT_COLORS_LIGHT : DEFAULT_COLORS_DARK);
    }
  } catch {
    // Fall back to default colors if storage is unreadable or malformed.
  }
  return theme === 'light' ? DEFAULT_COLORS_LIGHT : DEFAULT_COLORS_DARK;
}

export function saveColors(theme: string, colors: KdsCardColors): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const all = saved ? JSON.parse(saved) as Record<string, KdsCardColors> : {};
    all[theme] = colors;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage write errors (e.g. private browsing or storage quota).
  }
}

/** Provider for KDS card colours — wraps the KDS screen. */
export function KdsCardColorsProvider({ children }: { children: React.ReactNode }) {
  const themeCtx = useOptionalTheme();
  const theme = themeCtx?.theme ?? 'dark';
  const [colors, setColors] = useState<KdsCardColors>(() => loadColors(theme));

  // Re-sync when theme changes.
  useEffect(() => {
    setColors(loadColors(theme));
  }, [theme]);

  const updateColor = useCallback(
    (key: keyof KdsCardColors, value: string) => {
      setColors((prev) => {
        const next = { ...prev, [key]: value };
        saveColors(theme, next);
        return next;
      });
    },
    [theme],
  );

  const resetColors = useCallback(() => {
    const defaults = theme === 'light' ? DEFAULT_COLORS_LIGHT : DEFAULT_COLORS_DARK;
    setColors(defaults);
    saveColors(theme, defaults);
  }, [theme]);

  return (
    <KdsCardColorsContext.Provider value={{ colors, updateColor, resetColors }}>
      {children}
    </KdsCardColorsContext.Provider>
  );
}

/** Hook to access KDS card colours. Falls back to dark defaults outside a provider. */
export function useKdsCardColors(): KdsCardColorsContextValue {
  const ctx = useContext(KdsCardColorsContext);
  if (ctx) return ctx;
  return {
    colors: DEFAULT_COLORS_DARK,
    updateColor: () => {},
    resetColors: () => {},
  };
}
