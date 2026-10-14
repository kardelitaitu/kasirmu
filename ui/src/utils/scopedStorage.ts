// ── Store-scoped storage keys ─────────────────────────────────────────
//
// Round 104 (F44) scoped the POS cart keys because a flat key meant store A's cart
// appeared in store B on the same device: `pos-locked-cart:${resolvedStoreId}`, with an
// `|| 'unresolved'` fallback so a scope that has not resolved yet produces a key rather
// than `undefined`. That was done inline in PosScreen and nothing generalised it.
//
// Round 167's sweep found 14 flat `resto_rcpt_*` keys in RestaurantReceiptsScreen across
// 88 call sites with no store scoping — the same class, larger. The screen is
// store-shared, so two terminals in one store, or two stores on one device, share
// receipt headers.
//
// The reason the class keeps recurring is that there is no helper. This module is that
// helper: one key builder matching PosScreen's fallback, plus a legacy adoption so
// scoping an existing key is a migration rather than a reset.

/**
 * Build a store-scoped localStorage key.
 *
 * The fallback is `'unresolved'` rather than `'default'`, matching PosScreen's scoped
 * keys (round 104). The difference matters: `'default'` would make an unresolved scope
 * COLLIDE with any store genuinely named `default`, planting one terminal's value in
 * another. `'unresolved'` cannot collide with a real store id for the same reason a
 * null primary key cannot collide with a real one — a sentinel the backend has no
 * reason to mint.
 */
export function scopedKey(base: string, storeId?: string | null): string {
  return base + ':' + (storeId ?? 'unresolved');
}

/**
 * Read a store-scoped value, adopting a legacy UNSCOPED one when none exists.
 *
 * The adoption is what makes scoping an existing key a migration rather than a break.
 * Without it, an operator who configured receipt headers today would find them empty
 * the moment their key became scoped — the value would still be in localStorage, just
 * under the old spelling.
 *
 * It adopts once: after the first read the scoped key holds the value, so the legacy
 * key becomes unreachable rather than repeatedly re-adopted.
 */
export function readScoped(base: string, storeId?: string | null): string | null {
  try {
    const scoped = localStorage.getItem(scopedKey(base, storeId));
    if (scoped !== null) return scoped;
  } catch { return null; }

  try {
    const legacy = localStorage.getItem(base);
    if (legacy !== null) {
      try {
        localStorage.setItem(scopedKey(base, storeId), legacy);
      } catch { /* quota */ }
    }
    return legacy;
  } catch { return null; }
}

/** Write a store-scoped value. */
export function writeScoped(
  base: string,
  storeId: string | null | undefined,
  value: string,
): void {
  try {
    localStorage.setItem(scopedKey(base, storeId), value);
  } catch { /* localStorage unavailable */ }
}