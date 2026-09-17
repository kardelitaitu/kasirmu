// shared-ui/locales/test-utils.tsx — Shared Fluent wrappers for tests.
//
// Two helpers:
//
//   • `withFluent(children, ...ftlContents)` — the legacy helper that
//     hardcodes the en-US locale name. Use when the test only checks
//     for language-neutral behavior (mock state, numbers, roles).
//
//   • `withFluentLocale(locale, children, ...ftlContents)` —
//     locale-aware helper that constructs a fresh FluentBundle per
//     call (not the shared `getBundle()` cache) so per-test FTL
//     additions don't leak. Use when the assertion depends on
//     translated text under a specific locale.
//
// Usage:
//   import { withFluent, withFluentLocale } from '@/i18n/test-utils';
//   import salesFtl from '@/locales/sales.ftl?raw';
//   import salesId from '@/locales/sales.id.ftl?raw';
//
//   // English rendering (legacy)
//   render(withFluent(<MyComponent />, salesFtl));
//
//   // Indonesian rendering — my-component must use <Localized id="…">
//   render(withFluentLocale('id', <MyComponent />, salesId));

import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import type { ReactNode, ReactElement } from 'react';
import type { LocaleCode } from '@/i18n';
import sharedFtl from '@/locales/shared.ftl?raw';

/**
 * Prepend `sharedFtl` to `ftlContents` for the `en` locale so the
 * resulting bundle matches what production `getBundle()` exposes
 * (see `src/i18n/index.ts` for the per-locale load order). Caller-
 * provided `sharedFtl` is de-duped via `Array.includes` to avoid
 * Fluent's `Message … already exists in this bundle` warning.
 *
 * Non-`en` locales are intentionally NOT auto-injected: the
 * English-only `sharedFtl` would mask missing translations inside
 * a foreign-locale bundle. Callers needing shared keys for other
 * locales must pass `sharedId` (or the appropriate per-locale
 * shared file) explicitly.
 *
 * Single source of truth shared by `withFluent` and `withFluentLocale`
 * — any future tweak to `sharedFtl` loading semantics only needs to
 * happen here.
 */
function prependShared(
  locale: LocaleCode,
  ftlContents: string[],
): string[] {
  if (locale !== 'en') return ftlContents;
  if (ftlContents.includes(sharedFtl)) return ftlContents;
  return [sharedFtl, ...ftlContents];
}

/**
 * Wrap `children` with a Fluent provider that contains the given .ftl
 * content. See `prependShared` for the auto-prepend + identity-check
 * semantics — this helper just bundles the resulting strings and
 * hands them to `@fluent/react`.
 */
export function withFluent(children: ReactNode, ...ftlContents: string[]): ReactElement {
  // `useIsolating: false` matches the production loader in
  // `i18n/index.ts` so the rendered DOM in tests matches what the
  // user sees in production (no U+2068/U+2069 bidi-isolating markers
  // bleed into RTL's `getByText` queries).
  //
  // `addResource` is called unconditionally so the bundle has
  // identical initial shape to the production bundle created by
  // `getBundle()` — avoids subtle parity drift between test and prod.
  const all = prependShared('en', ftlContents);
  const bundle = new FluentBundle('en-US', { useIsolating: false });
  bundle.addResource(new FluentResource(all.join('\n')));
  const l10n = new ReactLocalization([bundle]);
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}

/**
 * Locale-aware variant: builds a FRESH FluentBundle per call so the
 * `?raw` FTL contents the test passes in don't pollute the shared
 * `getBundle()` cache that production uses.
 *
 * The bundle's name is set to `en-US` for `locale = 'en'` and `id`
 * for `locale = 'id'` — matching the keys inside `i18n/index.ts`
 * and `LocaleContext.tsx`. This keeps Fluent's `formatPattern` happy
 * when the test later formats messages from the bundle by their
 * exact lookup name.
 *
 * For the `en` locale, `sharedFtl` is auto-prepended via
 * `prependShared(locale, ftlContents)` (single source of truth shared
 * with `withFluent`). For other locales, the caller's `ftlContents`
 * are used as-is — see `prependShared` for the rationale.
 */
export function withFluentLocale(
  locale: LocaleCode,
  children: ReactNode,
  ...ftlContents: string[]
): ReactElement {
  // Map the LocaleCode to the matching FluentBundle name. The id
  // locale doesn't have a separate region (id-ID vs id is a Node
  // Intl distinction we don't need for Fluent message lookup).
  const bundleName = locale === 'en' ? 'en-US' : 'id';
  // `useIsolating: false` matches the production loader in
  // `i18n/index.ts` so DOM assertions (`getByText`) return exactly
  // what users see in production — without U+2068/U+2069 bidi markers.
  //
  // `addResource` is called unconditionally (even for an empty
  // contents list) so the bundle has identical initial shape to the
  // production bundle created by `getBundle()` — avoids subtle
  // parity drift between test and prod.
  const all = prependShared(locale, ftlContents);
  const bundle = new FluentBundle(bundleName, { useIsolating: false });
  bundle.addResource(new FluentResource(all.join('\n')));
  const l10n = new ReactLocalization([bundle]);
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}
