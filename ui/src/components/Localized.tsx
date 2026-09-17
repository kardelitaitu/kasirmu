/**
 * Re-export of `@fluent/react`'s `<Localized>` component.
 *
 * Components import from `@/components/Localized` so that defaults
 * (e.g. `data-testid` propagation) can be added here without
 * rewriting every JSX call site.
 */
export { Localized, type LocalizedProps } from '@fluent/react';
