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

// ── Theme is decided before first paint ─────────────────────────────
//
// The inline script in each entry promises "restore saved theme before
// first paint to prevent theme flash". It could never work: it read
// 'oz-pos-theme-v4', the LEGACY key that ThemeProvider migrates FROM and
// then DELETES on load, while the app writes 'kasirmu-theme-v4'. So the
// attribute was never set, the CSS fell through to prefers-color-scheme,
// and a light-OS machine running the app in dark theme painted a WHITE
// frame before the dark splash. These assertions pin the contract.

describe.each(HTML_ENTRIES)('%s pre-paint theme', (entry) => {
  const html = readFileSync(resolve(UI_ROOT, entry), 'utf-8');

  it('reads the key the app actually writes', () => {
    expect(html).toContain("localStorage.getItem('kasirmu-theme-v4')");
  });

  it('still migrates the legacy key it replaced', () => {
    // Existing installs have their choice under the old key until
    // ThemeProvider migrates it, so the boot script must read both.
    expect(html).toContain("localStorage.getItem('oz-pos-theme-v4')");
  });

  it('always sets data-theme, so prefers-color-scheme cannot disagree', () => {
    // Every branch assigns the attribute. Leaving it unset on "nothing
    // stored" is what let the OS override the app's dark default.
    const sets = (html.match(/setAttribute\('data-theme'/g) ?? []).length;
    expect(sets).toBeGreaterThanOrEqual(3);
  });

  it('does not leave the OS to decide the theme', () => {
    // A prefers-color-scheme branch here would be a second, competing
    // answer to a question the script above has already settled.
    expect(html).not.toContain('@media (prefers-color-scheme: light)');
  });
});

// ── The static splash paints its own themed background ──────────────

describe.each(HTML_ENTRIES)('%s splash background', (entry) => {
  const html = readFileSync(resolve(UI_ROOT, entry), 'utf-8');

  it('gives .app-splash a background instead of relying on <body>', () => {
    expect(staticSplashRule(html)).toContain('background-color');
  });

  it('paints a light background for a light-themed first frame', () => {
    expect(html).toMatch(/html\[data-theme="light"\] \.app-splash\s*\{[^}]*#ffffff/);
  });
});

// ── The boot frame cannot scroll ────────────────────────────────────
//
// The splash is `position: fixed; inset: 0`, so it is exactly
// viewport-sized. If the document is any taller, the scrollbar renders
// OVER the splash — which is what a "scrollbar on the splash screen"
// was. The desktop entry had it and the mobile entry did not: the
// desktop sized html, body AND #root with `min-height: 100dvh`, three
// independent viewport minimums that stacked into a document taller
// than the window. Both entries now pin height and clamp the axis.

describe.each(HTML_ENTRIES)('%s boot frame', (entry) => {
  const html = readFileSync(resolve(UI_ROOT, entry), 'utf-8');

  it('clamps document overflow, so no scrollbar can cross the splash', () => {
    const base = html.slice(0, html.indexOf('.app-splash {'));
    expect(base).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/);
  });

  it('pins the document with height, not a stack of min-heights', () => {
    // Inspect DECLARATIONS only. The comments above these rules quote the
    // removed `min-height: 100dvh` while explaining why it went, so a plain
    // substring search over the file would match prose and fail forever.
    const base = html.slice(0, html.indexOf('.app-splash {'));
    // Strip /* ... */ blocks (including multi-line ones) before searching:
    // the surviving comments quote the removed declaration while explaining
    // why it went.
    const declarations = base.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).not.toContain('min-height: 100dvh');
  });

  it('sizes #root to the frame rather than to the viewport', () => {
    expect(html).toMatch(/#root\s*\{[^}]*height:\s*100%/);
  });
});
