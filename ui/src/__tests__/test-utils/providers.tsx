import type { ReactNode, ReactElement } from 'react';
import { ToastProvider } from '@/components/Toast';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import type { LocaleCode } from '@/i18n';

/**
 * Wrap `children` with Fluent + ToastProvider so that any component
 * using `useToast()` has its context available.
 *
 * Usage:
 *   import { withToastProviders } from '@/__tests__/test-utils/providers';
 *   import settingsFtl from '@/locales/settings.ftl?raw';
 *
 *   render(withToastProviders(<MyComponent />, settingsFtl));
 */
export function withToastProviders(
  children: ReactNode,
  ...ftlContents: string[]
): ReactElement {
  return withFluent(
    <ToastProvider>{children}</ToastProvider>,
    ...ftlContents,
  );
}

/**
 * Locale-aware variant with ToastProvider.
 */
export function withToastProvidersLocale(
  locale: LocaleCode,
  children: ReactNode,
  ...ftlContents: string[]
): ReactElement {
  return withFluentLocale(
    locale,
    <ToastProvider>{children}</ToastProvider>,
    ...ftlContents,
  );
}
