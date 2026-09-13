// ── Cart panel width, viewport-aware ──────────────────────────────────
/**
 * Bounds for the cart's right panel.
 *
 * The panel may grow to half the viewport but never wider than
 * `1200 px` so the menu stays usable. The `320 px` floor keeps qty
 * controls and line text legible on small terminals. Default is
 * `440 px`, comfortable for the line-item cards. A `resize`
 * listener re-clamps the saved width when the window is resized —
 * important when the cashier drags a window between monitors or a
 * laptop docks into a 4K display.
 */
export const CART_WIDTH_MIN = 320;
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
