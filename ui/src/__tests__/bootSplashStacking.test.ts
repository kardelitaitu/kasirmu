/**
 * Boot-splash stacking parity across the two stages.
 *
 * The boot splash has two stages that are supposed to be visually
 * identical: the static markup in the HTML entries (painted before any JS
 * runs) and the React stage (components/AppBootSplash.tsx). Both HTML
 * files carry a comment promising to "keep values in sync with the React
 * stage" — but nothing enforced it, and the promise had already drifted:
 * the React stage set `z-index: var(--z-splash)` while both static stages
 * set no z-index at all.
 *
 * Why that is a correctness gap and not cosmetics. A positioned element
 * with `z-index: auto` participates in the normal paint order, so it
 * loses to ANY later sibling that establishes a stacking context. During
 * the static stage neither entry has such a sibling, so the bug is latent
 * — which is exactly why it survived. Add a dev overlay or a Tauri drag
 * region after #boot-splash and the splash silently ends up underneath
 * it, with no test failing.
 *
 * These assertions therefore pin the property, not the current markup: if
 * someone reorders the body or drops the z-index again, this fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const UI_ROOT = resolve(__dirname, '..', '..');

/** Both shipped boot documents. A fix to one is a fix to neither. */
const HTML_ENTRIES = ['index.html', 'index.mobile.html'] as const;

/** The static splash block, from its opening rule to its closing brace. */
function staticSplashRule(html: string): string {
  const start = html.indexOf('.app-splash {');
  expect(start, '.app-splash rule is missing from the entry').toBeGreaterThan(-1);
  const end = html.indexOf('}', start);
  return html.slice(start, end);
}

describe.each(HTML_ENTRIES)('%s boot splash', (entry) => {
  const html = readFileSync(resolve(UI_ROOT, entry), 'utf-8');

  it('gives the static splash the same top-of-stack z-index as the React stage', () => {
    const rule = staticSplashRule(html);
    expect(rule).toContain('position: fixed');
    // The React stage uses var(--z-splash) (components.css). The static
    // stage must resolve to the same value, with a literal fallback
    // because tokens.css has not loaded when this rule first paints.
    expect(rule).toContain('z-index: var(--z-splash, 700)');
  });

  it('places the splash BEFORE #root, so React cannot paint over it', () => {
    // Paint order is the second half of the guarantee: with equal
    // z-index the later sibling wins, and #root holds the whole app.
    const splashAt = html.indexOf('id="boot-splash"');
    const rootAt = html.indexOf('id="root"');
    expect(splashAt, 'boot-splash node is missing').toBeGreaterThan(-1);
    expect(rootAt, 'root node is missing').toBeGreaterThan(-1);
    expect(splashAt).toBeLessThan(rootAt);
  });
});

// ── Light-theme first paint ─────────────────────────────────────────
//
// The static stage must paint the CORRECT background in light theme. It
// did not: the dark rule is `html, body`, while the light override named
// only `html` — and `html[data-theme="light"]` (0,1,1) outranks the
// dark `html, body` (0,0,1) on <html> alone, so <body> kept the dark
// gradient. A light-themed install therefore painted a dark first frame
// and then flipped to the white React splash: the flash this pins shut.

describe.each(HTML_ENTRIES)('%s light-theme first paint', (entry) => {
  const html = readFileSync(resolve(UI_ROOT, entry), 'utf-8');

  it('paints a light background on BODY, not just on <html>', () => {
    // The selector list must include a body selector under the light
    // attribute; `html[data-theme="light"]` alone leaves body dark.
    expect(html).toMatch(
      /html\[data-theme="light"\]\s*,\s*html\[data-theme="light"\]\s+body\s*\{/,
    );
  });

  it('still declares the dark base for both html and body', () => {
    // The counterpart: the dark rule is what the light one must out-scope.
    expect(html).toMatch(/html,\s*body\s*\{/);
  });
});

// ── Splash lifetime (the crossfade's precondition) ──────────────────
//
// `useSplashExit` fades the splash out over 200ms. That only works if
// the SAME element stays mounted across the `loading` flip. Both shells
// used to render the splash from two places — an early `if (loading)
// return <AppBootSplash />`, and the fragment below — so React unmounted
// the booting splash and mounted a fresh one, and the fade applied to a
// splash the user had never seen. These assertions keep one render site.

const SHELLS = [
  'src/app/AppShell.tsx',
  'src/app/tablet/TabletAppShell.tsx',
] as const;

describe.each(SHELLS)('%s splash lifetime', (shell) => {
  const src = readFileSync(resolve(UI_ROOT, shell), 'utf-8');

  it('has exactly one <AppBootSplash> render site', () => {
    // Count only real JSX usage: `{` ... `<AppBootSplash`. A prose mention
    // in a comment (which both shells now carry, explaining this very rule)
    // must not register as a second mount.
    const mounts = src.match(/\{\s*splashMounted && <AppBootSplash/g) ?? [];
    expect(mounts).toHaveLength(1);
  });

  it('does not render the splash from any other branch', () => {
    // Anything else that mounts it is a second site, whichever shape it takes.
    const allSites = (src.match(/<AppBootSplash/g) ?? []).length;
    const commentMentions = (src.match(/^\s*(\/\/|\*).*<AppBootSplash/gm) ?? []).length;
    expect(allSites - commentMentions).toBe(1);
  });

  it('does not early-return the splash (which would remount it)', () => {
    expect(src).not.toMatch(/if \(loading\)\s*\{[^}]*return <AppBootSplash/);
  });

  it('gates the shell content on !loading instead, so it mounts behind the splash', () => {
    expect(src).toContain('{!loading && renderActiveView()}');
  });
});
