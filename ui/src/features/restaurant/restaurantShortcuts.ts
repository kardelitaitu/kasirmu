// ui/src/features/restaurant/restaurantShortcuts.ts
//
// Single source of truth for the restaurant POS keyboard shortcuts.
//
// WHY THIS FILE EXISTS
// --------------------
// The restaurant till was the only POS surface with no keyboard shortcuts. Three sibling
// workspaces each carry a manifest — `features/retail/retailShortcuts.ts` (16 bindings,
// parity-tested), `features/warehouse/warehouseShortcuts.ts`, and
// `features/kds/hooks/useKdsKeyboardShortcuts.ts` — while `grep 'RESTAURANT_SHORTCUT'` over
// `ui/src` found nothing. The restaurant workspace renders the shared `PosScreen` (registered
// for both `sales` and `pos` routes), which declares retail-scoped bindings only.
//
// THE KEY-SPACE CONSTRAINT, AND HOW THIS FITS AROUND IT
// ----------------------------------------------------
// Retail occupies F1–F12, `?`, `Ctrl+K`, `Ctrl+L` and `Esc`; AppShell owns F10 for the
// workspace settings modal across every workspace. `PosScreen.tsx:91-95` removed a local
// settings screen specifically because it *"would shadow the global shortcut"* — a collision
// this tree has already paid for once.
//
// So this manifest binds ONLY keys retail does not own, and every one of them triggers an
// action that is restaurant-only and therefore has no retail binding to collide with:
// send to kitchen, print bill, split bill, save tab, tables. Nothing here can shadow retail,
// because retail handles none of these keys.
//
// Precedence, deliberately narrow: raw digits stay with the menu's own handlers (category
// and pill ordinaries), so only Shift+<key> chords and plain letters are bound, and the
// editable guard suppresses them while a field has focus.

export type RestaurantShortcutScope = 'restaurant' | 'global';

export interface RestaurantShortcut {
  /** Canonical key label shown to users (e.g. "Shift+K", "F1"). */
  key: string;
  /** The `KeyboardEvent.key` value this matches, when it differs from `key`. */
  matchKey?: string;
  /** Stable action identifier — the single implementation this key triggers. */
  action: string;
  /** Fluent message id for the localized label. */
  labelId: string;
  /** Whether the shortcut is suppressed while an editable target has focus. */
  editableGuard: boolean;
}

/**
 * The restaurant manifest, ordered as the help overlay should display them.
 *
 * Keys are chosen so no entry collides with `RETAIL_SHORTCUTS` (F1-F12, `?`, Ctrl+K, Ctrl+L,
 * Esc) or with AppShell's global F10. `Shift+` chords are used because a bare letter is
 * likelier to belong to a future text-entry accelerator, and because the menu grid and
 * search already use single characters.
 */
export const RESTAURANT_SHORTCUTS: RestaurantShortcut[] = [
  { key: 'Shift+K', action: 'send-kitchen', labelId: 'restaurant-shortcut-send-kitchen', editableGuard: true },
  { key: 'Shift+P', action: 'print-bill', labelId: 'restaurant-shortcut-print-bill', editableGuard: true },
  { key: 'Shift+B', action: 'split-bill', labelId: 'restaurant-shortcut-split-bill', editableGuard: true },
  { key: 'Shift+T', action: 'save-tab', labelId: 'restaurant-shortcut-save-tab', editableGuard: true },
  { key: 'Shift+L', action: 'open-tables', labelId: 'restaurant-shortcut-open-tables', editableGuard: true },
];

/**
 * True when the event's key and modifiers match this shortcut.
 *
 * A `Shift+` entry is a CHORD: the label carries the modifier prefix but `KeyboardEvent.key`
 * for Shift+K is `'K'`, not `'Shift+K'`. So the prefix is split off before comparison —
 * comparing the whole label against `e.key` never matches, which the parity test caught.
 */
export function matchesRestaurantShortcut(
  shortcut: RestaurantShortcut,
  e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
): boolean {
  const label = shortcut.matchKey ?? shortcut.key;
  const wantsShift = label.startsWith('Shift+');
  const bare = wantsShift ? label.slice('Shift+'.length) : label;
  if (e.key.toUpperCase() !== bare.toUpperCase()) return false;
  if (wantsShift !== e.shiftKey) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return true;
}

/** The action for a key event, or null when this manifest does not own it. */
export function restaurantShortcutActionFor(e: KeyboardEvent): string | null {
  for (const shortcut of RESTAURANT_SHORTCUTS) {
    if (matchesRestaurantShortcut(shortcut, e)) return shortcut.action;
  }
  return null;
}