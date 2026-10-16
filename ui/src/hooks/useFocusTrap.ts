import { useEffect, useCallback, useRef, type RefObject } from 'react';

/**
 * Elements the browser can actually move focus to by Tabbing.
 *
 * `:not([disabled])` matters: a disabled control is still matched by a bare
 * `button`/`input` selector but can never receive focus, so treating it as the
 * first/last of the cycle makes the wrap condition unreachable and lets Tab
 * escape the dialog. ConfirmDialog triggers this for real — its confirm button
 * is disabled while the form is invalid and while the action is in flight.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(', ');

/**
 * Attribute-level invisibility. Layout probes (offsetParent, getClientRects)
 * are deliberately not used: jsdom reports no layout, so they would filter out
 * every element under test. `hidden` / `aria-hidden` are checked against the
 * element and its ancestors, which covers the common "row collapsed but still
 * in the DOM" case.
 */
function isReachable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled === true) return false;
  return !el.closest('[hidden], [aria-hidden="true"]');
}

function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isReachable);
}

/**
 * Reusable focus-trap hook for modal dialogs.
 *
 * When `active` is true, the hook:
 * 1. Auto-focuses the first focusable element inside the panel.
 * 2. Traps Tab / Shift+Tab cycling within the panel.
 * 3. Calls `onEscape` when Escape is pressed.
 * 4. Locks body scroll while the trap is active.
 *
 * Uses a ref for `onEscape` to avoid re-attaching the event listener
 * (and the associated body-scroll-lock flicker) when the callback
 * reference changes across renders.
 *
 * Mirrors the pattern used in `Modal.tsx`, `SettingsPopup.tsx`, and
 * the shared `components/Modal.tsx`.
 *
 * @param panelRef - Ref to the dialog panel DOM element.
 * @param active   - Whether the trap should be active (typically `open && !exiting`).
 * @param onEscape - Called when Escape is pressed while the trap is active.
 */
export function useFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
): void {
  // Keep onEscape in a ref so handleKeyDown never needs to change,
  // preventing the effect from re-running (and scroll-lock flickering)
  // just because the parent passed a new inline callback.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = focusableWithin(panelRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      // Focus is not inside the panel at all — an overlay click, a
      // programmatic focus elsewhere, or a previous escape. Comparing against
      // first/last would never match, so Tab would keep walking the page
      // behind the dialog. Pull it back in instead.
      const active = document.activeElement as HTMLElement | null;
      if (!active || !panelRef.current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [panelRef],
  );

  useEffect(() => {
    if (!active) return;

    const panel = panelRef.current;
    if (!panel) return;

    // A11Y-01: remember the previously-focused element so focus can be
    // returned to it when the trap is torn down (dialog/popover closes).
    // Captured BEFORE the auto-focus below moves focus into the panel.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Auto-focus the first element the browser can actually reach. Using the
    // same filtered set as the Tab handler keeps the two in agreement — a
    // disabled leading button must not be "focused" (it can't be) and must not
    // become the cycle's anchor either.
    const focusable = focusableWithin(panel);
    focusable[0]?.focus();

    // Lock body scroll.
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Listen for keyboard events.
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      // A11Y-01: restore focus to the trigger if it is still connected and
      // not disabled. Guards keep this a no-op when the trigger was removed
      // or became inert while the panel was open.
      if (
        previouslyFocused &&
        previouslyFocused.isConnected &&
        !previouslyFocused.hasAttribute('disabled')
      ) {
        previouslyFocused.focus();
      }
    };
  }, [active, panelRef, handleKeyDown]);
}
