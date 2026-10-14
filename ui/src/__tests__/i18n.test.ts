/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
/**
 * Tests for `ui/src/i18n/index.ts` — Fluent bundle construction, locale
 * availability, and locale label keys.
 *
 * The module loads every FTL domain for both locales at import time and
 * caches one FluentBundle per locale. The key contracts:
 * - both locales build a bundle with zero Fluent parse errors
 * - the bundle exposes the expected message ids (spot checks)
 * - available locales and label keys are stable
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FluentBundle } from '@fluent/bundle';
import { getBundle, getAvailableLocales, getLocaleLabel, type LocaleCode } from '@/i18n/index';

describe('getBundle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a FluentBundle for English with no parse errors', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bundle = getBundle('en');
    expect(bundle).toBeInstanceOf(FluentBundle);
    expect(bundle.locales).toContain('en');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('builds a FluentBundle for Indonesian with no parse errors', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bundle = getBundle('id');
    expect(bundle).toBeInstanceOf(FluentBundle);
    expect(bundle.locales).toContain('id');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns the same cached bundle instance for repeated calls', () => {
    expect(getBundle('en')).toBe(getBundle('en'));
    expect(getBundle('id')).toBe(getBundle('id'));
  });

  it('exposes known message ids from the shared domain', () => {
    const bundle = getBundle('en');
    // Spot-check ids that exist across the joined domains.
    for (const id of ['save', 'cancel', 'close', 'retry', 'loading']) {
      expect(bundle.hasMessage(id), `en bundle missing ${id}`).toBe(true);
    }
  });

  it('exposes the same ids in the Indonesian bundle', () => {
    const bundle = getBundle('id');
    for (const id of ['save', 'cancel', 'close', 'retry', 'loading']) {
      expect(bundle.hasMessage(id), `id bundle missing ${id}`).toBe(true);
    }
  });

  it('resolves a message from a domain joined after the first', () => {
    // sales.ftl is the 2nd domain in the join — proves multi-domain merge.
    const bundle = getBundle('en');
    expect(bundle.hasMessage('sales-report-title')).toBe(true);
  });

  it('returns a usable string for a known id', () => {
    const bundle = getBundle('en');
    const msg = bundle.getMessage('save');
    expect(msg).toBeTruthy();
  });
});

describe('getAvailableLocales', () => {
  it('returns exactly the supported locale codes in order', () => {
    expect(getAvailableLocales()).toEqual(['en', 'id']);
  });
});

describe('getLocaleLabel', () => {
  it.each<[LocaleCode, string]>([
    ['en', 'locale-en'],
    ['id', 'locale-id'],
  ])('maps %s to its Fluent label key', (code, expected) => {
    expect(getLocaleLabel(code)).toBe(expected);
  });

  it('is total over the supported locales', () => {
    for (const code of getAvailableLocales()) {
      expect(getLocaleLabel(code)).toMatch(/^locale-/);
    }
  });
});
