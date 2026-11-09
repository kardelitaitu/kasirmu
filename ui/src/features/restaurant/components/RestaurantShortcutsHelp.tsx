// ui/src/features/restaurant/components/RestaurantShortcutsHelp.tsx
//
// Renders the restaurant keyboard-shortcut manifest as a readable list.
//
// WHY THIS EXISTS
// ---------------
// `restaurantShortcuts.ts` declares five bindings, and both locale bundles
// (`sales.ftl`, `sales.id.ftl`) carry a string for every one of their
// `labelId`s. Until this component, NOTHING read those `labelId`s: grepping
// `restaurant-shortcut-` across `ui/src` returned the manifest and the two
// locale files and no renderer at all. So the till had five working keys that a
// waiter had no way to discover — the keys worked and the documentation of them
// was dead code.
//
// The retail till does not have this gap: it renders `RETAIL_HELP_SHORTCUTS`
// through `RetailModals.tsx:731`, reached by the `?` binding. That is the shape
// copied here, and the comparison is the reason the gap was findable.
//
// WHY IT RENDERS FROM THE MANIFEST AND NOT A LITERAL LIST
// ------------------------------------------------------
// A hand-written list is a second source of truth: it drifts the moment a
// binding changes, and it cannot be checked. Reading `RESTAURANT_SHORTCUTS`
// means the help text cannot disagree with what the keys do — the same rule
// `restaurantShortcutParity.test.ts` enforces for the handler map.

import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components/requiredLocalized';
import { RESTAURANT_SHORTCUTS } from '../restaurantShortcuts';

export interface RestaurantShortcutsHelpProps {
  /** Called when the user dismisses the help. */
  onClose: () => void;
}

/**
 * The restaurant shortcut help list.
 *
 * Deliberately NOT a modal: it is rendered inside the sidebar, which already
 * owns focus trapping and Escape handling, so a nested dialog would fight it
 * for both. Every label comes from the manifest's `labelId`, so a locale that
 * is missing one falls back through Fluent rather than showing an English
 * literal typed into this file.
 */
export function RestaurantShortcutsHelp({ onClose }: RestaurantShortcutsHelpProps) {
  const { l10n } = useLocalization();
  return (
    <section
      className="restaurant-shortcuts-help"
      data-testid="restaurant-shortcuts-help"
      aria-label={requiredLocalized(l10n, 'restaurant-shortcuts-help-title')}
    >
      <header className="restaurant-shortcuts-help-heading">
        <Localized id="restaurant-shortcuts-help-title">
          <span>Keyboard shortcuts</span>
        </Localized>
        <button
          type="button"
          className="restaurant-shortcuts-help-close"
          onClick={onClose}
          aria-label={requiredLocalized(l10n, 'restaurant-shortcuts-help-close-aria')}
          data-testid="restaurant-shortcuts-help-close"
        >
          ×
        </button>
      </header>
      <ul className="restaurant-shortcuts-help-list">
        {RESTAURANT_SHORTCUTS.map((s) => (
          <li key={s.action} className="restaurant-shortcuts-help-row">
            <kbd className="restaurant-shortcuts-help-key">{s.key}</kbd>
            {/* `Localized` with only a fallback child renders the fallback when
                the bundle has no such message, which is what keeps this usable
                under a locale that has not translated the string yet. */}
            <Localized id={s.labelId}>
              <span className="restaurant-shortcuts-help-label">{s.action}</span>
            </Localized>
          </li>
        ))}
      </ul>
    </section>
  );
}
