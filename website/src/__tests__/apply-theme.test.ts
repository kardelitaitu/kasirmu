// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tests for Base.astro applyTheme inline script.
 *
 * The script reads localStorage.kasirmu_theme and applies it to
 * document.documentElement.dataset.theme before first paint.
 * It also re-applies on astro:after-swap for SPA navigation.
 *
 * Dark is the default; light is the fallback.
 *
 * Migration: reads legacy `oz_theme` key, copies to `kasirmu_theme`,
 * and removes the legacy key on first run.
 */

const LAYOUT_SRC = readFileSync(
  join(__dirname, '../layouts/Base.astro'),
  'utf-8'
);

function extractApplyThemeScript(): string {
  const match = LAYOUT_SRC.match(
    /<script is:inline>\s*\(\(\)\s*=>\s*\{([\s\S]*?)\}\)\(\);\s*<\/script>/
  );
  if (!match) throw new Error('Could not extract applyTheme script from Base.astro');
  return match[1].trim();
}

function injectScript(body: string): void {
  const script = document.createElement('script');
  script.textContent = `(() => { ${body} })();`;
  document.body.appendChild(script);
}

describe('Base.astro applyTheme', () => {
  describe('source structure', () => {
    it('has applyTheme function', () => {
      expect(LAYOUT_SRC).toContain('applyTheme');
    });

    it('reads localStorage.kasirmu_theme', () => {
      expect(LAYOUT_SRC).toContain("localStorage.getItem('kasirmu_theme')");
    });

    it('sets document.documentElement.dataset.theme', () => {
      expect(LAYOUT_SRC).toContain('document.documentElement.dataset.theme');
    });

    it('defaults to light when localStorage is empty', () => {
      expect(LAYOUT_SRC).toContain("=== 'dark' ? 'dark' : 'light'");
    });

    it('calls applyTheme immediately', () => {
      expect(LAYOUT_SRC).toContain('applyTheme();');
    });

    it('registers astro:after-swap listener', () => {
      expect(LAYOUT_SRC).toContain("astro:after-swap");
    });
  });

  describe('theme application behavior', () => {
    beforeEach(() => {
      document.documentElement.removeAttribute('data-theme');
      localStorage.clear();
      document.body.innerHTML = '';
    });

    it('applies dark theme when localStorage has "dark"', () => {
      localStorage.setItem('kasirmu_theme', 'dark');
      const script = extractApplyThemeScript();
      injectScript(script);
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('applies light theme when localStorage has "light"', () => {
      localStorage.setItem('kasirmu_theme', 'light');
      const script = extractApplyThemeScript();
      injectScript(script);
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('defaults to light when localStorage is empty', () => {
      const script = extractApplyThemeScript();
      injectScript(script);
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('defaults to light when localStorage has unknown value', () => {
      localStorage.setItem('kasirmu_theme', 'blue');
      const script = extractApplyThemeScript();
      injectScript(script);
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('overwrites existing theme on page load', () => {
      document.documentElement.dataset.theme = 'dark';
      localStorage.setItem('kasirmu_theme', 'light');
      const script = extractApplyThemeScript();
      injectScript(script);
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('migrates legacy oz_theme key to kasirmu_theme', () => {
      localStorage.setItem('oz_theme', 'dark');
      const script = extractApplyThemeScript();
      injectScript(script);
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(localStorage.getItem('kasirmu_theme')).toBe('dark');
      expect(localStorage.getItem('oz_theme')).toBeNull();
    });
  });
});
