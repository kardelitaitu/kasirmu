// Step E (audit docs/2026-07-28-retail-pos-theming-audit.md):
// anti-regression source-grep guard for `RetailPosScreen.tsx`. The
// shadow-theme anti-pattern that caused the audit combined four
// typed-of-mistakes — a local-only `useState<'light' | 'dark'>`
// initialised from an opted-out localStorage key, a one-shot
// `prefers-color-scheme` read, an underscore-prefixed dead setter, and
// a missing import from the global `ThemeProvider` family. This file
// fails loudly if any of the four reappear, AND asserts the positive
// consumer pattern is still wired, so a future refactor that drops
// the global theme coupling fails in the other direction too.
//
// We deliberately run in the default happy-dom env (NOT node), because
// the project-wide test-setup.ts calls `localStorage.clear()` in a
// beforeEach and that would ReferenceError in a pure-node env. We
// lazy-import `node:fs` and `node:path` inside a per-test helper so
// the global setup runs first and the imports stay out of the env
// resolution path.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Vite-virtual-ESM-URL workaround: vitest transforms .tsx test files
// under a virtual URL (e.g. /@vite-stub/…), so
// `new URL('<rel>', import.meta.url).pathname` resolves against the
// virtual directory rather than the on-disk one. The path via
// `path.resolve(__dirname, …)` resolves against the real on-disk
// location because vitest polyfills `__dirname` for .tsx test files.
const SOURCE_PATH = path.resolve(
  __dirname,
  '../features/retail/RetailPosScreen.tsx',
);

describe('Theme audit Step E — RetailPosScreen anti-pattern guard', () => {
  // Re-read on every test so that any change to the source file is
  // picked up by re-running this suite without a manual cache flush.
  const readSource = () => fs.readFileSync(SOURCE_PATH, 'utf-8');

  it('does not reintroduce the shadow localStorage key "retail-theme" (P0-3)', () => {
    const source = readSource();
    expect(source).not.toContain("'retail-theme'");
    expect(source).not.toContain('"retail-theme"');
  });

  it('does not reintroduce the dead underscore-prefixed `_setTheme` setter (P2-6)', () => {
    const source = readSource();
    // Narrow to exactly `_setTheme` — the audit's specific finding.
    // A broader `_set[A-Z]\w*` pattern would false-positive on
    // unrelated underscore-prefixed helpers.
    expect(source).not.toMatch(/_setTheme\b/);
  });

  it('does not reintroduce a light/dark-narrowed theme useState (P0-1)', () => {
    const source = readSource();
    // The original shadow state was `useState<'light' | 'dark'>`
    // matched against the bare TS type-literal form (no surrounding
    // string-quotes on the literal names themselves). We deliberately
    // do NOT also assert `prefers-color-scheme` is absent in isolation
    // — legitimate future features (auto-detect system theme, dark-
    // mode schedule, accessibility preference override) may use
    // `matchMedia('(prefers-color-scheme: dark)')` without recreating
    // the shadow-state anti-pattern. The audit's harmful shape was
    // the combination of the narrowed `useState` + a one-shot media
    // query; the runtime-only useState check suffices to catch
    // reintroduction of the anti-pattern.
    expect(source).not.toMatch(/useState<\s*'light'\s*\|\s*'dark'\s*>/);
  });

  it('consumes the global ThemeProvider family (P2-7 closure)', () => {
    const source = readSource();
    // Positive assertion — confirms we are still wired to the global
    // theme. Drop this if the consumer is intentionally rewired.
    const hasImport = /import\s+\{[^}]*(?:useTheme|useOptionalTheme)[^}]*\}\s+from\s+['"]@\/app\/ThemeProvider['"]/.test(
      source,
    );
    expect(hasImport).toBe(true);
  });
});
