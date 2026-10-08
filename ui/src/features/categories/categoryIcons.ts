// ── Category icon set ─────────────────────────────────────────────────────
//
// The canonical icon vocabulary for product categories, plus the pure helpers
// the pickers use (radiogroup traversal, label ids, random selection). The SVG
// renderer lives beside this file in ./CategoryIconSvg.tsx.
//
// Extracted from CategoryManagementScreen.tsx, which had the only copy: the
// icons are stored on the category row as a bare id string, so every surface
// that SHOWS a category (the restaurant menu tab bar, the menu editor) needs the
// renderer, and every surface that CREATES one needs the picker. A second copy
// of the same eight SVGs is how two screens end up disagreeing about what
// `snack` looks like.
//
// The id strings are persisted data, not display names: renaming one silently
// blanks the icon on every category already carrying it. Add, never rename.

/**
 * The predefined category colour palette, as hex.
 *
 * Stored verbatim on `CategoryDto.colour`, and the icon renderer derives a
 * contrasting foreground from it, so these are data rather than theme tokens.
 * Ordered as the picker lays them out; index 0 is the default for a new category.
 */
export const CATEGORY_COLOURS: readonly string[] = [
  '#06b6d4', // cyan
  '#f97316', // orange
  '#10b981', // emerald
  '#6366f1', // indigo
  '#ec4899', // pink
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#ef4444', // red
  '#84cc16', // lime
  '#3b82f6', // blue
  '#a855f7', // purple
  '#e11d48', // rose
  '#0ea5e9', // sky
  '#22c55e', // green
  '#d946ef', // fuchsia
];

/** Pick a random palette colour, for a new category's initial state. */
export function randomCategoryColour(): string {
  return CATEGORY_COLOURS[Math.floor(Math.random() * CATEGORY_COLOURS.length)]!;
}

/** One selectable icon. The id is what lands in `CategoryDto.icon`. */
export interface CategoryIconOption {
  id: string;
  /** Human label, used for the radiogroup's accessible name fallback. */
  label: string;
}

/**
 * The icon set, in display order.
 *
 * Order is load-bearing twice over: it is the arrow-key traversal order in the
 * radiogroup, and it is what `randomIcon` indexes.
 */
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[] = [
  { id: 'food', label: 'Food' },
  { id: 'snack', label: 'Snack' },
  { id: 'hot-drink', label: 'Hot drink' },
  { id: 'cold-drink', label: 'Cold drink' },
  { id: 'dots-1', label: 'Generic ·' },
  { id: 'dots-2', label: 'Generic ··' },
  { id: 'dots-3', label: 'Generic ···' },
];

/** Icon ids in display order, for arrow-key navigation over the radiogroup. */
export const CATEGORY_ICON_IDS: readonly string[] = CATEGORY_ICON_OPTIONS.map((o) => o.id);

/**
 * Fluent message id for an icon's accessible name.
 *
 * Kept here beside the set so a new icon cannot be added without a label: the
 * picker buttons are icon-only, so this id IS their accessible name.
 */
export function categoryIconLabelId(icon: string): string {
  switch (icon) {
    case 'food':
      return 'categories-icon-food';
    case 'snack':
      return 'categories-icon-snack';
    case 'hot-drink':
      return 'categories-icon-hot-drink';
    case 'cold-drink':
      return 'categories-icon-cold-drink';
    default:
      return 'categories-icon-generic';
  }
}

/**
 * WAI-ARIA radiogroup traversal: Arrow keys move focus AND selection; Tab leaves
 * the group.
 *
 * @returns the next value (wrapping), or null for a non-arrow key.
 */
export function nextRadioValue(
  options: readonly string[],
  current: string,
  key: string,
): string | null {
  const idx = options.indexOf(current);
  if (idx < 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return options[(idx + 1) % options.length]!;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return options[(idx - 1 + options.length) % options.length]!;
  }
  return null;
}

/** Pick a random icon id. Uses the shared order, so it always yields a real icon. */
export function randomCategoryIcon(): string {
  return CATEGORY_ICON_IDS[Math.floor(Math.random() * CATEGORY_ICON_IDS.length)]!;
}
