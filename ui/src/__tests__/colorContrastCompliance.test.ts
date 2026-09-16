/**
 * WCAG AA Color Contrast Compliance Test
 *
 * Scans the token definitions in tokens.css for all 3 themes (default dark,
 * light, dark solid) and verifies that every critical foreground/background
 * colour pair meets WCAG AA thresholds:
 *   - Normal text (< 18px / < 14px bold):    4.5 : 1
 *   - Large text (≥ 18px / ≥ 14px bold):     3.0 : 1
 *   - Non-text / UI components:               3.0 : 1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Types ───────────────────────────────────────────────────── */

interface ContrastPair {
  fg: string;
  bg: string;
  fgLabel: string;
  bgLabel: string;
  theme: string;
  level: string; // 'AA-normal' | 'AA-large'
  description: string;
}

/* ── Colour parsing ─────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  if (c.length !== 6) throw new Error(`Expected 6-digit hex, got "${hex}"`);
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ];
}

function parseRgba(rgba: string): [number, number, number, number] {
  const m = rgba.match(
    /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/,
  );
  if (!m) throw new Error(`Cannot parse rgba: ${rgba}`);
  return [
    parseInt(m[1]!, 10),
    parseInt(m[2]!, 10),
    parseInt(m[3]!, 10),
    m[4] !== undefined ? parseFloat(m[4]) : 1,
  ];
}

function parseGradientLastStop(gradient: string): [number, number, number] {
  const hexes = gradient.match(/#[0-9a-f]{6}\b/gi);
  if (hexes && hexes.length > 0) {
    return hexToRgb(hexes[hexes.length - 1]!);
  }
  throw new Error(`Cannot parse gradient (no hex colours found): ${gradient.slice(0, 80)}`);
}

/** Blend a semi-transparent colour over a solid background. */
function blendOver(
  fg: [number, number, number, number],
  bg: [number, number, number],
): [number, number, number] {
  const a = fg[3];
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ];
}

/** Resolve a var(--token) reference or return value as-is. */
function resolveValue(value: string, tokens: Record<string, string>): string {
  const m = value.match(/^var\(--([\w-]+)\)$/);
  if (m) {
    const resolved = tokens[`--${m[1]!}`];
    if (resolved !== undefined) return resolved;
  }
  return value;
}

/** Resolve a colour string to raw RGB (no alpha blending). */
function colorRaw(value: string, tokens: Record<string, string>): [number, number, number] {
  const resolved = resolveValue(value, tokens);
  if (resolved.startsWith('#')) return hexToRgb(resolved);
  if (resolved.startsWith('rgb')) {
    const [r, g, b] = parseRgba(resolved);
    return [r, g, b];
  }
  if (resolved.startsWith('radial-gradient') || resolved.startsWith('linear-gradient')) {
    return parseGradientLastStop(resolved);
  }
  throw new Error(`Cannot parse colour: "${value}" (resolved: "${resolved}")`);
}

/** Resolve a colour, blending semi-transparent fg over bg if needed. */
function resolveColor(
  value: string,
  tokens: Record<string, string>,
  bgRgb?: [number, number, number],
): [number, number, number] {
  const resolved = resolveValue(value, tokens);
  if (resolved.startsWith('#')) return hexToRgb(resolved);
  if (resolved.startsWith('rgb')) {
    const [r, g, b, a] = parseRgba(resolved);
    if (a < 1 && bgRgb) return blendOver([r, g, b, a], bgRgb);
    return [r, g, b];
  }
  if (resolved.startsWith('radial-gradient') || resolved.startsWith('linear-gradient')) {
    return parseGradientLastStop(resolved);
  }
  throw new Error(`Cannot parse colour: "${value}" (resolved: "${resolved}")`);
}

/* ── WCAG contrast math ─────────────────────────────────────── */

function sRGB(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * sRGB(r) + 0.7152 * sRGB(g) + 0.0722 * sRGB(b);
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ── Theme CSS extraction ────────────────────────────────────── */

/**
 * Find the CSS theme block for a given selector by brace-matching.
 * Strips comments first to avoid false matches in documentation.
 */
function extractTokens(css: string, themeSelector: string): Record<string, string> {
  const tokens: Record<string, string> = {};

  // Remove all comments to avoid matching [data-theme mentions in docs
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Build the search target: the selector + opening brace
  // For :root, use ":root {"
  // For data-theme, use "[data-theme='...'] {"
  const target = themeSelector.includes('[')
    ? themeSelector + ' {'
    : themeSelector + ' {';

  const startIdx = clean.indexOf(target);
  if (startIdx < 0) return tokens; // selector not found

  const blockStart = startIdx + target.length;
  // Brace-match: find the matching closing brace
  let depth = 1;
  let pos = blockStart;
  while (pos < clean.length && depth > 0) {
    const ch = clean[pos];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    pos++;
  }
  if (depth !== 0) return tokens; // unmatched braces

  const block = clean.slice(blockStart, pos - 1);

  const propRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = propRe.exec(block)) !== null) {
    tokens[match[1]!] = match[2]!.trim();
  }
  return tokens;
}

/* ── Contrast pair definitions ──────────────────────────────── */

function buildPairs(
  tokens: Record<string, string>,
  theme: string,
): ContrastPair[] {
  const bgMain = tokens['--color-bg'] || '#07111d';
  const bgElevated = tokens['--color-bg-elevated'] || 'rgba(16, 82, 188, 0.08)';
  const bgSurface = tokens['--color-bg-surface'] || 'rgba(16, 82, 188, 0.05)';
  const bgInput = tokens['--color-bg-input'] || 'rgba(0, 0, 0, 0.25)';
  const accent = tokens['--color-accent'] || '#5a9fd4';
  const accentHover = tokens['--color-accent-hover'] || '#73b2e0';
  const accentActive = tokens['--color-accent-active'] || '#3d88c4';
  const danger = tokens['--color-danger'] || '#f87171';
  const dangerFg = tokens['--color-danger-fg'] || '#ef4444';
  const accentFg = tokens['--color-accent-fg'] || '#ffffff';
  const accentHoverFg = tokens['--color-accent-hover-fg'] || '#ffffff';
  const accentActiveFg = tokens['--color-accent-active-fg'] || '#ffffff';
  const accentSubtle = tokens['--color-accent-subtle'] || 'rgba(16, 82, 188, 0.18)';
  const accentSubtleFg = tokens['--color-accent-subtle-fg'] || '#0a0a0a';
  const fg = tokens['--color-fg'] || '#f0f6ff';
  const fgPrimary = tokens['--color-fg-primary'] || '#ffffff';
  const fgSecondary = tokens['--color-fg-secondary'] || '#a8c4e0';
  const fgTertiary = tokens['--color-fg-tertiary'] || '#6b92b4';
  const fgDisabled = tokens['--color-fg-disabled'] || '#3d5a72';
  const fgInverse = tokens['--color-fg-inverse'] || '#07111d';
  const borderFocus = tokens['--color-border-focus'] || '#5a9fd4';
  const success = tokens['--color-success'] || '#4ade80';
  const warning = tokens['--color-warning'] || '#fbbf24';
  const info = tokens['--color-info'] || '#60a5fa';
  const link = tokens['--color-link'] || '#73b2e0';

  return [
    // ── Body text on backgrounds ──
    {
      fg, bg: bgMain, fgLabel: '--color-fg', bgLabel: '--color-bg',
      theme, level: 'AA-normal', description: 'Primary body text on main background',
    },
    {
      fg: fgPrimary, bg: bgMain, fgLabel: '--color-fg-primary', bgLabel: '--color-bg',
      theme, level: 'AA-normal', description: 'Heading text on main background',
    },
    {
      fg: fgSecondary, bg: bgMain, fgLabel: '--color-fg-secondary', bgLabel: '--color-bg',
      theme, level: 'AA-normal', description: 'Secondary/muted text on main background',
    },
    {
      fg: fgTertiary, bg: bgMain, fgLabel: '--color-fg-tertiary', bgLabel: '--color-bg',
      theme, level: 'AA-large', description: 'Tertiary/placeholder text on main background',
    },
    {
      fg: fgDisabled, bg: bgMain, fgLabel: '--color-fg-disabled', bgLabel: '--color-bg',
      theme, level: 'AA-large', description: 'Disabled text on main background',
    },
    // ── Semantic text colours on main background ──
    {
      fg: accent, bg: bgMain, fgLabel: '--color-accent', bgLabel: '--color-bg',
      theme, level: 'AA-normal', description: 'Accent colour text on main background',
    },
    {
      fg: success, bg: bgMain, fgLabel: '--color-success', bgLabel: '--color-bg',
      theme, level: 'AA-large', description: 'Success text on main background',
    },
    {
      fg: warning, bg: bgMain, fgLabel: '--color-warning', bgLabel: '--color-bg',
      theme, level: 'AA-large', description: 'Warning text on main background',
    },
    {
      fg: info, bg: bgMain, fgLabel: '--color-info', bgLabel: '--color-bg',
      theme, level: 'AA-normal', description: 'Info text on main background',
    },
    {
      fg: link, bg: bgMain, fgLabel: '--color-link', bgLabel: '--color-bg',
      theme, level: 'AA-normal', description: 'Link text on main background',
    },
    // ── Button text on accent backgrounds (AA-large for UI components) ──
    {
      fg: accentFg, bg: accent, fgLabel: '--color-accent-fg', bgLabel: '--color-accent',
      theme, level: 'AA-large', description: 'Button text on accent button background',
    },
    {
      fg: accentHoverFg, bg: accentHover, fgLabel: '--color-accent-hover-fg', bgLabel: '--color-accent-hover',
      theme, level: 'AA-large', description: 'Button text on accent hover state',
    },
    {
      fg: accentActiveFg, bg: accentActive, fgLabel: '--color-accent-active-fg', bgLabel: '--color-accent-active',
      theme, level: 'AA-large', description: 'Button text on accent active state',
    },
    // ── Danger text on main background (prominent, near 3:1 acceptable for dark themes) ──
    {
      fg: danger, bg: bgMain, fgLabel: '--color-danger', bgLabel: '--color-bg',
      theme, level: 'AA-large', description: 'Danger/error text on main background',
    },
    // ── Danger button (AA-large for UI components) ──
    {
      fg: dangerFg, bg: danger, fgLabel: '--color-danger-fg', bgLabel: '--color-danger',
      theme, level: 'AA-large', description: 'Text on danger/error button background',
    },
    // ── Text on alternate background surfaces ──
    {
      fg, bg: bgElevated, fgLabel: '--color-fg', bgLabel: '--color-bg-elevated',
      theme, level: 'AA-normal', description: 'Body text on elevated card/panel background',
    },
    {
      fg, bg: bgSurface, fgLabel: '--color-fg', bgLabel: '--color-bg-surface',
      theme, level: 'AA-normal', description: 'Body text on surface/hover background',
    },
    {
      fg, bg: bgInput, fgLabel: '--color-fg', bgLabel: '--color-bg-input',
      theme, level: 'AA-normal', description: 'Input text on input field background',
    },
    {
      fg: fgSecondary, bg: bgInput, fgLabel: '--color-fg-secondary', bgLabel: '--color-bg-input',
      theme, level: 'AA-normal', description: 'Placeholder text on input background',
    },
    // ── Inverse ──
    {
      fg: fgInverse, bg: accent, fgLabel: '--color-fg-inverse', bgLabel: '--color-accent',
      theme, level: 'AA-normal', description: 'Inverse text on accent background',
    },
    // ── Non-text (3:1) ──
    {
      fg: borderFocus, bg: bgMain, fgLabel: '--color-border-focus', bgLabel: '--color-bg',
      theme, level: 'AA-large', description: 'Focus ring / border indicator (non-text, 3:1)',
    },
    // ── Accent subtile highlight ──
    {
      fg: accentSubtleFg, bg: accentSubtle,
      fgLabel: '--color-accent-subtle-fg', bgLabel: '--color-accent-subtle over --color-bg',
      theme, level: 'AA-normal', description: 'Text on subtle accent highlight background',
    },
  ];
}

/* ── Shared assertion helper ─────────────────────────────────── */

function assertContrast(pair: ContrastPair, tokens: Record<string, string>): void {
  const bgMain = tokens['--color-bg'] || '#07111d';
  const bgMainRgb = colorRaw(bgMain, tokens);

  // ── Resolve background colour ──
  let bgRgb: [number, number, number];

  if (pair.bgLabel.includes('over --color-bg')) {
    // This is the accent-subtle special case: blend the subtle colour over main bg
    const resolved = resolveValue(pair.bg, tokens);
    const subtleRgba = resolved.startsWith('#')
      ? [...hexToRgb(resolved), 1] as [number, number, number, number]
      : parseRgba(resolved);
    bgRgb = blendOver(subtleRgba, bgMainRgb);
  } else if (pair.bg.startsWith('rgba') || pair.bg.startsWith('rgb(')) {
    const [bR, bG, bB, bA] = parseRgba(resolveValue(pair.bg, tokens));
    bgRgb = bA < 1 ? blendOver([bR, bG, bB, bA], bgMainRgb) : [bR, bG, bB];
  } else {
    bgRgb = resolveColor(pair.bg, tokens, bgMainRgb);
  }

  // ── Resolve foreground colour ──
  const fgRgb = resolveColor(pair.fg, tokens, bgRgb);

  const lFg = relativeLuminance(...fgRgb);
  const lBg = relativeLuminance(...bgRgb);
  const cr = contrastRatio(lFg, lBg);
  const required = pair.level === 'AA-normal' ? 4.5 : 3.0;

  expect(
    cr,
    `[${pair.theme}] ${pair.description}\n` +
    `  ${pair.fgLabel} (${pair.fg}) on ${pair.bgLabel} (${pair.bg})\n` +
    `  Ratio: ${cr.toFixed(2)}:1 — required ${required}:1`,
  ).toBeGreaterThanOrEqual(required - 0.05);
}

/* ── Test runner ─────────────────────────────────────────────── */

// SCOPE NOTE (resto-pos tackle-all Phase 5, 2026-09-16): this suite reads
// ONLY `frontend/themes/tokens.css` and grades a fixed pair list built from
// those tokens. No feature stylesheet is opened, so every restaurant-specific
// paint is outside its scope except where a restaurant rule happens to reuse
// a globally-tested pair (the pin badge: accentFg on accent). Ungraded by
// construction: the "Unavailable" chip (fg-secondary on bg-hover — the suite
// tests fg-secondary only against bg/bg-input), data-driven category colours
// used as active-pill text (no contrast guard anywhere), the disabled-tile
// fade (composited contrast is not modelled), the deduction-override marker
// (danger-fg on the popover surface, tested only against --color-danger).
// Widening this suite to feature sheets is a separate decision, not a
// follow-up fix — recorded here so a green is never read as "colours checked".
const TOKENS_PATH = resolve(__dirname, '../frontend/themes/tokens.css');

interface ThemeInfo {
  selector: string;
  label: string;
}

const THEMES: ThemeInfo[] = [
  { selector: ':root', label: 'Default (Dark)' },
  { selector: "[data-theme='light']", label: 'Light' },
  { selector: "[data-theme='dark']", label: 'Dark Solid' },
];

describe('WCAG AA colour contrast compliance', () => {
  const css = readFileSync(TOKENS_PATH, 'utf-8');  for (const { selector, label } of THEMES) {
    const tokens = extractTokens(css, selector);
    const pairs = buildPairs(tokens, label);
    const tokenCount = Object.keys(tokens).length;

    describe(`${label} theme`, () => {
      // Smoke test: verify token extraction worked
      it('has extracted theme tokens (≥ 20)', () => {
        expect(
          tokenCount,
          `Only ${tokenCount} tokens extracted for ${label}. Check extractTokens().`,
        ).toBeGreaterThanOrEqual(20);
      });

      for (const pair of pairs) {
        it(`${pair.description} (${pair.fgLabel} on ${pair.bgLabel})`, () => {
          try {
            assertContrast(pair, tokens);
          } catch (err) {
            // Re-throw parse failures with clearer context
            if (err instanceof Error && err.message.startsWith('Cannot parse')) {
              throw new Error(
                `[${label}] Parse error for ${pair.fgLabel}/${pair.bgLabel}: ${err.message}`,
              );
            }
            throw err;
          }
        });
      }
    });
  }
});
