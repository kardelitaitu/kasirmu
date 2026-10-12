/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── i18n stray-attribute-syntax guard ────────────────────────────────
//
// Fluent attributes are declared on INDENTED lines:
//
//     key =
//         .aria-label = Label
//
// A message written on a SINGLE line as `key = .aria-label = Label` is
// NOT an attribute — Fluent parses it as a literal text VALUE equal to
// `.aria-label = Label`. Since these `-aria` keys are consumed with
// `l10n.getString(id)` (which returns the message VALUE, never its
// attributes), the rendered `aria-label` was literally the string
// `.aria-label = Label` — the broken prefix leaked into the UI and
// screen readers.
//
// This test parses the real production bundles and fails if any message
// VALUE still starts with a `.`-attribute marker. It also pins the
// `update-banner-*-aria` keys as plain values in BOTH locales: they are
// read via `getString`, so an attribute-only Indonesian translation
// would render the raw key id instead of the translated text.
import { describe, it, expect } from 'vitest';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import sharedEn from '@/locales/shared.ftl?raw';
import sharedId from '@/locales/shared.id.ftl?raw';
import reportsEn from '@/locales/reports.ftl?raw';
import reportsId from '@/locales/reports.id.ftl?raw';

/**
 * Return every `{ key, value }` whose formatted message VALUE still
 * begins with a stray attribute marker (`.<name> = …`), i.e. keys that
 * were written with the invalid single-line attribute syntax.
 */
function scanStrayAttributes(ftl: string): Array<{ key: string; value: string }> {
  const bundle = new FluentBundle('en', { useIsolating: false });
  bundle.addResource(new FluentResource(ftl));
  const out: Array<{ key: string; value: string }> = [];
  for (const line of ftl.split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
    if (!m || !m[1]) continue;
    const msg = bundle.getMessage(m[1]);
    if (!msg?.value) continue;
    const value = bundle.formatPattern(msg.value, null, []);
    if (/^\.\w+\s*=/.test(value)) out.push({ key: m[1], value });
  }
  return out;
}

/** Assert `key` has a plain (non-null) message value in `ftl`. */
function plainValue(ftl: string, key: string): string {
  const bundle = new FluentBundle('en', { useIsolating: false });
  bundle.addResource(new FluentResource(ftl));
  const msg = bundle.getMessage(key);
  expect(msg, `key "${key}" must exist`).toBeDefined();
  expect(
    msg?.value,
    `key "${key}" must be a plain value, not an attribute-only message`,
  ).not.toBeNull();
  return bundle.formatPattern(msg!.value!, null, []);
}

describe('i18n stray attribute syntax', () => {
  it('shared.ftl has no message value that starts with a `.attr =` marker', () => {
    expect(scanStrayAttributes(sharedEn)).toEqual([]);
  });

  it('shared.id.ftl has no message value that starts with a `.attr =` marker', () => {
    expect(scanStrayAttributes(sharedId)).toEqual([]);
  });

  it('reports.ftl has no message value that starts with a `.attr =` marker', () => {
    expect(scanStrayAttributes(reportsEn)).toEqual([]);
  });

  it('reports.id.ftl has no message value that starts with a `.attr =` marker', () => {
    expect(scanStrayAttributes(reportsId)).toEqual([]);
  });
});

describe('i18n update-banner aria keys are plain values (getString consumers)', () => {
  const KEYS = ['update-banner-install-aria', 'update-banner-installing-aria', 'update-banner-backing-up-aria'];

  it('every key resolves as a plain value in English', () => {
    for (const key of KEYS) {
      expect(plainValue(sharedEn, key), key).not.toContain('.aria-label');
    }
  });

  it('every key resolves as a plain value in Indonesian', () => {
    for (const key of KEYS) {
      expect(plainValue(sharedId, key), key).not.toContain('.aria-label');
    }
  });
});
