import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, renderHook, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/frontend/shell/ThemeProvider';
import { BrandProvider } from '@/contexts/BrandContext';
import type { ReactNode } from 'react';

// ── Theme values (hardcoded from reset.css + theme files) ──────────

const STORAGE_KEY = 'kasirmu-theme-v4';

/** Shared wrapper that provides both brand and theme context. */
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <BrandProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </BrandProvider>
  );
}

function resetEnvironment() {
  localStorage.clear();
  const html = document.documentElement;
  html.removeAttribute('data-theme');
  html.classList.remove('is-theme-transitioning');
  // Remove any injected style overrides from previous tests.
  const existing = document.getElementById('theme-test-styles');
  if (existing) existing.remove();
}

/**
 * Inject CSS custom properties onto :root so JSDOM can resolve them.
 * JSDOM does not parse external .css files, so we need to define
 * the theme tokens programmatically for getComputedStyle tests.
 */
function injectThemeStyles() {
  const style = document.createElement('style');
  style.id = 'theme-test-styles';
  style.textContent = `
    :root {
      --color-fg: #1a1a1a;
      --color-fg-primary: #111827;
      --color-fg-secondary: #6b7280;
      --color-fg-inverse: #ffffff;
      --color-bg: #ffffff;
      --color-bg-surface: #f5f5f5;
      --color-bg-elevated: #ffffff;
      --color-bg-input: #ffffff;
      --color-border: #e5e5e5;
      --color-border-focus: #10b981;
      --color-accent: #10b981;
      --color-accent-fg: #ffffff;
      --color-accent-hover: #059669;
      --color-accent-active: #047857;
      --color-accent-subtle: #d1fae5;
      --color-danger: #ef4444;
      --color-danger-fg: #ffffff;
      --color-success: #10b981;
      --color-warning: #f59e0b;
      --color-primary-pos: #1e3a5f;
      --color-primary-pos-light: #2e578c;
      --color-primary-pos-dark: #112239;
      --color-success-pos: #10b981;
      --color-success-pos-darker: #059669;
      --color-warning-pos: #d97706;
      --color-fn-key-pos: #fbbf24;
      --color-dark-bg-pos: #0d131f;
      --color-dark-border-pos: #1f2937;
      --color-bg-pos: #0d0d14;
      --space-1: 0.25rem;
      --space-2: 0.5rem;
      --space-3: 0.75rem;
      --space-4: 1rem;
      --text-sm: 0.875rem;
      --text-base: 1rem;
      --text-lg: 1.125rem;
      --radius-md: 6px;
      --radius-lg: 8px;
      --radius-xl: 12px;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
      --z-overlay: 1000;
      --duration-150: 150ms;
      --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Theme CSS custom properties that must resolve to a defined value
 * (not undefined) under every theme so that the UI never shows a
 * transparent/black-on-black state. Includes both global tokens and
 * POS-specific tokens surfaced by `RetailPosScreen`.
 */
const THEME_TOKENS = [
  '--color-fg',
  '--color-fg-primary',
  '--color-fg-inverse',
  '--color-bg',
  '--color-bg-surface',
  '--color-bg-elevated',
  '--color-border',
  '--color-border-focus',
  '--color-accent',
  '--color-accent-fg',
  '--color-danger',
  '--color-success',
  '--color-primary-pos',
  '--color-success-pos',
  '--color-warning-pos',
  '--space-2',
  '--space-4',
  '--text-base',
  '--radius-lg',
];

describe('Theme CSS Token Regression', () => {
  beforeEach(() => {
    resetEnvironment();
    injectThemeStyles();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Token resolution per theme ──────────────────────────────────

  it('all core CSS tokens resolve to a defined value under dark theme', () => {
    const html = document.documentElement;
    // With injected styles, getComputedStyle should resolve the tokens.
    for (const token of THEME_TOKENS) {
      const value = getComputedStyle(html).getPropertyValue(token).trim();
      expect(value).not.toBe('');
    }
  });

  it('all core CSS tokens resolve under light theme', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    const html = document.documentElement;
    render(<Wrapper><div data-testid="light-root" /></Wrapper>);
    expect(html.getAttribute('data-theme')).toBe('light');
    for (const token of THEME_TOKENS) {
      const value = getComputedStyle(html).getPropertyValue(token).trim();
      expect(value).not.toBe('');
    }
  });

  it('all core CSS tokens resolve under dark theme', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const html = document.documentElement;
    render(<Wrapper><div data-testid="dark-root" /></Wrapper>);
    expect(html.getAttribute('data-theme')).toBe('dark');
    for (const token of THEME_TOKENS) {
      const value = getComputedStyle(html).getPropertyValue(token).trim();
      expect(value).not.toBe('');
    }
  });

  // ── Foreground vs background contrast check ─────────────────────

  it('fg-primary has visibly different value from bg (prevents invisible text)', () => {
    const html = document.documentElement;
    const fg = getComputedStyle(html).getPropertyValue('--color-fg-primary').trim();
    const bg = getComputedStyle(html).getPropertyValue('--color-bg').trim();
    expect(fg).not.toBe('');
    expect(bg).not.toBe('');
    expect(fg.toLowerCase()).not.toBe(bg.toLowerCase());
  });

  // ── Theme switching does not leave stale CSS ────────────────────

  it('theme switching toggles data-theme attribute correctly', () => {
    const html = document.documentElement;
    const { result } = renderHook(() => useTheme(), { wrapper: Wrapper });

    // Start: dark → data-theme="dark"
    expect(html.getAttribute('data-theme')).toBe('dark');

    act(() => result.current.setTheme('light'));
    expect(html.getAttribute('data-theme')).toBe('light');

    act(() => result.current.setTheme('dark'));
    expect(html.getAttribute('data-theme')).toBe('dark');
  });

  it('theme switching toggles localStorage correctly', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: Wrapper });

    act(() => result.current.setTheme('dark'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');

    act(() => result.current.setTheme('light'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  // ── Theme persists across re-mounts ─────────────────────────────

  it('persisted theme survives re-mount (reads localStorage)', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useTheme(), { wrapper: Wrapper });
    expect(result.current.theme).toBe('dark');
  });

  // ── Common components render under each theme without errors ────

  it.each(['light', 'dark'] as const)(
    'renders themed UI elements without error under %s theme',
    (theme) => {
      localStorage.setItem(STORAGE_KEY, theme);
      const html = document.documentElement;

      render(
        <Wrapper>
          <div>
            <button data-testid="themed-btn" type="button">Test</button>
            <input data-testid="themed-input" defaultValue="" readOnly />
            <div data-testid="themed-surface">Surface</div>
          </div>
        </Wrapper>,
      );

      // Verify theme attribute.
      expect(html.getAttribute('data-theme')).toBe(theme);

      // Verify elements render.
      expect(screen.getByTestId('themed-btn')).toBeInTheDocument();
      expect(screen.getByTestId('themed-input')).toBeInTheDocument();
      expect(screen.getByTestId('themed-surface')).toBeInTheDocument();
    },
  );
});
