// ── Shadow-token liveness ──────────────────────────────────────────
//
// A `--shadow-*` token that describes real geometry and then sets alpha to 0 claims a
// shadow and paints nothing. That is different from `--shadow-glow: none`, which is a
// self-consistent reset, and from `--space-0: 0` / `--tracking-normal: 0`, where zero IS
// the correct value.
//
// WHY THIS IS NOT ALREADY COVERED
//
// themeTokenCompliance.test.ts walks every CSS file and skips tokens.css on purpose -- it
// polices the DEFINITION sites' consumers, not the definitions. So no gate ever looked at
// whether a token's own value can render. --shadow-xs has been `0 0 12px rgba(...,0.00)` in
// both themes for as long as it has existed, referenced by four stylesheets, and nothing
// noticed.
//
// WHY A TEST AND NOT A FIX
//
// Changing --shadow-xs alters the appearance of .card--shadow-xs, the cart line items and
// the cart footer totals. Zeroing the alpha may have been a deliberate "disable this shadow
// but keep the hook" move. That is a design call, not a lintable fact, so the known case is
// recorded below and the gate prevents NEW ones. If you decide --shadow-xs should render,
// give it a real alpha and delete its entry from KNOWN_ZERO_ALPHA_SHADOW_TOKENS.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Vitest's cwd is ui/, not ui/src/ -- the same reason storageKeyPins.test.ts resolves 'src'.
const TOKENS_PATH = path.resolve(process.cwd(), 'src/frontend/themes/tokens.css');

/**
 * Tokens with a documented reason to paint nothing.
 *
 * `--shadow-xs` is the bug this file was written to record: geometry present, alpha 0.00,
 * in BOTH the light (L202) and dark (L425) theme blocks, used by
 * features/sales/CartPanel.brand.css, CartPanelFooterTotals.css, CartPanelLineItem.css and
 * `.card--shadow-xs` in frontend/themes/components.css.
 */
const KNOWN_ZERO_ALPHA_SHADOW_TOKENS = ['--shadow-xs'];

/** `none` / `transparent` are honest resets, not this bug. */
const RESET_VALUES = new Set(['none', 'transparent', 'inherit', 'unset', 'initial']);

type TokenDef = { name: string; value: string; line: number };

function parseShadowTokens(text: string): TokenDef[] {
  // One pass carrying the line number, rather than a second indexOf() lookup: --shadow-xs is
  // defined twice (light and dark theme blocks) and indexOf would report the first line for
  // both, pointing the failure message at the wrong theme.
  return text.split('\n').flatMap((line, i) => {
    const m = /^\s*(--shadow[\w-]*)\s*:\s*([^;]+)/.exec(line);
    if (!m) return [];
    const name = m[1];
    const value = m[2];
    if (name === undefined || value === undefined) return [];
    return [{ name, value: value.trim(), line: i + 1 }];
  });
}

/** True when the value has real shadow geometry but every alpha channel is zero. */
function isZeroAlphaShadow(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (RESET_VALUES.has(v)) return false;
  const alphas = [...v.matchAll(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/g)].map((m) => m[1]);
  if (alphas.length === 0) return false;
  const allZero = alphas.every((a) => Number(a) === 0);
  const hasGeometry = /\d+px/.test(v);
  return allZero && hasGeometry;
}

describe('shadow token liveness', () => {
  const text = fs.readFileSync(TOKENS_PATH, 'utf8');
  const defs = parseShadowTokens(text);

  it('finds shadow tokens to check (a broken parser would pass vacuously)', () => {
    expect(defs.length).toBeGreaterThan(10);
  });

  it('flags every zero-alpha shadow token by name, so the list cannot grow quietly', () => {
    const offenders = [...new Set(defs.filter((d) => isZeroAlphaShadow(d.value)).map((d) => d.name))]
      .sort();
    expect(offenders).toEqual([...KNOWN_ZERO_ALPHA_SHADOW_TOKENS].sort());
  });

  it('every other shadow token actually paints', () => {
    const broken = defs
      .filter((d) => !KNOWN_ZERO_ALPHA_SHADOW_TOKENS.includes(d.name))
      .filter((d) => isZeroAlphaShadow(d.value))
      .map((d) => `${d.name} (L${d.line}): ${d.value}`);
    expect(broken, `Shadow tokens that claim geometry and render nothing:\n  ${broken.join('\n  ')}`)
      .toEqual([]);
  });

  // The unit of the rule, checked directly: without this, a parser regression that found no
  // definitions at all would make the two tests above pass for the wrong reason.
  it('classifies the shapes correctly', () => {
    expect(isZeroAlphaShadow('0 0 12px rgba(16,24,40,0.00)')).toBe(true);
    expect(isZeroAlphaShadow('0 0 12px rgba(16,24,40,0.10)')).toBe(false);
    expect(isZeroAlphaShadow('0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.1)')).toBe(false);
    expect(isZeroAlphaShadow('none')).toBe(false);            // honest reset
    expect(isZeroAlphaShadow('transparent')).toBe(false);     // honest reset
    expect(isZeroAlphaShadow('0 0 0 0 rgba(34,197,94,0.3)')).toBe(false); // keyframe start
    expect(isZeroAlphaShadow('inset 0 2px 4px rgba(0,0,0,0.40)')).toBe(false);
  });
});
