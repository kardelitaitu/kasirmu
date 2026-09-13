/* eslint-disable react-refresh/only-export-components */
// Vite React Refresh: force full remount on HMR to prevent stale
// ThemeContext mismatch in DevToolbar / StatusBar / RestaurantMenu.
/// @refresh reset
import {

  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useBrand } from '@/contexts/BrandContext';
import {
  deriveAccentPalette,
  applyAccentPalette,
  clearAccentPalette,
  applyThemeContrasts,
} from '@/utils/color';

// ── Types ──────────────────────────────────────────────────────────

/** Application colour-scheme theme — exactly two: light and dark. */
export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  /** Current resolved theme. */
  theme: Theme;
  /** Toggle between light and dark. */
  toggleTheme: () => void;
  /** Set a specific theme. */
  setTheme: (t: Theme) => void;
}

// ── Context ────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'oz-pos-theme-v4';

// ── Provider ───────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Provides the active theme and a toggle function to the component
 * tree. On first render it reads the persisted override from
 * `localStorage` and otherwise falls back to the default dark theme —
 * it deliberately does NOT follow the OS `prefers-color-scheme`,
 * because the default theme is itself dark regardless of the OS.
 *
 * Sets `data-theme` on `<html>` so the CSS theme selectors work
 * (`:root` is dark; `[data-theme='light']` overrides to light).
 * Legacy `oz-pos-theme-v4` values of `'default'` are migrated to
 * `'dark'` (the old glass default is gone — dark is now solid).
 * Also reactively applies the brand accent palette from BrandContext
 * whenever the primary colour changes.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // 1. Check localStorage (migrate legacy 'default' → 'dark')
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light') return 'light';
    if (stored === 'dark') return 'dark';
    if (stored === 'default') return 'dark'; // legacy glass default → solid dark
    // 2. Fall back to dark theme
    return 'dark';
  });

  // Sync `data-theme` attribute and localStorage whenever theme changes.
  // Also applies a brief transitioning class so CSS can animate the switch.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const html = document.documentElement;

    // Add transitioning class to animate the theme change.
    html.classList.add('is-theme-transitioning');
    html.setAttribute('data-theme', theme);

    localStorage.setItem(STORAGE_KEY, theme);

    // Remove the class after transitions complete so subsequent
    // color changes (hover, focus) don't animate.
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      html.classList.remove('is-theme-transitioning');
      timeoutRef.current = null;
    }, 300);

    // Reconcile foreground contrast colours after theme change.
    requestAnimationFrame(() => applyThemeContrasts());

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [theme]);


  // Reactively apply brand accent palette whenever brand settings change.
  // An empty primary_colour is the "follow the active theme" sentinel: no
  // inline override, so the per-theme tokens (light #147EFB, dark
  // #1155CC) show through.
  const { settings: brandSettings } = useBrand();
  const brandColour = brandSettings.primary_colour;
  useEffect(() => {
    if (brandColour) {
      const palette = deriveAccentPalette(brandColour);
      applyAccentPalette(palette);
    } else {
      clearAccentPalette();
    }
    // Reconcile foreground contrasts when brand colour (or any theme token) changes.
    requestAnimationFrame(() => applyThemeContrasts());
  }, [brandColour]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────

/**
 * Access the current theme and toggle function.
 * Must be called within a `<ThemeProvider>`.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

/**
 * Access the current theme and toggle function safely outside a ThemeProvider.
 * Returns `null` when no ThemeProvider wraps the calling tree.
 */
export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
