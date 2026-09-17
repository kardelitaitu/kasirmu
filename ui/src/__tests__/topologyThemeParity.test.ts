import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ADR #45 §5 — topology theme parity, as a gate rather than an inspection.
//
// The repo already has `themeTokenCompliance.test.ts`, and it is a good gate:
// baseline 0, no hardcoded colours or sizes. It also has three holes, and the
// topology canvas fell through all three.
//
//   1. Its COLOR_PROPERTIES set covers `color`, `background`, `border` — and
//      NOT `fill`, `stroke`, or `stop-color`. An SVG-heavy surface can therefore
//      hardcode `stroke: #fff` indefinitely and stay green. The topology editor
//      is exactly that surface: it had two such literals.
//   2. It never asks whether a token EXISTS. `var(--color-surface)` was used in
//      this file and is defined nowhere in the codebase, so the declaration was
//      invalid at computed-value time and `stroke` fell back to its CSS initial
//      — black, in both themes. A fallback is not insurance when the token is
//      a phantom: the fallback IS the rendered value, permanently.
//   3. It never asks whether a fallback is CORRECT. Audited here: not one of
//      the 28 hex fallbacks in this stylesheet matched the token it fell back
//      from. `--color-success` carried three different wrong greens;
//      `--text-xs` fell back to 0.75rem against a real 0.625rem.
//
// Reduced motion gets its own check too: the file has six
// `prefers-reduced-motion` blocks and one infinite animation that sat outside
// all of them.
//
// These are cheap, static, and mechanical. That is the point — §5's claim is
// that parity is a verification task, so it needs a verifier, not a review.

const CSS_PATH = resolve(__dirname, '../features/locations/NodeTopologyEditor.css');
const TOKENS_PATH = resolve(__dirname, '../theme/tokens.css');

const css = readFileSync(CSS_PATH, 'utf-8');
const tokens = readFileSync(TOKENS_PATH, 'utf-8');

/** Strip comments so a token named in prose never counts as a use. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Tokens written by JavaScript at runtime, so they are legitimately absent
 *  from the stylesheet until the first event. Each must state its default. */
const RUNTIME_TOKENS = new Set(['--mouse-x', '--mouse-y']);

/** Extract one top-level block's declarations from a stylesheet. */
function blockBody(source: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(source);
  if (!match) return '';
  const open = source.indexOf('{', match.index + match[0].length - 1);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

const rootBlock = blockBody(tokens, /:root\s*\{/);
const lightBlock = blockBody(tokens, /\[data-theme='light'\]\s*\{/);

function definedIn(block: string, token: string): boolean {
  return new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'm').test(block);
}

const usedTokens: string[] = [...new Set(
  [...code.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
)];

describe('topology theme parity (ADR #45 §5)', () => {
  it('parses the token stylesheet into theme blocks', () => {
    // If this fails, the assertions below would pass vacuously against empty
    // blocks — a gate that silently stops checking is worse than none.
    expect(rootBlock.length).toBeGreaterThan(500);
    expect(lightBlock.length).toBeGreaterThan(500);
  });

  it('uses only tokens that actually exist', () => {
    const phantom = usedTokens.filter(
      (token) => !RUNTIME_TOKENS.has(token) && !definedIn(rootBlock, token) && !definedIn(lightBlock, token),
    );
    expect(phantom, `undefined tokens render their fallback forever: ${phantom.join(', ')}`).toEqual([]);
  });

  it('carries no literal fallback over a token that is guaranteed', () => {
    // A literal fallback is a second palette nobody maintains. Where the token
    // exists, the fallback is dead weight that is wrong the moment it is used.
    const withFallback = [...code.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,\s*([^()]*)\)/g)]
      .flatMap((m) => (m[1] && m[2] ? [{ token: m[1], fallback: m[2].trim() }] : []))
      .filter(({ token, fallback }) => !RUNTIME_TOKENS.has(token) && !fallback.startsWith('var('));
    expect(
      [...new Set(withFallback.map(({ token, fallback }) => `${token} -> ${fallback}`))].sort(),
      'stale literal fallbacks found; run scripts/strip-topology-token-fallbacks.py',
    ).toEqual([]);
  });

  it('paints no SVG surface with a bare colour literal', () => {
    // The hole in themeTokenCompliance: it scans `color`/`background`/`border`
    // and not these. On a canvas made of SVG, that is where hardcoding hides.
    const offenders = [...code.matchAll(/\b(fill|stroke|stop-color|flood-color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/g)]
      .flatMap((m) => (m[0] ? [m[0].replace(/\s+/g, ' ')] : []));
    expect([...new Set(offenders)].sort(), `bare colour literals: ${offenders.join(', ')}`).toEqual([]);
  });

  it('gates every infinite animation behind prefers-reduced-motion', () => {
    // Walk the file tracking whether we are inside a reduced-motion block, and
    // require every `animation:` that repeats forever to be inside a
    // `no-preference` block. A `reduce` block that sets `animation: none` is
    // the other acceptable shape and is not what this looks for.
    const noPreferenceRanges: Array<[number, number]> = [];
    const walker = /@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{/g;
    let match: RegExpExecArray | null;
    while ((match = walker.exec(code)) !== null) {
      const open = match.index + match[0].length;
      let depth = 1;
      let i = open;
      while (i < code.length && depth > 0) {
        if (code[i] === '{') depth += 1;
        else if (code[i] === '}') depth -= 1;
        i += 1;
      }
      noPreferenceRanges.push([open, i]);
    }

    const ungated: string[] = [];
    for (const decl of code.matchAll(/\banimation\s*:\s*([^;]*infinite[^;]*)/g)) {
      const at = decl.index ?? 0;
      const inside = noPreferenceRanges.some(([start, end]) => at > start && at < end);
      if (!inside && decl[1]) ungated.push(decl[1].trim());
    }
    expect(ungated, `infinite animations outside a reduced-motion guard: ${ungated.join(' | ')}`).toEqual([]);
  });

  it('resolves every colour token it uses in the light theme too', () => {
    // A token defined only under `:root` with a dark value is the light-theme
    // bug this whole section exists to prevent. Either block may carry it, but
    // at least one must, and any token the light theme overrides must be
    // present there rather than inherited dark.
    const colourTokens = usedTokens.filter((t) => t.startsWith('--color-'));
    const unresolved = colourTokens.filter(
      (token) => !definedIn(rootBlock, token) && !definedIn(lightBlock, token),
    );
    expect(unresolved, `colour tokens with no definition: ${unresolved.join(', ')}`).toEqual([]);
  });

  it('keeps the wire and marker rings on the canvas colour, not white', () => {
    // The two literals §5 named. They separate a badge from what is behind it,
    // so they must BE the canvas colour; a literal #fff reads as a clean
    // punch-out on the dark canvas and vanishes on the light one.
    expect(code).toMatch(/\.wire-validation-marker\s*>\s*circle\s*\{[^}]*stroke:\s*var\(--color-bg\)/);
    expect(code).toMatch(/\.wire-bend-handle\s*\{[^}]*stroke:\s*var\(--color-bg\)/);
    expect(code).toMatch(/\.wire-validation-marker-text\s*\{[^}]*fill:\s*var\(--color-text-on-color\)/);
  });
});
