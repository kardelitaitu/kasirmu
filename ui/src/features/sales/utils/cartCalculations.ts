// ── Cart panel width, viewport-aware ──────────────────────────────────
/**
 * Bounds for the cart's right panel.
 *
 * The panel may grow to half the viewport but never wider than
 * `1200 px` so the menu stays usable. Default is `440 px`, comfortable
 * for the line-item cards. A `resize` listener re-clamps the saved width
 * when the window is resized — important when the cashier drags a window
 * between monitors or a laptop docks into a 4K display.
 *
 * THE FLOOR IS MEASURED, NOT CHOSEN. It was 320 px, described here as the
 * width that "keeps qty controls and line text legible" — but at 320 the
 * line item's FIXED parts (32 px thumb + 110 px qty pill + 44 px remove +
 * 24 px gaps) leave the flexible name column only 52 px, so "Ice Lemon
 * Tea" (120 px natural) rendered at 43% of its text. The floor sat exactly
 * where legibility broke.
 *
 * Swept on the Redmi tablet at a 1097×686 viewport, one line, dark theme:
 *
 *   panel 320 (old floor) -> name column  52 px -> truncated
 *   panel 360             -> name column  92 px -> truncated
 *   panel 400             -> name column 132 px -> fits
 *   panel 440 (default)   -> name column 172 px -> fits
 *
 * 400 px is the smallest panel at which a name of that length survives, so
 * that is the floor. It is a floor on the PANEL, and the name column's
 * share of it is what actually matters — if the fixed parts above ever grow
 * (a wider qty pill, another icon button), re-measure this rather than
 * assuming 400 still holds.
 */
export const CART_WIDTH_MIN = 400;
export const CART_WIDTH_DEFAULT = 440;
export const CART_WIDTH_MAX_CAP = 1200;

export function clampCartWidth(px: number, viewportWidth: number): number {
  const max = Math.max(
    CART_WIDTH_MIN,
    Math.min(viewportWidth * 0.5, CART_WIDTH_MAX_CAP),
  );
  return Math.max(CART_WIDTH_MIN, Math.min(Math.round(px), max));
}

/**
 * Deterministic per-SKU thumbnail: stable monogram letter + hashed
 * hue. The hue is exposed to CSS via a custom property so light and
 * dark modes can theme the tile colour from the stylesheet.
 */
export function lineThumbnail(sku: string): { initial: string; hue: number } {
  let hash = 0;
  for (let i = 0; i < sku.length; i++) {
    hash = (hash * 31 + sku.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const initialMatch = sku.match(/[A-Za-z0-9]/);
  // `sku.charAt(0)` always returns string (unlike `sku[0]` which is
  // `string | undefined` under noUncheckedIndexedAccess).
  const chosen: string = initialMatch?.[0] ?? sku.charAt(0) ?? '?';
  return { initial: chosen.toUpperCase(), hue };
}
