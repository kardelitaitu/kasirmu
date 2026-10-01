/**
 * Pure, testable logic for the restaurant sidebar's roving keyboard navigation.
 *
 * The sidebar exposes its action rows as a roving tablist: ArrowDown / ArrowUp
 * move focus among the action buttons, Home jumps to the first and End to the
 * last. This index calculation is pure — given the currently focused row, the
 * button count and the pressed key it returns the next row to focus (or `null`
 * when there is nothing to focus) — so the component's keydown handler stays a
 * thin DOM shell around it and the edge cases are unit-tested in isolation.
 */

/** The four keys that drive roving navigation. */
export type RovingKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/** The full set of roving keys, for the handler's early-exit guard. */
const ROVING_KEYS: readonly RovingKey[] = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/** Whether `key` drives roving navigation (everything else is ignored). */
export function isRovingKey(key: string): key is RovingKey {
  return (ROVING_KEYS as readonly string[]).includes(key);
}

/**
 * Compute the row index to move focus to for a roving keypress.
 *
 * Mirrors the original inline arithmetic exactly: `Home` → first item, `End` →
 * last item, `ArrowDown`/`ArrowUp` → wrap around the list modulo its length.
 * Returns `null` when there are no items to focus (the caller returns without
 * moving focus, matching the empty-tablist early exit in the component).
 *
 * `current` is the index of the focused row, in `0..count-1`; the modulo
 * arithmetic keeps the result in that range for `count > 0`, so no clamping is
 * needed.
 */
export function computeRovingIndex(
  current: number,
  count: number,
  key: RovingKey,
): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (current + 1) % count;
  return (current - 1 + count) % count; // ArrowUp
}
