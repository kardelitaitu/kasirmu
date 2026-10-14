// ui/src/features/restaurant/hooks/useRestaurantShortcuts.ts
//
// Binds the restaurant shortcut manifest (`../restaurantShortcuts.ts`) to the POS actions.
//
// WHY A HOOK RATHER THAN INLINE LOGIC
// ------------------------------------
// The manifest is the single source of truth for which key does what; this hook is the single
// source of truth for what each action runs. Keeping them apart lets the parity test assert
// "every advertised key reaches a real handler" without rendering the whole POS, and it
// mirrors how retail's function bar consumes `RETAIL_SHORTCUTS`.
//
// Suppressed while an editable target has focus, per the manifest's `editableGuard`, so a
// waiter typing a table number or a guest count is never interrupted.

import { useEffect } from 'react';
import { RESTAURANT_SHORTCUTS, matchesRestaurantShortcut } from '../restaurantShortcuts';

export interface RestaurantShortcutHandlers {
  'send-kitchen'?: () => void;
  'print-bill'?: () => void;
  'split-bill'?: () => void;
  'save-tab'?: () => void;
  'open-tables'?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
}

/**
 * Subscribe to the restaurant shortcut manifest for the lifetime of the component.
 *
 * A handler that is absent is left unbound rather than throwing, so a screen wires only the
 * actions it supports. An advertised-but-unwired action is CONSUMED rather than falling
 * through — the same discipline as the help overlay: what is shown must be what happens.
 */
export function useRestaurantShortcuts(handlers: RestaurantShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      for (const shortcut of RESTAURANT_SHORTCUTS) {
        if (!matchesRestaurantShortcut(shortcut, e)) continue;
        const handler = handlers[shortcut.action as keyof RestaurantShortcutHandlers];
        e.preventDefault();
        handler?.();
        return;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}