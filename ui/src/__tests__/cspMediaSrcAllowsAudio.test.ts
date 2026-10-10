// ── The shells' CSP must allow the audio the app actually plays (F39) ──
//
// Found on the tablet by reading the WebView console, not the source:
//
//   error [security]: Loading media from 'data:audio/mp3;base64,…' violates the
//   following Content Security Policy directive: "default-src 'self'". Note that
//   'media-src' was not explicitly set, so 'default-src' is used as a fallback.
//   The action has been blocked.
//
// WHY IT HAPPENS. `utils/interaction.ts:44` builds its audio URL with
// `new URL('../assets/sounds/' + filename, import.meta.url)`. `click.mp3` is
// 1,536 bytes — under Vite's 4 KB `assetsInlineLimit` — so the BUNDLER INLINES
// it as a `data:` URL. Both shells' policies name `data:` for `img-src` and
// `font-src` but had NO `media-src`, so audio fell back to `default-src 'self'`
// and was blocked.
//
// THE CONSEQUENCE IS A FEATURE THE MERCHANT TURNED ON. `pos.interaction_sound`
// and `restaurant.sound_chime` are both settings this plan wired and verified as
// read; with this policy the tap feedback and the order chime cannot play in a
// SHIPPED build. The failure is silent — a CSP block logs to a console nobody
// opens on a till — which is why it survived every source-reading round and
// surfaced only when the running app was inspected.
//
// WHY `data:` IS THE CORRECT WIDENING rather than disabling the inline limit:
// the asset is already bundled into the app; `data:` here cannot fetch anything
// off-device. `asset:` and `https://asset.localhost` are included to match
// `img-src`, so a future non-inlined sound resolves through Tauri's own protocol.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `__dirname` is ui/src/__tests__, so the repo root is three levels up.
const APPS_ROOT = resolve(__dirname, '..', '..', '..', 'apps');
const SHELL_CONFIGS = [
  { shell: 'desktop-tauri', file: join(APPS_ROOT, 'desktop-tauri', 'tauri.conf.json') },
  { shell: 'mobile-tauri', file: join(APPS_ROOT, 'mobile-tauri', 'tauri.conf.json') },
];
const CSP_KEYS = ['csp', 'devCsp'];

/**
 * The media-src clause every shell must carry.
 *
 * `'self'` covers a non-inlined asset served from the app origin; `data:` covers the
 * inlined small sounds the bundler produces; the two asset sources cover Tauri's own
 * protocol. Mirrors the `img-src` clause deliberately — images and audio take the same
 * route to the renderer, so a policy that names the sources for one and not the other
 * is an oversight rather than a decision.
 */
const MEDIA_SRC_PIN = "'self' data: asset: https://asset.localhost";

/** One directive out of a CSP string, by name, or null when the policy has none. */
function cspDirective(csp: string, name: string): string | null {
  for (const raw of csp.split(';')) {
    const d = raw.trim();
    if (d.split(/\s+/)[0] === name) return d.slice(name.length).trim();
  }
  return null;
}

interface Clause { shell: string; key: string; clause: string | null }

/** The media-src clause of every (shell, csp-key) pair that could be read. */
function shellMediaSrc(): Clause[] {
  const out: Clause[] = [];
  for (const s of SHELL_CONFIGS) {
    if (!existsSync(s.file)) continue;
    let sec: Record<string, unknown> = {};
    try {
      sec = JSON.parse(readFileSync(s.file, 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const app = (sec['app'] ?? {}) as Record<string, unknown>;
    const security = (app['security'] ?? {}) as Record<string, unknown>;
    for (const key of CSP_KEYS) {
      const policy = security[key];
      if (typeof policy !== 'string') continue;
      out.push({ shell: s.shell, key, clause: cspDirective(policy, 'media-src') });
    }
  }
  return out;
}

describe('the shell CSP admits the audio the app plays (F39)', () => {
  it('found all four policies (guards the guard)', () => {
    const rows = shellMediaSrc();
    // Two shells x two keys, exactly. A missing file, a renamed key, or a config that
    // stops parsing reduces this number, and a reduced population must not read clean.
    expect(
      rows.length,
      `only ${rows.length} of the 4 (shell, CSP-key) pairs could be read, so this rule ` +
        'would grade nothing:\n' + rows.map((r) => `  read: ${r.shell}.${r.key}`).join('\n'),
    ).toBe(4);
  });

  it('every shell names media-src with the sources its audio needs', () => {
    const drift = shellMediaSrc()
      .filter((r) => r.clause !== MEDIA_SRC_PIN)
      .map((r) => `  ${r.shell}.${r.key} -> ${r.clause === null ? 'NO media-src CLAUSE at all' : r.clause}`);
    expect(
      drift,
      `media-src is not "${MEDIA_SRC_PIN}" in every shell policy:\n` +
        drift.join('\n') +
        '\n\nWithout a media-src clause, audio falls back to default-src and a data: URL is ' +
        'BLOCKED — which is the observed failure. Small bundled sounds are inlined as data: ' +
        'by the bundler, so `data:` is required; see the file header for why that is not a ' +
        'widening beyond what is already bundled.',
    ).toEqual([]);
  });

  it('the pinned clause names the sources the bundler and Tauri actually produce', () => {
    // Guards the constant itself, so a future edit cannot quietly drop `data:` and
    // leave the rule passing against the narrowed value.
    for (const need of ["'self'", 'data:', 'asset:']) {
      expect(MEDIA_SRC_PIN, `the media-src pin lost ${need}`).toContain(need);
    }
  });
});