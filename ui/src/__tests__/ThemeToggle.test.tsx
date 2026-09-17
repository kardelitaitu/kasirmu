import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';

import { ThemeProvider } from '@/app/ThemeProvider';
import { BrandProvider } from '@/contexts/BrandContext';
import ThemeToggle from '@/app/ThemeToggle';

function renderScreen() {
  return renderWithFluentSync(
    <BrandProvider>
      <ThemeProvider><ThemeToggle /></ThemeProvider>
    </BrandProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('ThemeToggle', () => {
  beforeEach(() => {
    const html = document.documentElement;
    html.removeAttribute('data-theme');
    html.classList.remove('is-theme-transitioning');

    window.matchMedia = vi.fn().mockImplementation((_query: string) => ({
      matches: false,
      media: _query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────

  it('renders a button with theme-toggle testid', () => {
    renderScreen();
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('theme-toggle').tagName).toBe('BUTTON');
  });

  it('renders a paint palette icon', () => {
    renderScreen();
    const button = screen.getByTestId('theme-toggle');
    const svgs = button.querySelectorAll('svg');
    expect(svgs.length).toBe(1);
    // Paint palette icon has a path and circle elements.
    expect(svgs[0]?.querySelector('path')).toBeInTheDocument();
    expect(svgs[0]?.querySelector('circle')).toBeInTheDocument();
  });

  // ── Accessibility ──────────────────────────────────────────────

  it('has an aria-label that reflects current theme', () => {
    renderScreen();
    const button = screen.getByTestId('theme-toggle');
    // Asserts on the user-visible substring (and SR-announced string),
    // not on Fluent's internal bidi-isolating marks U+2068/U+2069.
    // Production's `getBundle()` passes `useIsolating: false`, so the
    // aria-label is the literal plain string — no markers.
    expect(button).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Switch to light mode'),
    );
  });

  it('aria-label updates after toggling theme', async () => {
    renderScreen();
    const button = screen.getByTestId('theme-toggle');
    expect(button).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Switch to light mode'),
    );

    await userEvent.click(button); // default -> light

    expect(button).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Switch to dark mode'),
    );
  });

  // ── Interaction ────────────────────────────────────────────────

  it('clicking toggles the theme from default to light', async () => {
    renderScreen();
    const button = screen.getByTestId('theme-toggle');

    await userEvent.click(button);

    // After toggling to light, the document element should have data-theme="light".
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('clicking twice toggles to dark', async () => {
    renderScreen();
    const button = screen.getByTestId('theme-toggle');

    await userEvent.click(button); // default → light
    await userEvent.click(button); // light → dark

    // In dark mode: document element should have data-theme="dark".
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
