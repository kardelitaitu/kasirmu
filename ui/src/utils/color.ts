/**
 * Color manipulation utilities for white-label theming.
 *
 * Derives accent palette variants (hover, active, subtle, dim, alpha)
 * from a single brand colour so the entire UI adapts to the user's
 * chosen primary colour.
 */

// ── Parse helpers ───────────────────────────────────────────────────

/** Convert a hex colour string (#rgb, #rrggbb) to { r, g, b }. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) {
    h = h[0]! + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = Number.parseInt(h, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/** Convert { r, g, b } to a hex string (#rrggbb). */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Colour manipulation ────────────────────────────────────────────

/**
 * Blend a colour toward white by `amount` (0–1).
 * 0 = original, 1 = white.
 */
export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
  );
}

/**
 * Blend a colour toward black by `amount` (0–1).
 * 0 = original, 1 = black.
 */
export function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r * (1 - amount),
    g * (1 - amount),
    b * (1 - amount),
  );
}

/** Format as `rgba(r, g, b, alpha)`. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Palette derivation ──────────────────────────────────────────────

/** Derived accent colour palette from a single brand colour. */
export interface AccentPalette {
  base: string;
  hover: string;
  active: string;
  subtle: string;
  fg: string;
  dim: string;
  alpha: string;
  secondary: string;
  subtleFg: string;
  hoverFg: string;
  activeFg: string;
}

const DEFAULT_ACCENT = '#147EFB';

/**
 * Return black or white text that contrasts with the given hex colour.
 */
export function contrastFg(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 160 ? '#0a0a0a' : '#ffffff';
}

/**
 * Derive the full accent palette from a single base colour.
 *
 * The amounts are tuned to produce a similar visual relationship
 * as the default emerald palette (primary-500 → hover/active etc.).
 */
export function deriveAccentPalette(base: string = DEFAULT_ACCENT): AccentPalette {
  const { r, g, b } = hexToRgb(base);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

  // Determine if the base is light or dark to pick appropriate fg text.
  const isLight = luminance > 160;

  return {
    base,
    hover: darken(base, 0.1),
    active: darken(base, 0.2),
    subtle: lighten(base, isLight ? 0.55 : 0.7),
    fg: contrastFg(base),
    dim: rgba(base, 0.12),
    alpha: rgba(base, 0.2),
    secondary: lighten(base, 0.15),
    subtleFg: contrastFg(lighten(base, isLight ? 0.55 : 0.7)),
    hoverFg: contrastFg(darken(base, 0.1)),
    activeFg: contrastFg(darken(base, 0.2)),
  };
}

/**
 * Every inline CSS custom property the brand palette owns.
 *
 * `applyAccentPalette` sets exactly these; `clearAccentPalette` removes
 * exactly these. One shared list keeps the two in lockstep — a property
 * added to one but not the other would leak an override that survives
 * "reset to theme default".
 */
const BRAND_PALETTE_PROPS = [
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-active',
  '--color-accent-subtle',
  '--color-accent-fg',
  '--color-accent-dim',
  '--color-accent-alpha',
  '--color-accent-secondary',
  '--color-accent-subtle-fg',
  '--color-accent-hover-fg',
  '--color-accent-active-fg',
  '--color-primary',
  '--color-primary-soft',
] as const;

/**
 * Apply the accent palette as CSS custom properties on the document element.
 *
 * Also drives `--color-primary` / `--color-primary-soft` from the base so
 * the brand colour reaches every primary-token consumer (statusbar tones,
 * analytics, loyalty, reports…), not just `--color-accent` consumers.
 */
export function applyAccentPalette(palette: AccentPalette): void {
  const root = document.documentElement;
  const values: Record<(typeof BRAND_PALETTE_PROPS)[number], string> = {
    '--color-accent': palette.base,
    '--color-accent-hover': palette.hover,
    '--color-accent-active': palette.active,
    '--color-accent-subtle': palette.subtle,
    '--color-accent-fg': palette.fg,
    '--color-accent-dim': palette.dim,
    '--color-accent-alpha': palette.alpha,
    '--color-accent-secondary': palette.secondary,
    '--color-accent-subtle-fg': palette.subtleFg,
    '--color-accent-hover-fg': palette.hoverFg,
    '--color-accent-active-fg': palette.activeFg,
    '--color-primary': palette.base,
    '--color-primary-soft': rgba(palette.base, 0.15),
  };
  for (const prop of BRAND_PALETTE_PROPS) {
    root.style.setProperty(prop, values[prop]);
  }
}

/**
 * Remove every inline brand-palette override from the document element.
 *
 * Used by "reset to theme default": with no inline override, the static
 * per-theme tokens in themes/tokens.css show through (light #147EFB,
 * dark #1155CC).
 */
export function clearAccentPalette(): void {
  const root = document.documentElement;
  for (const prop of BRAND_PALETTE_PROPS) {
    root.style.removeProperty(prop);
  }
}

/**
 * Read the computed value of a CSS custom property on `:root`.
 */
export function readCSSVar(name: string): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || null;
}

/**
 * Scan all semantic colour tokens on the document and set their
 * companion `--*-fg` contrast variables. This keeps text readable
 * regardless of the active theme or custom brand colour.
 *
 * Run once on boot and every time the theme (light/dark) changes.
 */
export function applyThemeContrasts(): void {
  const pairs: [string, string][] = [
    ['--color-accent', '--color-accent-fg'],
    ['--color-accent-hover', '--color-accent-hover-fg'],
    ['--color-accent-active', '--color-accent-active-fg'],
    ['--color-accent-subtle', '--color-accent-subtle-fg'],
    ['--color-danger', '--color-danger-fg'],
    ['--color-success', '--color-success-fg'],
    ['--color-warning', '--color-warning-fg'],
    ['--color-info', '--color-info-fg'],
    ['--color-bg-elevated', '--color-bg-elevated-fg'],
    ['--color-bg-primary', '--color-bg-primary-fg'],
  ];

  const root = document.documentElement;
  for (const [bgVar, fgVar] of pairs) {
    const bg = readCSSVar(bgVar);
    if (bg) {
      root.style.setProperty(fgVar, contrastFg(bg));
    }
  }
}
